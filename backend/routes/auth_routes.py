import io
import re
import uuid
import warnings

from flask import Blueprint, current_app, jsonify, request, session
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.exc import SQLAlchemyError

from ..auth import authenticated_user, ensure_presence, login_required, role_required, set_authenticated_session
from ..config import ROOT_DIR
from ..database import change_customer_password, change_staff_password, create_customer, customer_registration_available, finish_user_session, get_customer_profile, get_staff_account_activity, get_staff_profile, get_user_by_email, login_user, record_activity, update_customer_email, update_customer_name, update_customer_profile_image, update_staff_profile, update_staff_profile_image

auth_bp = Blueprint("auth_bp", __name__)
PROFILE_IMAGE_LIMIT = 5 * 1024 * 1024
PROFILE_IMAGE_DIR = ROOT_DIR / "frontend" / "public" / "customer-uploads"
STAFF_PROFILE_IMAGE_DIR = ROOT_DIR / "frontend" / "public" / "staff-uploads"
PROFILE_IMAGE_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


def valid_gmail(email):
    return isinstance(email, str) and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) is not None


def valid_password(password):
    return (
        isinstance(password, str)
        and len(password) >= 8
        and any(character.islower() for character in password)
        and any(character.isupper() for character in password)
        and any(character.isdigit() for character in password)
    )


def _profile_image_bytes(upload):
    if upload is None:
        return None, "Choose an image to upload."
    raw_image = upload.stream.read(PROFILE_IMAGE_LIMIT + 1)
    if len(raw_image) > PROFILE_IMAGE_LIMIT:
        return None, "The uploaded image exceeds the 5 MB limit."
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw_image)) as source:
                image_format = source.format
                if image_format not in PROFILE_IMAGE_FORMATS:
                    return None, "The uploaded image format is not supported."
                if source.width * source.height > 20_000_000:
                    return None, "The uploaded image dimensions are too large."
                source.verify()
            with Image.open(io.BytesIO(raw_image)) as source:
                image = ImageOps.exif_transpose(source)
                image.load()
                if image_format == "JPEG" and image.mode not in {"RGB", "L"}:
                    image = image.convert("RGB")
                output = io.BytesIO()
                image.save(output, format=image_format, optimize=True)
                contents = output.getvalue()
                if len(contents) > PROFILE_IMAGE_LIMIT:
                    return None, "The processed image exceeds the 5 MB limit."
                return (contents, PROFILE_IMAGE_FORMATS[image_format]), None
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        return None, "The uploaded file is not a valid supported image."


def _delete_profile_image(image_url):
    if not isinstance(image_url, str) or not image_url.startswith("/customer-uploads/"):
        return
    filename = image_url.rsplit("/", 1)[-1]
    if not re.fullmatch(r"[a-f0-9]{32}\.(jpg|png|webp)", filename):
        return
    try:
        (PROFILE_IMAGE_DIR / filename).unlink(missing_ok=True)
    except OSError:
        current_app.logger.exception("Unable to remove a replaced customer profile image.")


def _delete_new_profile_image(path):
    try:
        path.unlink(missing_ok=True)
    except OSError:
        current_app.logger.exception("Unable to clean up an incomplete customer profile image.")


def _delete_new_staff_profile_image(path):
    try:
        path.unlink(missing_ok=True)
    except OSError:
        current_app.logger.exception("Unable to clean up an incomplete staff profile image.")


def _delete_staff_profile_image(image_url):
    if not isinstance(image_url, str) or not image_url.startswith("/staff-uploads/"):
        return
    filename = image_url.rsplit("/", 1)[-1]
    if not re.fullmatch(r"[a-f0-9]{32}\.(jpg|png|webp)", filename):
        return
    try:
        (STAFF_PROFILE_IMAGE_DIR / filename).unlink(missing_ok=True)
    except OSError:
        current_app.logger.exception("Unable to remove a replaced staff profile image.")


def dashboard_path(role):
    return {"admin": "admin/dashboard", "staff": "staff/dashboard", "customer": "customer/dashboard"}.get(role)


