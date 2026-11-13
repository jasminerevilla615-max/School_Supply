import json
import re
import uuid
from decimal import Decimal, InvalidOperation
from datetime import timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, session
from flask_cors import CORS
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.utils import secure_filename

from .auth import authenticated_user, login_required, role_required
from .config import (
    CORS_ORIGINS,
    ROOT_DIR,
    SECRET_KEY,
    SESSION_COOKIE_SAMESITE,
    SESSION_COOKIE_SECURE,
)
from .database import (
    add_stock,
    create_category,
    create_order,
    create_product,
    create_sale,
    delete_category,
    delete_notification,
    delete_product,
    change_admin_password,
    get_admin_account_activity,
    get_admin_profile,
    get_order_details,
    get_activity_logs,
    get_monitoring_stats,
    get_monitoring_users,
    get_session_history,
    get_system_settings,
    initialize_database,
    list_categories,
    list_inventory,
    list_all_product_feedback,
    list_notifications,
    list_orders,
    list_products,
    list_product_feedback,
    list_sales,
    mark_all_notifications_read,
    mark_notification_read,
    record_activity,
    update_category,
    update_admin_profile,
    update_inventory,
    update_order_status,
    update_order_payment_status,
    update_product,
    save_system_settings,
    submit_product_feedback,
)
from .db import engine
from .routes import admin_bp, auth_bp, catalog_bp, health_bp

DIST_DIR = ROOT_DIR / "frontend" / "dist"
PRODUCT_IMAGE_DIR = ROOT_DIR / "frontend" / "public" / "product-images"
STORE_SETTINGS_DIR = ROOT_DIR / "frontend" / "public" / "store-settings"
CUSTOMER_UPLOAD_DIR = ROOT_DIR / "frontend" / "public" / "customer-uploads"
STAFF_UPLOAD_DIR = ROOT_DIR / "frontend" / "public" / "staff-uploads"
ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
ALLOWED_IMAGE_MIMETYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024


def save_product_image(upload):
    if not upload or not upload.filename:
        return None, None
    filename = secure_filename(upload.filename)
    extension = Path(filename).suffix.lower().lstrip(".")
    if extension not in ALLOWED_IMAGE_EXTENSIONS or upload.mimetype not in ALLOWED_IMAGE_MIMETYPES:
        return None, "Please upload a valid JPG, PNG, JPEG, or WEBP image."
    content = upload.read(MAX_PRODUCT_IMAGE_BYTES + 1)
    upload.seek(0)
    if len(content) > MAX_PRODUCT_IMAGE_BYTES:
        return None, "Product images must be 5 MB or smaller."
    signatures = {
        "jpg": content.startswith(b"\xff\xd8\xff"),
        "jpeg": content.startswith(b"\xff\xd8\xff"),
        "png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
    }
    if not signatures[extension]:
        return None, "The uploaded file does not match its image type."
    PRODUCT_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.{extension}"
    try:
        (PRODUCT_IMAGE_DIR / stored_name).write_bytes(content)
    except OSError:
        return None, "The product image could not be stored. Please try again."
    return f"/product-images/{stored_name}", None


def remove_product_image(image_url):
    if not image_url:
        return
    filename = Path(image_url).name
    if not re.fullmatch(r"[a-f0-9]{32}\.(?:jpg|jpeg|png|webp)", filename, re.IGNORECASE):
        return
    try:
        (PRODUCT_IMAGE_DIR / filename).unlink(missing_ok=True)
    except OSError:
        app.logger.exception("Unable to remove an unused product image.")


