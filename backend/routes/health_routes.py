from flask import Blueprint, jsonify
from sqlalchemy import text

from ..db import engine

health_bp = Blueprint("health_bp", __name__)


@health_bp.get("/api/health")
def health_check():
    return jsonify({"status": "ok"})


@health_bp.get("/api/test-db")
def test_db():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return jsonify({"success": True, "message": "MySQL database connected successfully!"})
    except Exception as exc:  # pragma: no cover - direct database diagnostics
        return jsonify({"success": False, "message": str(exc), "error": type(exc).__name__}), 500