@auth_bp.post("/api/auth/register")
def register():
    payload = request.get_json(silent=True) or {}
    name = payload.get("name", payload.get("full_name", ""))
    email = payload.get("email", "")
    password = payload.get("password", "")
    confirmation = payload.get("confirm_password", "")
    if not isinstance(name, str) or not name.strip():
        return jsonify({"error": "Enter your full name."}), 400
    if not isinstance(email, str):
        return jsonify({"error": "Use a valid Gmail address."}), 400
    name = name.strip()
    email = email.strip().lower()
    if not valid_gmail(email):
        return jsonify({"error": "Use a valid Gmail address."}), 400
    if not valid_password(password):
        return jsonify({"error": "Use at least 8 characters with upper, lower, and numeric characters."}), 400
    if password != confirmation:
        return jsonify({"error": "Passwords do not match."}), 400
    if not create_customer(name, email, password):
        registration_status = customer_registration_available()
        if not registration_status["available"]:
            return jsonify({
                "error": (
                    "Customer registration is currently full. The maximum number "
                    f"of customer accounts ({registration_status['limit']}) has been reached."
                )
            }), 409
        return jsonify({"error": "That email is already registered."}), 409
    user = get_user_by_email(email)
    if user:
        record_activity(user["id"], None, "account_created", "Created a customer account.", "Customer Management", request.remote_addr)
    return jsonify({"message": "Customer account created. Please sign in.", "email": email, "name": name, "role": "customer"}), 201


@auth_bp.get("/api/auth/registration-status")
def registration_status():
    try:
        return jsonify(customer_registration_available())
    except SQLAlchemyError:
        current_app.logger.exception("Unable to check customer registration availability.")
        return jsonify({"error": "Account registration is temporarily unavailable. Please try again shortly."}), 503


