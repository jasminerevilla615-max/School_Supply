from functools import wraps

from flask import current_app, jsonify, redirect, request, session
from sqlalchemy.exc import SQLAlchemyError

try:
    from .database import get_user_by_id, start_user_session, touch_user_session
except ImportError:
    from database import get_user_by_id, start_user_session, touch_user_session


def authenticated_user():
    session_user = session.get("user")
    if not session_user or not session_user.get("user_id"):
        return None
    user = get_user_by_id(session_user["user_id"])
    if user is None or session_user.get("auth_version", 0) != user["auth_version"]:
        session.clear()
        return None
    return user


def set_authenticated_session(user):
    session.permanent = True
    session["user"] = {
        "user_id": user["id"],
        "role": user["role"],
        "authenticated": True,
        "auth_version": user.get("auth_version", 0),
    }


def ensure_presence(user):
    if session.get("monitoring_unavailable"):
        return None
    try:
        session_id = session.get("monitoring_session_id")
        if not session_id or not touch_user_session(user["id"], session_id):
            session["monitoring_session_id"] = start_user_session(user["id"], request.remote_addr)
        return session["monitoring_session_id"]
    except SQLAlchemyError:
        session.pop("monitoring_session_id", None)
        session["monitoring_unavailable"] = True
        current_app.logger.exception("Unable to update user-session monitoring.")
        return None


def _unauthenticated_response():
    session.clear()
    if request.path.startswith("/api/"):
        return jsonify({"error": "Your session has expired. Please sign in again."}), 401
    return redirect("/login")


def login_required(view):
    @wraps(view)
    def protected_view(*args, **kwargs):
        user = authenticated_user()
        if user is None:
            return _unauthenticated_response()
        set_authenticated_session(user)
        return view(*args, **kwargs)

    return protected_view


def role_required(role):
    def decorator(view):
        @wraps(view)
        def protected_view(*args, **kwargs):
            user = authenticated_user()
            if user is None:
                return _unauthenticated_response()
            if user["role"].strip().lower() != role.strip().lower():
                return jsonify({"error": "You are not authorized to access this page."}), 403
            set_authenticated_session(user)
            return view(*args, **kwargs)

        return protected_view

    return decorator
