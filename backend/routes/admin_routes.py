from flask import Blueprint, jsonify, request, session
from datetime import date

from ..auth import authenticated_user, role_required
from ..database import (
    create_managed_user,
    delete_staff_account,
    get_activity_logs,
    get_admin_activity_page,
    get_admin_dashboard_overview,
    get_monitoring_stats,
    get_monitoring_users,
    get_sales_analytics,
    get_session_history,
    record_activity,
    set_user_status,
    update_staff_account,
)

admin_bp = Blueprint("admin_bp", __name__)


@admin_bp.get("/api/admin/activity-logs")
@role_required("admin")
def admin_activity_logs():
    search = request.args.get("search", "").strip()
    role = request.args.get("role", "").strip().lower()
    action_group = request.args.get("action", "").strip().lower()
    module = request.args.get("module", "").strip()
    sort_by = request.args.get("sort_by", "created_at").strip()
    sort_direction = request.args.get("sort_direction", "desc").strip().lower()
    if len(search) > 200:
        return jsonify({"error": "Search text must be 200 characters or fewer."}), 400
    if role and role not in {"admin", "staff", "customer"}:
        return jsonify({"error": "Choose a valid user role."}), 400
    if action_group and action_group not in {"login", "create", "update", "delete", "view", "order", "inventory_update", "report", "other"}:
        return jsonify({"error": "Choose a valid action filter."}), 400
    if sort_by not in {"created_at", "user", "role", "action", "module"} or sort_direction not in {"asc", "desc"}:
        return jsonify({"error": "Choose a valid sort order."}), 400
    page = request.args.get("page", default=1, type=int)
    page_size = request.args.get("page_size", default=10, type=int)
    user_value = request.args.get("user_id", "").strip()
    try:
        user_id = int(user_value) if user_value else None
    except ValueError:
        return jsonify({"error": "Choose a valid user."}), 400
    if page < 1 or page_size < 1 or page_size > 100 or (user_id is not None and user_id < 1):
        return jsonify({"error": "Page, page size, or user selection is invalid."}), 400
    start_value, end_value = request.args.get("start_date", "").strip(), request.args.get("end_date", "").strip()
    try:
        start_date = date.fromisoformat(start_value) if start_value else None
        end_date = date.fromisoformat(end_value) if end_value else None
    except ValueError:
        return jsonify({"error": "Choose valid activity dates."}), 400
    if start_date and end_date and start_date > end_date:
        return jsonify({"error": "The start date must be on or before the end date."}), 400
    return jsonify(get_admin_activity_page(
        page=page,
        page_size=page_size,
        search=search,
        user_id=user_id,
        role=role,
        action_group=action_group,
        module=module,
        start_date=start_date.isoformat() if start_date else None,
        end_date=end_date.isoformat() if end_date else None,
        sort_by=sort_by,
        sort_direction=sort_direction,
    ))


@admin_bp.get("/api/admin/analytics")
@role_required("admin")
def admin_analytics():
    today = date.today()
    start_value = request.args.get("start_date") or today.replace(day=1).isoformat()
    end_value = request.args.get("end_date") or today.isoformat()
    try:
        start_date = date.fromisoformat(start_value)
        end_date = date.fromisoformat(end_value)
    except (TypeError, ValueError):
        return jsonify({"error": "Choose valid start and end dates."}), 400
    if start_date > end_date:
        return jsonify({"error": "The start date must be on or before the end date."}), 400
    product_value = request.args.get("product_id")
    category_value = request.args.get("category_id")
    try:
        product_id = int(product_value) if product_value else None
        category_id = int(category_value) if category_value else None
    except ValueError:
        return jsonify({"error": "Product and category filters must be valid IDs."}), 400
    if (product_id is not None and product_id < 1) or (category_id is not None and category_id < 1):
        return jsonify({"error": "Product and category filters must be valid IDs."}), 400
    return jsonify(get_sales_analytics(
        start_date.isoformat(),
        end_date.isoformat(),
        product_id=product_id,
        category_id=category_id,
        order_status=request.args.get("order_status", "").strip(),
        sale_status=request.args.get("sale_status", "").strip(),
    ))


@admin_bp.get("/api/admin/dashboard/overview")
@role_required("admin")
def admin_dashboard_overview():
    return jsonify(get_admin_dashboard_overview())