@auth_bp.post("/api/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = payload.get("email", "")
    password = payload.get("password", "")
    if not isinstance(email, str):
        return jsonify({"error": "Invalid Gmail/Email or password."}), 401
    email = email.strip().lower()
    if not valid_gmail(email):
        return jsonify({"error": "Invalid Gmail/Email or password."}), 401
    try:
        user, error = login_user(email, password)
    except SQLAlchemyError:
        current_app.logger.exception("Unable to authenticate a login request.")
        return jsonify({"error": "Sign-in is temporarily unavailable. Please make sure the database is running and try again."}), 503
    if error:
        return jsonify({"error": error}), 401
    session.clear()
    set_authenticated_session(user)
    public_user = {key: value for key, value in user.items() if key != "auth_version"}
    return jsonify({"message": "Signed in successfully.", "dashboard_path": dashboard_path(user["role"]), **public_user})


@auth_bp.get("/api/auth/me")
def current_user():
    try:
        user = authenticated_user()
    except SQLAlchemyError:
        current_app.logger.exception("Unable to verify the current user session.")
        return jsonify({"error": "Unable to verify your session right now. Please try again shortly."}), 503
    if not user:
        session.clear()
        return jsonify({"authenticated": False}), 401
    set_authenticated_session(user)
    public_user = {key: value for key, value in user.items() if key != "auth_version"}
    return jsonify({"authenticated": True, **public_user})


@auth_bp.get("/api/staff/profile")
@role_required("staff")
def staff_profile():
    user = authenticated_user()
    try:
        profile = get_staff_profile(user["id"])
    except SQLAlchemyError:
        current_app.logger.exception("Unable to load staff profile.")
        return jsonify({"error": "Unable to load your profile right now. Please try again."}), 503
    if profile is None:
        return jsonify({"error": "Staff account not found."}), 404
    return jsonify(profile)


@auth_bp.put("/api/staff/profile")
@role_required("staff")
def update_staff_profile_route():
    payload = request.get_json(silent=True) or {}
    name = payload.get("name")
    username = payload.get("username")
    email = payload.get("email")
    contact_number = payload.get("contact_number", "")
    if not all(isinstance(value, str) for value in (name, username, email, contact_number)):
        return jsonify({"error": "Full name, username, email address, and contact number must be text."}), 400
    name, username, email, contact_number = name.strip(), username.strip(), email.strip().lower(), contact_number.strip()
    if not name or len(name) > 255:
        return jsonify({"error": "Enter a full name up to 255 characters."}), 400
    if not username or len(username) > 255:
        return jsonify({"error": "Enter a username up to 255 characters."}), 400
    if not valid_gmail(email) or len(email) > 255:
        return jsonify({"error": "Enter a valid email address up to 255 characters."}), 400
    if contact_number and (
        len(contact_number) > 32
        or re.fullmatch(r"[+()\d.\-\s]+", contact_number) is None
        or sum(character.isdigit() for character in contact_number) < 7
    ):
        return jsonify({"error": "Enter a valid contact number with at least 7 digits."}), 400
    user = authenticated_user()
    try:
        profile, update_error = update_staff_profile(
            user["id"],
            name,
            username,
            email,
            contact_number,
            session.get("monitoring_session_id"),
            request.remote_addr,
        )
    except SQLAlchemyError:
        current_app.logger.exception("Unable to update staff profile.")
        return jsonify({"error": "Unable to update your profile right now. Please try again."}), 503
    if update_error == "not_found":
        return jsonify({"error": "Staff account not found."}), 404
    if update_error in {"username_exists", "email_exists", "duplicate"}:
        message = {
            "username_exists": "That username is already in use.",
            "email_exists": "That email address is already in use.",
            "duplicate": "That username or email address is already in use.",
        }[update_error]
        return jsonify({"error": message}), 409
    return jsonify({"message": "Profile updated successfully.", "profile": profile})


@auth_bp.post("/api/staff/profile/password")
@role_required("staff")
def update_staff_profile_password():
    payload = request.get_json(silent=True) or {}
    current_password = payload.get("current_password")
    new_password = payload.get("new_password")
    confirmation = payload.get("confirm_password")
    if not all(isinstance(value, str) and value for value in (current_password, new_password, confirmation)):
        return jsonify({"error": "Enter your current password, new password, and confirmation."}), 400
    if not valid_password(new_password):
        return jsonify({"error": "Use at least 8 characters with upper, lower, and numeric characters."}), 400
    if new_password != confirmation:
        return jsonify({"error": "New password and confirmation do not match."}), 400
    user = authenticated_user()
    try:
        result = change_staff_password(
            user["id"],
            current_password,
            new_password,
            session.get("monitoring_session_id"),
            request.remote_addr,
        )
    except SQLAlchemyError:
        current_app.logger.exception("Unable to change staff password.")
        return jsonify({"error": "Unable to change your password right now. Please try again."}), 503
    if result == "not_found":
        return jsonify({"error": "Staff account not found."}), 404
    if result == "invalid_current_password":
        return jsonify({"error": "Your current password is incorrect."}), 400
    if result == "unchanged_password":
        return jsonify({"error": "Choose a new password that is different from your current password."}), 400
    set_authenticated_session({**user, "auth_version": user["auth_version"] + 1})
    return jsonify({"message": "Your password has been changed successfully."})


@auth_bp.get("/api/staff/profile/activity")
@role_required("staff")
def staff_profile_activity():
    user = authenticated_user()
    try:
        sessions = get_staff_account_activity(user["id"])
    except SQLAlchemyError:
        current_app.logger.exception("Unable to load staff account activity.")
        return jsonify({"error": "Unable to load your account activity right now. Please try again."}), 503
    return jsonify({
        "items": [
            {
                "id": item["id"],
                "login_time": item["login_time"],
                "logout_time": item["logout_time"],
                "last_activity": item["last_activity"],
                "session_duration": item["session_duration"],
                "session_status": item["session_status"],
            }
            for item in sessions
        ]
    })


@auth_bp.put("/api/staff/profile/photo")
@role_required("staff")
def upload_staff_profile_photo():
    if request.content_length is not None and request.content_length > PROFILE_IMAGE_LIMIT + 512 * 1024:
        return jsonify({"error": "The uploaded image exceeds the 5 MB limit."}), 413
    image_data, error = _profile_image_bytes(request.files.get("photo"))
    if error:
        return jsonify({"error": error}), 400
    contents, extension = image_data
    filename = f"{uuid.uuid4().hex}.{extension}"
    new_image = STAFF_PROFILE_IMAGE_DIR / filename
    try:
        STAFF_PROFILE_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        with new_image.open("xb") as image_file:
            image_file.write(contents)
    except OSError:
        _delete_new_staff_profile_image(new_image)
        current_app.logger.exception("Unable to save a staff profile image.")
        return jsonify({"error": "Unable to save your profile picture right now. Please try again."}), 503
    user = authenticated_user()
    try:
        profile, previous_url = update_staff_profile_image(
            user["id"], f"/staff-uploads/{filename}",
            session.get("monitoring_session_id"), request.remote_addr,
        )
    except SQLAlchemyError:
        _delete_new_staff_profile_image(new_image)
        current_app.logger.exception("Unable to update staff profile image path.")
        return jsonify({"error": "Unable to update your profile picture right now. Please try again."}), 503
    if profile is None:
        _delete_new_staff_profile_image(new_image)
        return jsonify({"error": "Staff account not found."}), 404
    _delete_staff_profile_image(previous_url)
    return jsonify({"message": "Profile picture updated successfully.", "profile": profile})


@auth_bp.delete("/api/staff/profile/photo")
@role_required("staff")
def remove_staff_profile_photo():
    user = authenticated_user()
    try:
        profile, previous_url = update_staff_profile_image(
            user["id"], None, session.get("monitoring_session_id"), request.remote_addr,
        )
    except SQLAlchemyError:
        current_app.logger.exception("Unable to remove staff profile image.")
        return jsonify({"error": "Unable to remove your profile picture right now. Please try again."}), 503
    if profile is None:
        return jsonify({"error": "Staff account not found."}), 404
    _delete_staff_profile_image(previous_url)
    return jsonify({"message": "Profile picture removed.", "profile": profile})


@auth_bp.get("/api/customer/profile")
@role_required("customer")
def customer_profile():
    user = authenticated_user()
    try:
        profile = get_customer_profile(user["id"])
    except SQLAlchemyError:
        current_app.logger.exception("Unable to load customer profile.")
        return jsonify({"error": "Unable to load your profile right now. Please try again."}), 503
    if profile is None:
        return jsonify({"error": "Customer account not found."}), 404
    return jsonify({"profile": profile})


@auth_bp.put("/api/customer/profile")
@role_required("customer")
def update_customer_profile():
    payload = request.get_json(silent=True) or {}
    name = payload.get("name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 50 or re.fullmatch(r"[\w .'-]+", name.strip(), re.UNICODE) is None:
        return jsonify({"error": "Enter a display name using 1 to 50 letters, numbers, spaces, apostrophes, periods, or hyphens."}), 400
    user = authenticated_user()
    try:
        profile = update_customer_name(user["id"], name.strip())
    except SQLAlchemyError:
        current_app.logger.exception("Unable to update customer display name.")
        return jsonify({"error": "Unable to update your profile right now. Please try again."}), 503
    if profile is None:
        return jsonify({"error": "Customer account not found."}), 404
    return jsonify({"message": "Your nickname has been updated.", "profile": profile})


@auth_bp.put("/api/customer/profile/email")
@role_required("customer")
def update_customer_profile_email():
    payload = request.get_json(silent=True) or {}
    email = payload.get("email")
    confirmation = payload.get("confirm_email")
    current_password = payload.get("current_password")
    if not isinstance(email, str) or not valid_gmail(email.strip().lower()):
        return jsonify({"error": "Please enter a valid email address."}), 400
    email = email.strip().lower()
    if not isinstance(confirmation, str) or email != confirmation.strip().lower():
        return jsonify({"error": "New email address and confirmation do not match."}), 400
    if not isinstance(current_password, str) or not current_password:
        return jsonify({"error": "Enter your current password to change your email address."}), 400
    user = authenticated_user()
    try:
        result, profile = update_customer_email(user["id"], email, current_password)
    except SQLAlchemyError:
        current_app.logger.exception("Unable to update customer email address.")
        return jsonify({"error": "Unable to update your email address right now. Please try again."}), 503
    if result == "not_found":
        return jsonify({"error": "Customer account not found."}), 404
    if result == "invalid_password":
        return jsonify({"error": "Your current password is incorrect."}), 400
    if result == "email_exists":
        return jsonify({"error": "This email address is already registered."}), 409
    return jsonify({
        "message": "Your email address was saved. It has not been independently verified.",
        "profile": profile,
        "email_verified": False,
    })


@auth_bp.post("/api/customer/profile/password")
@role_required("customer")
def update_customer_profile_password():
    payload = request.get_json(silent=True) or {}
    current_password = payload.get("current_password")
    new_password = payload.get("new_password")
    confirmation = payload.get("confirm_password")
    if not all(isinstance(value, str) and value for value in (current_password, new_password, confirmation)):
        return jsonify({"error": "Enter your current password, new password, and confirmation."}), 400
    if not valid_password(new_password):
        return jsonify({"error": "Use at least 8 characters with upper, lower, and numeric characters."}), 400
    if new_password != confirmation:
        return jsonify({"error": "New password and confirmation do not match."}), 400
    user = authenticated_user()
    try:
        result, profile = change_customer_password(
            user["id"],
            current_password,
            new_password,
            session.get("monitoring_session_id"),
            request.remote_addr,
        )
    except SQLAlchemyError:
        current_app.logger.exception("Unable to change customer password.")
        return jsonify({"error": "Unable to change your password right now. Please try again."}), 503
    if result == "not_found":
        return jsonify({"error": "Customer account not found."}), 404
    if result == "invalid_current_password":
        return jsonify({"error": "Your current password is incorrect."}), 400
    if result == "unchanged_password":
        return jsonify({"error": "Choose a new password that is different from your current password."}), 400
    set_authenticated_session({**user, "auth_version": user["auth_version"] + 1})
    return jsonify({"message": "Your password has been changed successfully.", "profile": profile})


@auth_bp.put("/api/customer/profile/photo")
@role_required("customer")
def upload_customer_profile_photo():
    if request.content_length is not None and request.content_length > PROFILE_IMAGE_LIMIT + 512 * 1024:
        return jsonify({"error": "The uploaded image exceeds the 5 MB limit."}), 413
    image_data, error = _profile_image_bytes(request.files.get("photo"))
    if error:
        return jsonify({"error": error}), 400
    contents, extension = image_data
    filename = f"{uuid.uuid4().hex}.{extension}"
    new_image = PROFILE_IMAGE_DIR / filename
    try:
        PROFILE_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        with new_image.open("xb") as image_file:
            image_file.write(contents)
    except OSError:
        _delete_new_profile_image(new_image)
        current_app.logger.exception("Unable to save a customer profile image.")
        return jsonify({"error": "Unable to save your profile picture right now. Please try again."}), 503
    user = authenticated_user()
    try:
        profile, previous_url = update_customer_profile_image(user["id"], f"/customer-uploads/{filename}")
    except SQLAlchemyError:
        _delete_new_profile_image(new_image)
        current_app.logger.exception("Unable to update customer profile image path.")
        return jsonify({"error": "Unable to update your profile picture right now. Please try again."}), 503
    if profile is None:
        _delete_new_profile_image(new_image)
        return jsonify({"error": "Customer account not found."}), 404
    _delete_profile_image(previous_url)
    return jsonify({"message": "Profile picture updated successfully.", "profile": profile})


@auth_bp.delete("/api/customer/profile/photo")
@role_required("customer")
def remove_customer_profile_photo():
    user = authenticated_user()
    try:
        profile, previous_url = update_customer_profile_image(user["id"], None)
    except SQLAlchemyError:
        current_app.logger.exception("Unable to remove customer profile image.")
        return jsonify({"error": "Unable to remove your profile picture right now. Please try again."}), 503
    if profile is None:
        return jsonify({"error": "Customer account not found."}), 404
    _delete_profile_image(previous_url)
    return jsonify({"message": "Profile picture removed.", "profile": profile})


@auth_bp.post("/api/auth/logout")
def logout():
    user = authenticated_user()
    session_id = session.get("monitoring_session_id")
    try:
        if user and session_id:
            finish_user_session(user["id"], session_id, request.remote_addr)
    except SQLAlchemyError:
        current_app.logger.exception("Unable to record user logout.")
    finally:
        session.clear()
    return jsonify({"message": "Signed out successfully."})


@auth_bp.post("/api/auth/heartbeat")
@login_required
def heartbeat():
    ensure_presence({"id": session["user"]["user_id"]})
    return jsonify({"status": "online"})


@auth_bp.post("/api/login")
def login_alias():
    return login()


@auth_bp.post("/api/register")
def register_alias():
    return register()


@auth_bp.get("/api/admin/dashboard")
@role_required("admin")
def admin_dashboard():
    return jsonify({"role": "admin", "message": "Admin access granted."})


@auth_bp.get("/api/staff/dashboard")
@role_required("staff")
def staff_dashboard():
    return jsonify({"role": "staff", "message": "Staff access granted."})


@auth_bp.get("/api/customer/dashboard")
@role_required("customer")
def customer_dashboard():
    return jsonify({"role": "customer", "message": "Customer access granted."})