def parse_product_code(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", value.strip()):
        raise ValueError("Enter a product code using letters, numbers, dots, underscores, or hyphens.")
    return value.strip().upper()


def _validate_settings_payload(payload):
    if not isinstance(payload, dict):
        return None, "Settings must be a JSON object."

    section_fields = {
        "store": {"name", "email", "phone", "address", "logo_url"},
        "preferences": {"currency", "time_zone", "date_format", "language"},
        "notifications": {"customer_orders", "low_stock", "supplier_updates", "daily_summary"},
        "security": {"session_timeout_minutes"},
        "inventory": {"low_stock_threshold", "automatic_alerts"},
    }
    if set(payload) != set(section_fields):
        return None, "The settings are incomplete. Reload the page and try again."
    for section, allowed_fields in section_fields.items():
        if not isinstance(payload[section], dict) or set(payload[section]) != allowed_fields:
            return None, f"The {section} settings are invalid."

    store = payload["store"]
    if not all(isinstance(store[field], str) for field in ("name", "email", "phone", "address", "logo_url")):
        return None, "Store profile fields must be text."
    store = {key: value.strip() for key, value in store.items()}
    if not store["name"] or len(store["name"]) > 120:
        return None, "Enter a store name up to 120 characters."
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", store["email"]) or len(store["email"]) > 254:
        return None, "Enter a valid store email address."
    if len(store["phone"]) > 40 or (store["phone"] and not re.fullmatch(r"[0-9+().\-\s]+", store["phone"])):
        return None, "Enter a valid contact number."
    if len(store["address"]) > 500:
        return None, "Store address must be 500 characters or fewer."
    if store["logo_url"] and not re.fullmatch(r"/store-settings/[a-f0-9]{32}\.(?:jpg|jpeg|png|webp)", store["logo_url"]):
        return None, "Choose a valid store logo."

    preferences = payload["preferences"]
    choices = {
        "currency": {"PHP", "USD", "EUR", "JPY", "GBP"},
        "time_zone": {"Asia/Manila", "UTC", "Asia/Singapore", "America/Los_Angeles", "Europe/London"},
        "date_format": {"DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"},
        "language": {"en", "fil", "es"},
    }
    if any(not isinstance(preferences[field], str) or preferences[field] not in allowed for field, allowed in choices.items()):
        return None, "Choose a supported general preference."

    for preference in payload["notifications"].values():
        if not isinstance(preference, bool):
            return None, "Notification preferences must be enabled or disabled."
    security = payload["security"]
    if type(security["session_timeout_minutes"]) is not int or security["session_timeout_minutes"] not in {15, 30, 60, 120}:
        return None, "Choose a supported session timeout."

    inventory = payload["inventory"]
    if type(inventory["low_stock_threshold"]) is not int or not 1 <= inventory["low_stock_threshold"] <= 10000:
        return None, "Low stock threshold must be between 1 and 10,000."
    if not isinstance(inventory["automatic_alerts"], bool):
        return None, "Automatic stock alerts must be enabled or disabled."

    return {
        "store": store,
        "preferences": preferences,
        "notifications": payload["notifications"],
        "security": security,
        "inventory": inventory,
    }, None


def create_app():
    app = Flask(__name__, static_folder=str(DIST_DIR / "assets"), static_url_path="/assets")
    app.config.update(
        SECRET_KEY=SECRET_KEY,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE=SESSION_COOKIE_SAMESITE,
        SESSION_COOKIE_SECURE=SESSION_COOKIE_SECURE,
        PERMANENT_SESSION_LIFETIME=1800,
    )
    CORS(app, resources={r"/api/*": {"origins": CORS_ORIGINS}}, supports_credentials=True)
    initialize_database()
    initial_settings = get_system_settings()
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(
        minutes=initial_settings["security"]["session_timeout_minutes"]
    )

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

    @app.get("/api/health")
    def health_check():
        return jsonify({"status": "ok"})

    @app.get("/api/test-db")
    def test_db():
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return jsonify({"success": True, "message": "MySQL database connected successfully!"})
        except Exception as exc:  # pragma: no cover - direct database diagnostics
            return jsonify({"success": False, "message": str(exc), "error": type(exc).__name__}), 500

    @app.get("/product-images/<path:filename>")
    def product_image(filename):
        return send_from_directory(PRODUCT_IMAGE_DIR, filename)

    @app.get("/store-settings/<path:filename>")
    def store_setting_file(filename):
        return send_from_directory(STORE_SETTINGS_DIR, filename)

    @app.get("/customer-uploads/<path:filename>")
    def customer_profile_image(filename):
        return send_from_directory(CUSTOMER_UPLOAD_DIR, filename)

    @app.get("/staff-uploads/<path:filename>")
    def staff_profile_image(filename):
        return send_from_directory(STAFF_UPLOAD_DIR, filename)

    @app.get("/api/admin/settings")
    @role_required("admin")
    def admin_settings():
        user = authenticated_user()
        database_name = {"mysql": "MySQL", "sqlite": "SQLite"}.get(
            engine.dialect.name,
            engine.dialect.name.capitalize(),
        )
        try:
            with (ROOT_DIR / "frontend" / "package.json").open(encoding="utf-8") as package_file:
                version = json.load(package_file).get("version", "Unknown")
        except (OSError, ValueError):
            version = "Unknown"
        try:
            settings = get_system_settings()
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except SQLAlchemyError:
            app.logger.exception("Unable to load administrator settings.")
            return jsonify({
                "error": "Unable to load system settings because the database is disconnected.",
                "administrator": {"name": user["name"], "email": user["email"], "role": user["role"]},
                "system": {
                    "application_name": "SchoolSupply",
                    "database": database_name,
                    "connected": False,
                    "version": version,
                },
            }), 503
        return jsonify({
            "settings": settings,
            "administrator": {"name": user["name"], "email": user["email"], "role": user["role"]},
            "system": {
                "application_name": "SchoolSupply",
                "database": database_name,
                "connected": True,
                "version": version,
            },
        })

    @app.put("/api/admin/settings")
    @role_required("admin")
    def update_admin_settings():
        settings, validation_error = _validate_settings_payload(request.get_json(silent=True))
        if validation_error:
            return jsonify({"error": validation_error}), 400
        try:
            save_system_settings(settings)
            app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(
                minutes=settings["security"]["session_timeout_minutes"]
            )
        except SQLAlchemyError:
            app.logger.exception("Unable to save administrator settings.")
            return jsonify({"error": "Unable to save settings to the database."}), 503
        return jsonify({"message": "System settings saved successfully.", "settings": settings})

    @app.post("/api/admin/settings/logo")
    @role_required("admin")
    def upload_store_logo():
        upload = request.files.get("image")
        if not upload or not upload.filename:
            return jsonify({"error": "Choose a logo image to upload."}), 400
        filename = secure_filename(upload.filename)
        extension = Path(filename).suffix.lower().lstrip(".")
        if extension not in ALLOWED_IMAGE_EXTENSIONS or upload.mimetype not in ALLOWED_IMAGE_MIMETYPES:
            return jsonify({"error": "Upload a JPG, PNG, JPEG, or WEBP logo."}), 400
        content = upload.read(MAX_PRODUCT_IMAGE_BYTES + 1)
        if len(content) > MAX_PRODUCT_IMAGE_BYTES:
            return jsonify({"error": "The logo must be 5 MB or smaller."}), 400
        signatures = {
            "jpg": content.startswith(b"\xff\xd8\xff"),
            "jpeg": content.startswith(b"\xff\xd8\xff"),
            "png": content.startswith(b"\x89PNG\r\n\x1a\n"),
            "webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
        }
        if not signatures[extension]:
            return jsonify({"error": "The uploaded file does not match its image type."}), 400
        STORE_SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
        stored_name = f"{uuid.uuid4().hex}.{extension}"
        try:
            (STORE_SETTINGS_DIR / stored_name).write_bytes(content)
        except OSError:
            app.logger.exception("Unable to store uploaded store logo.")
            return jsonify({"error": "The store logo could not be stored."}), 500
        return jsonify({"logo_url": f"/store-settings/{stored_name}"})

    @app.after_request
    def prevent_auth_response_caching(response):
        if request.path.startswith(("/api/auth", "/api/admin", "/api/staff", "/api/customer")) or request.path.endswith("/dashboard"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(500)
    def handle_internal_server_error(error):
        if request.path.startswith("/api/"):
            app.logger.error("API request failed with HTTP 500: %s", error)
            return jsonify({"error": "The server could not complete your request. Please try again."}), 500
        return error

    @app.get("/api/admin/profile")
    @role_required("admin")
    def admin_profile():
        user = authenticated_user()
        try:
            profile = get_admin_profile(user["id"])
        except SQLAlchemyError:
            return jsonify({"error": "Unable to load administrator profile due to a database error."}), 500
        if profile is None:
            return jsonify({"error": "Administrator account not found."}), 404
        return jsonify(profile)

    @app.put("/api/admin/profile")
    @role_required("admin")
    def update_current_admin_profile():
        payload = request.get_json(silent=True) or {}
        name = payload.get("name")
        username = payload.get("username")
        email = payload.get("email")
        if not all(isinstance(value, str) for value in (name, username, email)):
            return jsonify({"error": "Full name, username, and email address are required."}), 400
        name, username, email = name.strip(), username.strip(), email.strip().lower()
        if not name or len(name) > 255:
            return jsonify({"error": "Enter a full name up to 255 characters."}), 400
        if not username or len(username) > 255:
            return jsonify({"error": "Enter a username up to 255 characters."}), 400
        if not valid_gmail(email) or len(email) > 255:
            return jsonify({"error": "Enter a valid email address up to 255 characters."}), 400
        user = authenticated_user()
        try:
            profile, update_error = update_admin_profile(
                user["id"],
                name,
                username,
                email,
                session.get("monitoring_session_id"),
                request.remote_addr,
            )
        except SQLAlchemyError:
            return jsonify({"error": "Unable to update administrator profile due to a database error."}), 500
        if update_error == "not_found":
            return jsonify({"error": "Administrator account not found."}), 404
        if update_error in {"username_exists", "email_exists", "duplicate"}:
            message = {
                "username_exists": "That username is already in use.",
                "email_exists": "That email address is already in use.",
                "duplicate": "That username or email address is already in use.",
            }[update_error]
            return jsonify({"error": message}), 409
        return jsonify({"message": "Profile updated successfully.", "profile": profile})

    @app.post("/api/admin/profile/password")
    @role_required("admin")
    def update_current_admin_password():
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
            password_error = change_admin_password(
                user["id"],
                current_password,
                new_password,
                session.get("monitoring_session_id"),
                request.remote_addr,
            )
        except SQLAlchemyError:
            return jsonify({"error": "Unable to update the administrator password due to a database error."}), 500
        if password_error == "not_found":
            return jsonify({"error": "Administrator account not found."}), 404
        if password_error == "invalid_current_password":
            return jsonify({"error": "The current password is incorrect."}), 400
        return jsonify({"message": "Password updated successfully."})

    @app.get("/api/admin/profile/activity")
    @role_required("admin")
    def current_admin_account_activity():
        user = authenticated_user()
        try:
            return jsonify(get_admin_account_activity(user["id"]))
        except SQLAlchemyError:
            return jsonify({"error": "Unable to load account activity due to a database error."}), 500

    @app.get("/api/admin/monitoring/stats")
    @role_required("admin")
    def monitoring_stats():
        return jsonify(get_monitoring_stats())

    @app.get("/api/admin/monitoring/users")
    @role_required("admin")
    def monitoring_users():
        return jsonify(get_monitoring_users(
            search=request.args.get("search", ""),
            role=request.args.get("role", ""),
            current_status=request.args.get("status", ""),
            start_date=request.args.get("start_date"),
            end_date=request.args.get("end_date"),
            include_admin=request.args.get("include_admin") == "true",
        ))

    @app.get("/api/admin/monitoring/sessions")
    @role_required("admin")
    def monitoring_sessions():
        return jsonify(get_session_history(
            user_id=request.args.get("user_id", type=int),
            start_date=request.args.get("start_date"),
            end_date=request.args.get("end_date"),
        ))

    @app.get("/api/admin/monitoring/activity")
    @role_required("admin")
    def monitoring_activity():
        return jsonify(get_activity_logs(
            user_id=request.args.get("user_id", type=int),
            action=request.args.get("action", ""),
            start_date=request.args.get("start_date"),
            end_date=request.args.get("end_date"),
            search=request.args.get("search", ""),
        ))

    @app.get("/api/categories")
    def categories():
        return jsonify({"items": list_categories()})

    @app.post("/api/categories")
    @role_required("admin")
    def create_category_route():
        payload = request.get_json(silent=True) or {}
        name = payload.get("name", "")
        description = payload.get("description", "")
        item = create_category(name, description)
        if item is None:
            return jsonify({"error": "Category name is required."}), 400
        user = authenticated_user()
        record_activity(user["id"], session.get("monitoring_session_id"), "category_created", f"Created category {item['name']}.", "Categories", request.remote_addr)
        return jsonify({"message": "Category created successfully.", "category": item}), 201

    @app.put("/api/categories/<int:category_id>")
    @role_required("admin")
    def update_category_route(category_id):
        payload = request.get_json(silent=True) or {}
        item = update_category(category_id, payload.get("name"), payload.get("description", ""))
        if item is None:
            return jsonify({"error": "Category not found."}), 404
        user = authenticated_user()
        record_activity(user["id"], session.get("monitoring_session_id"), "category_updated", f"Updated category {item['name']}.", "Categories", request.remote_addr)
        return jsonify({"message": "Category updated successfully.", "category": item})

    @app.delete("/api/categories/<int:category_id>")
    @role_required("admin")
    def delete_category_route(category_id):
        user = authenticated_user()
        category = next((item for item in list_categories() if item["id"] == category_id), None)
        if not delete_category(category_id):
            return jsonify({"error": "Category not found."}), 404
        record_activity(user["id"], session.get("monitoring_session_id"), "category_deleted", f"Deleted category {category['name'] if category else category_id}.", "Categories", request.remote_addr)
        return jsonify({"message": "Category deleted successfully."})

    @app.get("/api/products")
    @login_required
    def products():
        user = authenticated_user()
        if session.get("monitoring_session_id"):
            record_activity(user["id"], session["monitoring_session_id"], "product_viewed", "Viewed the product catalog", "Products", request.remote_addr)
        return jsonify(
            list_products(
                include_inactive=user["role"] != "customer",
                include_cost=user["role"] == "admin",
            )
        )

    @app.post("/api/products")
    @role_required("admin")
    def create_product_route():
        payload = request.form.to_dict() if request.form else (request.get_json(silent=True) or {})
        raw_name = payload.get("name")
        name = raw_name.strip() if isinstance(raw_name, str) else ""
        description = payload.get("description")
        category_id = payload.get("category_id")
        if not name or len(name) > 255:
            return jsonify({"error": "Product name is required."}), 400
        if not isinstance(description, str) or not description.strip():
            return jsonify({"error": "Product description is required."}), 400
        if isinstance(category_id, bool):
            return jsonify({"error": "Choose a valid category."}), 400
        try:
            category_id = int(category_id)
            price_value = Decimal(str(payload.get("price")))
            unit_cost_value = Decimal(str(payload.get("unit_cost")))
            raw_stock = payload.get("stock")
            if isinstance(raw_stock, bool):
                raise ValueError
            stock_value = int(raw_stock)
            reorder_level = int(payload.get("reorder_level", 0))
            product_code = parse_product_code(payload.get("product_code"))
        except (TypeError, ValueError, InvalidOperation):
            return jsonify({"error": "Enter a product code, category, valid prices, whole-number stock, and minimum stock level."}), 400
        if (
            category_id < 1
            or category_id > 2147483647
            or not price_value.is_finite()
            or not unit_cost_value.is_finite()
            or price_value.as_tuple().exponent < -2
            or unit_cost_value.as_tuple().exponent < -2
            or price_value >= Decimal("100000000")
            or unit_cost_value >= Decimal("100000000")
            or stock_value > 2147483647
            or reorder_level < 0
            or reorder_level > 2147483647
        ):
            return jsonify({"error": "Choose a valid category and enter finite prices."}), 400
        if price_value < 0 or unit_cost_value < 0 or stock_value < 0:
            return jsonify({"error": "Prices and stock cannot be negative."}), 400
        if not isinstance(payload.get("status"), str) or payload["status"] not in {"active", "inactive"}:
            return jsonify({"error": "Choose Active or Inactive product status."}), 400
        if not request.files.get("image"):
            return jsonify({"error": "Upload a product photo before creating this product."}), 400
        image_url, image_error = save_product_image(request.files.get("image"))
        if image_error:
            return jsonify({"error": image_error}), 400
        try:
            product = create_product(
                name,
                category_id,
                price_value,
                stock_value,
                payload["description"],
                image_url,
                unit_cost_value,
                payload["status"],
                product_code=product_code,
                reorder_level=reorder_level,
            )
        except ValueError as exc:
            remove_product_image(image_url)
            return jsonify({"error": str(exc)}), 400
        except IntegrityError:
            remove_product_image(image_url)
            return jsonify({"error": "This product code is already in use."}), 409
        except SQLAlchemyError:
            remove_product_image(image_url)
            app.logger.exception("Unable to persist product creation.")
            return jsonify({"error": "The product could not be saved. Please try again."}), 500
        if product is None:
            remove_product_image(image_url)
            return jsonify({"error": "Could not create product."}), 400
        user = authenticated_user()
        record_activity(user["id"], session.get("monitoring_session_id"), "product_created", f"Created product {product['name']} (ID {product['id']}).", "Product Management", request.remote_addr)
        return jsonify({"message": "Product created successfully.", "product": product}), 201

    @app.put("/api/products/<product_id>")
    @role_required("admin")
    def edit_product(product_id):
        payload = request.form.to_dict() if request.form else (request.get_json(silent=True) or {})
        try:
            price = Decimal(str(payload["price"]))
            unit_cost = Decimal(str(payload["unit_cost"]))
            raw_stock = payload["stock"]
            if isinstance(raw_stock, bool):
                raise ValueError
            stock = int(raw_stock)
        except (KeyError, TypeError, ValueError, InvalidOperation):
            return jsonify({"error": "Selling price, unit cost, and stock must be valid numbers."}), 400
        if (
            not price.is_finite()
            or not unit_cost.is_finite()
            or price < 0
            or unit_cost < 0
            or price.as_tuple().exponent < -2
            or unit_cost.as_tuple().exponent < -2
            or price >= Decimal("100000000")
            or unit_cost >= Decimal("100000000")
            or stock < 0
            or stock > 2147483647
        ):
            return jsonify({"error": "Prices and stock must be finite and cannot be negative."}), 400
        if not isinstance(payload.get("name"), str) or not payload["name"].strip() or len(payload["name"]) > 255 or not isinstance(payload.get("description"), str) or not payload["description"].strip():
            return jsonify({"error": "Product name and description are required."}), 400
        category_id = payload.get("category_id")
        if isinstance(category_id, bool):
            return jsonify({"error": "Choose a valid category."}), 400
        try:
            category_id = int(category_id)
            reorder_level = int(payload.get("reorder_level", 0))
            product_code = parse_product_code(payload.get("product_code"))
        except (TypeError, ValueError):
            return jsonify({"error": "Choose a valid product code, category, and minimum stock level."}), 400
        if category_id < 1 or category_id > 2147483647 or reorder_level < 0 or reorder_level > 2147483647:
            return jsonify({"error": "Choose a valid category."}), 400
        status = payload.get("status")
        if not isinstance(status, str) or status not in {"active", "inactive"}:
            return jsonify({"error": "Choose Active or Inactive product status."}), 400
        image_url, image_error = save_product_image(request.files.get("image"))
        if image_error:
            return jsonify({"error": image_error}), 400
        old_product = next((product for product in list_products(include_cost=True) if str(product["id"]) == str(product_id)), None)
        try:
            user = authenticated_user()
            updated = update_product(product_id, price, stock, image_url=image_url, name=payload.get("name"), description=payload.get("description"), category_id=category_id, unit_cost=unit_cost, status=status, actor_name=user["name"], product_code=product_code, reorder_level=reorder_level)
        except ValueError as exc:
            remove_product_image(image_url)
            return jsonify({"error": str(exc)}), 400
        except IntegrityError:
            remove_product_image(image_url)
            return jsonify({"error": "This product code is already in use."}), 409
        except SQLAlchemyError:
            remove_product_image(image_url)
            app.logger.exception("Unable to persist product updates.")
            return jsonify({"error": "The product could not be updated. Please try again."}), 500
        if not updated:
            remove_product_image(image_url)
            return jsonify({"error": "product not found"}), 404
        if image_url and old_product and old_product.get("image_url"):
            remove_product_image(old_product["image_url"])
        user = authenticated_user()
        updated_product = next((product for product in list_products(include_cost=True) if str(product["id"]) == str(product_id)), None)
        record_activity(user["id"], session.get("monitoring_session_id"), "product_updated", f"Updated product {updated_product['name'] if updated_product else product_id} (ID {product_id}).", "Product Management", request.remote_addr)
        return jsonify(updated_product)

    @app.get("/api/notifications")
    @login_required
    def notifications():
        user = authenticated_user()
        return jsonify({"items": list_notifications(user["id"])})

    @app.patch("/api/notifications/read-all")
    @login_required
    def read_all_notifications():
        user = authenticated_user()
        remaining = mark_all_notifications_read(user["id"])
        return jsonify({"message": "All notifications marked as read.", "unread_count": remaining})

    @app.patch("/api/notifications/<int:notification_id>/read")
    @login_required
    def read_notification(notification_id):
        user = authenticated_user()
        if not mark_notification_read(user["id"], notification_id):
            return jsonify({"error": "Notification not found."}), 404
        return jsonify({"message": "Notification marked as read."})

    @app.delete("/api/notifications/<int:notification_id>")
    @login_required
    def delete_notification_route(notification_id):
        user = authenticated_user()
        if not delete_notification(user["id"], notification_id):
            return jsonify({"error": "Notification not found."}), 404
        return jsonify({"message": "Notification deleted."})

    @app.delete("/api/products/<product_id>")
    @role_required("admin")
    def delete_product_route(product_id):
        product = next((item for item in list_products(include_cost=False) if str(item["id"]) == str(product_id)), None)
        try:
            if not delete_product(product_id):
                return jsonify({"error": "Product not found."}), 404
        except ValueError as error:
            return jsonify({"error": str(error)}), 409
        if product:
            remove_product_image(product.get("image_url"))
        user = authenticated_user()
        record_activity(user["id"], session.get("monitoring_session_id"), "product_deleted", f"Deleted product ID {product_id}.", "Product Management", request.remote_addr)
        return jsonify({"message": "Product deleted successfully."})

    @app.post("/api/products/<product_id>/stock")
    @role_required("staff")
    def stock_product(product_id):
        payload = request.get_json(silent=True) or {}
        try:
            amount = int(payload["amount"])
        except (KeyError, TypeError, ValueError):
            return jsonify({"error": "amount must be a whole number"}), 400
        if amount < 1:
            return jsonify({"error": "amount must be at least 1"}), 400
        user = authenticated_user()
        if not add_stock(product_id, amount, user["name"]):
            return jsonify({"error": "product not found"}), 404
        record_activity(user["id"], session.get("monitoring_session_id"), "stock_updated", f"Added {amount} units to product {product_id}.", "Inventory", request.remote_addr)
        updated_product = next((product for product in list_products(include_cost=False) if str(product["id"]) == str(product_id)), None)
        return jsonify(updated_product)

    @app.get("/api/inventory")
    @login_required
    def inventory():
        return jsonify({"items": list_inventory()})

    @app.put("/api/inventory/<int:product_id>")
    @role_required("admin")
    def update_inventory_route(product_id):
        payload = request.get_json(silent=True) or {}
        quantity = payload.get("quantity", 0)
        reorder_level = payload.get("reorder_level", 0)
        location = payload.get("location", "main")
        try:
            quantity_value = int(quantity)
            reorder_value = int(reorder_level)
        except (TypeError, ValueError):
            return jsonify({"error": "quantity and reorder_level must be integers."}), 400
        if quantity_value < 0 or reorder_value < 0:
            return jsonify({"error": "quantity and reorder_level cannot be negative."}), 400
        user = authenticated_user()
        try:
            item = update_inventory(product_id, quantity_value, reorder_value, location, user["name"])
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        if item is None:
            return jsonify({"error": "Product not found."}), 404
        record_activity(
            user["id"],
            session.get("monitoring_session_id"),
            "inventory_updated",
            f"Adjusted inventory for product {product_id} to {quantity_value} units with reorder level {reorder_value}.",
            "Inventory",
            request.remote_addr,
        )
        return jsonify({"message": "Inventory updated successfully.", "inventory": item})

    @app.get("/api/orders")
    @login_required
    def orders():
        user = authenticated_user()
        items = list_orders()
        if user["role"] == "customer":
            items = [order for order in items if order["user_id"] == user["id"]]
        return jsonify({"items": items})

    @app.post("/api/orders")
    @role_required("customer")
    def create_order_route():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "A valid checkout request is required."}), 400
        user = authenticated_user()
        items = payload.get("items", [])
        try:
            order = create_order(
                user["id"],
                items,
                payload.get("payment_method"),
                payload.get("idempotency_key"),
                payload.get("customer_info"),
            )
        except ValueError as error:
            response = {"error": str(error)}
            field_errors = getattr(error, "field_errors", None)
            if field_errors:
                response["field_errors"] = field_errors
            return jsonify(response), 400
        if order is None:
            return jsonify({"error": "Order requires at least one product."}), 400
        record_activity(user["id"], session.get("monitoring_session_id"), "order_placed", f"Placed order #{order['id']} with total {order['total']:.2f}.", "Customer Orders", request.remote_addr)
        return jsonify({"message": "Order created successfully.", "order": order}), 201

    @app.get("/api/orders/<int:order_id>")
    @login_required
    def order_details_route(order_id):
        user = authenticated_user()
        order = get_order_details(order_id)
        if order is None:
            return jsonify({"error": "Order not found."}), 404
        if user["role"] == "customer" and order["user_id"] != user["id"]:
            return jsonify({"error": "Order not found."}), 404
        return jsonify({"order": order})

    @app.post("/api/orders/<int:order_id>/cancel")
    @role_required("customer")
    def cancel_customer_order_route(order_id):
        user = authenticated_user()
        try:
            order = update_order_status(
                order_id,
                "Cancelled",
                changed_by=user["id"],
                customer_user_id=user["id"],
            )
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        if order is None:
            return jsonify({"error": "Order not found."}), 404
        record_activity(
            user["id"],
            session.get("monitoring_session_id"),
            "order_cancelled",
            f"Cancelled order #{order_id} while awaiting Staff confirmation.",
            "Customer Orders",
            request.remote_addr,
        )
        return jsonify({"message": "Order cancelled successfully.", "order": get_order_details(order_id)})

    @app.post("/api/orders/<int:order_id>/feedback")
    @role_required("customer")
    def submit_order_feedback_route(order_id):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "A valid product review is required."}), 400
        product_id = payload.get("product_id")
        rating = payload.get("rating")
        if isinstance(product_id, bool) or not isinstance(product_id, int):
            return jsonify({"error": "Choose a valid product to review."}), 400
        user = authenticated_user()
        try:
            feedback = submit_product_feedback(
                order_id,
                product_id,
                user["id"],
                rating,
                payload.get("review"),
            )
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        except IntegrityError:
            return jsonify({"error": "You have already submitted feedback for this product and order."}), 409
        if feedback is None:
            return jsonify({"error": "Feedback is available only for products in your own order."}), 404
        record_activity(
            user["id"],
            session.get("monitoring_session_id"),
            "product_feedback_submitted",
            f"Submitted feedback for product #{product_id} from order #{order_id}.",
            "Product Feedback",
            request.remote_addr,
        )
        return jsonify({"message": "Product feedback submitted successfully.", "feedback": feedback}), 201

    @app.get("/api/products/<int:product_id>/reviews")
    @login_required
    def product_reviews_route(product_id):
        reviews = list_product_feedback(product_id)
        if reviews is None:
            return jsonify({"error": "Product not found."}), 404
        return jsonify(reviews)

    @app.get("/api/product-feedback")
    @login_required
    def product_feedback_list_route():
        user = authenticated_user()
        if user["role"] not in {"admin", "staff"}:
            return jsonify({"error": "You are not authorized to view product feedback."}), 403
        return jsonify({"items": list_all_product_feedback()})

    @app.put("/api/orders/<int:order_id>")
    @login_required
    def update_order_route(order_id):
        user = authenticated_user()
        if user["role"] not in {"admin", "staff"}:
            return jsonify({"error": "You are not authorized to update orders."}), 403
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "A valid order update is required."}), 400
        try:
            order = update_order_status(order_id, payload.get("status", "Pending"), payload.get("reason"), user["id"])
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        if order is None:
            return jsonify({"error": "Order not found."}), 404
        if order["previous_status"] != order["status"]:
            record_activity(user["id"], session.get("monitoring_session_id"), "order_status_updated", f"Changed order #{order_id} status from {order['previous_status']} to {order['status']}.", "Customer Orders", request.remote_addr)
        return jsonify({"message": "Order updated successfully.", "order": get_order_details(order_id)})

    @app.put("/api/orders/<int:order_id>/payment")
    @login_required
    def update_order_payment_route(order_id):
        user = authenticated_user()
        if user["role"] not in {"admin", "staff"}:
            return jsonify({"error": "You are not authorized to update order payments."}), 403
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "A valid payment update is required."}), 400
        try:
            order = update_order_payment_status(order_id, payload.get("payment_status"), user["id"])
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        if order is None:
            return jsonify({"error": "Order not found."}), 404
        record_activity(user["id"], session.get("monitoring_session_id"), "order_payment_updated", f"Recorded payment for order #{order_id}.", "Customer Orders", request.remote_addr)
        return jsonify({"message": "Payment status updated.", "order": order})

    @app.get("/api/sales")
    @login_required
    def sales():
        user = authenticated_user()
        items = list_sales()
        if user["role"] == "customer":
            items = [sale for sale in items if sale["user_id"] == user["id"]]
        return jsonify({"items": items})

    @app.post("/api/sales")
    @login_required
    def create_sale_route():
        payload = request.get_json(silent=True) or {}
        user = authenticated_user()
        items = payload.get("items", [])
        sale = create_sale(user["id"], items, payload.get("payment_method", "cash"))
        if sale is None:
            return jsonify({"error": "Sale requires at least one product."}), 400
        record_activity(user["id"], session.get("monitoring_session_id"), "sale_created", f"Recorded sale #{sale['id']} for {sale['total']:.2f}.", "Sales and Transactions", request.remote_addr)
        return jsonify({"message": "Sale created successfully.", "sale": sale}), 201

    @app.get("/admin/dashboard")
    @role_required("admin")
    def admin_dashboard_page():
        return send_from_directory(DIST_DIR, "index.html")

    @app.get("/staff/dashboard")
    @role_required("staff")
    def staff_dashboard_page():
        return send_from_directory(DIST_DIR, "index.html")

    @app.get("/customer/dashboard")
    @role_required("customer")
    def customer_dashboard_page():
        return send_from_directory(DIST_DIR, "index.html")

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        requested_file = DIST_DIR / path
        if path and requested_file.is_file():
            return send_from_directory(DIST_DIR, path)
        if (DIST_DIR / "index.html").is_file():
            return send_from_directory(DIST_DIR, "index.html")
        return jsonify({"error": "Frontend build not found. Run npm run build in frontend/."}), 404

    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(catalog_bp)
    app.register_blueprint(admin_bp)

    return app


app = create_app()