@admin_bp.post("/api/admin/users")
@role_required("admin")
def create_admin_managed_user():
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "")
    name = payload.get("name", "")
    email = payload.get("email", "")
    password = payload.get("password", "")
    position = payload.get("position", "")
    confirmation = payload.get("confirm_password", "")
    if not isinstance(username, str) or not username.strip():
        return jsonify({"error": "Enter a username."}), 400
    if not isinstance(name, str) or not name.strip() or not isinstance(position, str) or not position.strip():
        return jsonify({"error": "Full name and position are required."}), 400
    if not isinstance(email, str) or not re_fullmatch_email(email.strip().lower()):
        return jsonify({"error": "Use a valid Gmail address."}), 400
    if not valid_password(password):
        return jsonify({"error": "Use at least 8 characters with upper, lower, and numeric characters."}), 400
    if password != confirmation:
        return jsonify({"error": "Passwords do not match."}), 400
    try:
        created = create_managed_user(username.strip(), name.strip(), email.strip().lower(), password, position.strip())
    except ValueError:
        return jsonify({"error": "Invalid role."}), 400
    if not created:
        return jsonify({"error": "That email address or username is already in use."}), 409
    admin = authenticated_user()
    record_activity(admin["id"], session["monitoring_session_id"], "account_created", f"Created staff account {name.strip()} ({username.strip()})", "Staff Management", request.remote_addr)
    return jsonify({"message": "Staff account created successfully.", "username": username.strip(), "email": email.strip().lower(), "role": "staff", "status": "active"}), 201


@admin_bp.patch("/api/admin/users/<email>/status")
@role_required("admin")
def update_user_status(email):
    payload = request.get_json(silent=True) or {}
    status = payload.get("status")
    if status not in {"active", "inactive", "suspended"}:
        return jsonify({"error": "Status must be active, inactive, or suspended."}), 400
    if not set_user_status(email.strip().lower(), status):
        return jsonify({"error": "User not found."}), 404
    user = authenticated_user()
    record_activity(user["id"], session["monitoring_session_id"], "account_status_changed", f"Changed account status for {email.strip().lower()} to {status}.", "User Management", request.remote_addr)
    return jsonify({"message": "Account status updated."})


@admin_bp.patch("/api/admin/staff/<email>")
@role_required("admin")
def edit_staff_account(email):
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "")
    name = payload.get("name", "")
    new_email = payload.get("email", "")
    position = payload.get("position", "")
    password = payload.get("password")
    confirmation = payload.get("confirm_password")
    if not isinstance(username, str) or not username.strip():
        return jsonify({"error": "Enter a username."}), 400
    if not isinstance(name, str) or not name.strip() or not isinstance(position, str) or not position.strip():
        return jsonify({"error": "Full name and position are required."}), 400
    if not isinstance(new_email, str) or not re_fullmatch_email(new_email.strip().lower()) or new_email.strip().lower() == "admin@gmail.com":
        return jsonify({"error": "Use a valid staff email."}), 400
    if password is not None:
        if not valid_password(password):
            return jsonify({"error": "Use at least 8 characters with upper, lower, and numeric characters."}), 400
        if password != confirmation:
            return jsonify({"error": "Passwords do not match."}), 400
    updated = update_staff_account(email.strip().lower(), username.strip(), name.strip(), new_email.strip().lower(), position.strip(), password)
    if not updated:
        return jsonify({"error": "Staff account not found or the email address or username is already in use."}), 409
    admin = authenticated_user()
    record_activity(admin["id"], session["monitoring_session_id"], "staff_updated", f"Updated staff account {name.strip()} ({username.strip()}).", "Staff Management", request.remote_addr)
    return jsonify({"message": "Staff account updated."})


@admin_bp.delete("/api/admin/staff/<email>")
@role_required("admin")
def delete_staff(email):
    user = authenticated_user()
    if not delete_staff_account(email.strip().lower()):
        return jsonify({"error": "Staff account not found."}), 404
    record_activity(user["id"], session["monitoring_session_id"], "staff_deleted", f"Deleted staff account {email.strip().lower()}.", "Staff Management", request.remote_addr)
    return jsonify({"message": "Staff account deleted."})


@admin_bp.get("/api/admin/monitoring/stats")
@role_required("admin")
def monitoring_stats():
    return jsonify(get_monitoring_stats())


@admin_bp.get("/api/admin/monitoring/users")
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


@admin_bp.get("/api/admin/monitoring/sessions")
@role_required("admin")
def monitoring_sessions():
    return jsonify(get_session_history(
        user_id=request.args.get("user_id", type=int),
        start_date=request.args.get("start_date"),
        end_date=request.args.get("end_date"),
    ))


@admin_bp.get("/api/admin/monitoring/activity")
@role_required("admin")
def monitoring_activity():
    return jsonify(get_activity_logs(
        user_id=request.args.get("user_id", type=int),
        action=request.args.get("action", ""),
        start_date=request.args.get("start_date"),
        end_date=request.args.get("end_date"),
        search=request.args.get("search", ""),
    ))


def re_fullmatch_email(value):
    import re

    return isinstance(value, str) and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value) is not None


def valid_password(password):
    return (
        isinstance(password, str)
        and len(password) >= 8
        and any(character.islower() for character in password)
        and any(character.isupper() for character in password)
        and any(character.isdigit() for character in password)
    )
