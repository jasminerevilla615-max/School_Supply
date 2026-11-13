import os
import re
from pathlib import Path
from contextlib import contextmanager

from dotenv import load_dotenv
from sqlalchemy import URL, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from werkzeug.security import generate_password_hash

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Base(DeclarativeBase):
    pass


def _database_url(database_name=None):
    database = database_name or os.environ.get("DB_NAME", "my_school_supply_db")
    if not re.fullmatch(r"[A-Za-z0-9_]+", database):
        raise ValueError("DB_NAME may contain only letters, numbers, and underscores")
    return URL.create(
        "mysql+pymysql",
        username=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", ""),
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "3306")),
        database=database,
        query={"charset": "utf8mb4"},
    )


def _ensure_database_exists():
    database = os.environ.get("DB_NAME", "my_school_supply_db")
    if not re.fullmatch(r"[A-Za-z0-9_]+", database):
        raise ValueError("DB_NAME may contain only letters, numbers, and underscores")
    server_engine = create_engine(
        _database_url(database_name=None),
        pool_pre_ping=True,
        connect_args={"connect_timeout": 5, "read_timeout": 5, "write_timeout": 5},
    )
    try:
        with server_engine.begin() as connection:
            connection.execute(text(f"CREATE DATABASE IF NOT EXISTS `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))
    except Exception as exc:
        raise RuntimeError(
            "Unable to initialize MySQL. Confirm the MySQL service is running and "
            "DB_HOST, DB_PORT, DB_USER, and DB_PASSWORD are correct in the root .env file."
        ) from exc
    finally:
        server_engine.dispose()

_ensure_database_exists()
engine = create_engine(
    _database_url(),
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args={"connect_timeout": 5, "read_timeout": 5, "write_timeout": 5},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)


@contextmanager
def session_scope():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def initialize_database():
    try:
        from . import models
    except ImportError:
        import models

    existing_tables = set(inspect(engine).get_table_names())
    if not existing_tables:
        Base.metadata.create_all(bind=engine)
    else:
        _migrate_legacy_users()
        _migrate_legacy_products()
        _migrate_legacy_inventory()
        _migrate_legacy_orders()
        _migrate_legacy_notifications()
        _migrate_activity_logs()
    Base.metadata.create_all(bind=engine)
    return models


def _migrate_legacy_users():
    existing_columns = {
        column["name"]: column
        for column in inspect(engine).get_columns("users")
    }
    columns = set(existing_columns)
    statements = []
    if "username" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN username VARCHAR(255) NULL")
    if "password_hash" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL")
    if "position" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN position VARCHAR(100) NULL")
    if "active" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1")
    if "status" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'")
    if "last_login" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN last_login DATETIME NULL")
    if "updated_at" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN updated_at DATETIME NULL")
    if "profile_image_url" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN profile_image_url VARCHAR(255) NULL")
    if "contact_number" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN contact_number VARCHAR(32) NULL")
    if "address_line" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN address_line VARCHAR(255) NULL")
    if "barangay" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN barangay VARCHAR(120) NULL")
    if "city" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN city VARCHAR(120) NULL")
    if "province" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN province VARCHAR(120) NULL")
    if "postal_code" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN postal_code VARCHAR(20) NULL")
    if "auth_version" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN auth_version INT NOT NULL DEFAULT 0")
    username_column = existing_columns.get("username")
    password_hash_column = existing_columns.get("password_hash")
    modify_username = username_column is None or (
        username_column["nullable"]
        or getattr(username_column["type"], "length", None) != 255
        or username_column.get("default") not in {"''", ""}
    )
    modify_password_hash = password_hash_column is None or (
        password_hash_column["nullable"]
        or getattr(password_hash_column["type"], "length", None) != 255
    )

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        if "password" in columns:
            legacy_passwords = connection.execute(text("SELECT id, password FROM users")).all()
            for user_id, password in legacy_passwords:
                connection.execute(text("UPDATE users SET password_hash = :password_hash WHERE id = :user_id"), {"password_hash": generate_password_hash(password), "user_id": user_id})
            connection.execute(text("ALTER TABLE users DROP COLUMN password"))
        if "username" not in columns:
            connection.execute(text("UPDATE users SET username = SUBSTRING_INDEX(email, '@', 1) WHERE username IS NULL"))
        if modify_username:
            connection.execute(text("ALTER TABLE users MODIFY COLUMN username VARCHAR(255) NOT NULL DEFAULT ''"))
        if modify_password_hash:
            connection.execute(text("ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NOT NULL"))
        connection.execute(text("UPDATE users SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL"))


def _migrate_legacy_products():
    columns = {column["name"] for column in inspect(engine).get_columns("products")}
    statements = []
    if "price" not in columns:
        statements.append("ALTER TABLE products ADD COLUMN price DECIMAL(10, 2) NOT NULL DEFAULT 0")
    if "image_url" not in columns:
        statements.append("ALTER TABLE products ADD COLUMN image_url VARCHAR(255) NULL")
    if "unit_cost" not in columns:
        statements.append("ALTER TABLE products ADD COLUMN unit_cost DECIMAL(10, 2) NOT NULL DEFAULT 0")
    if "status" not in columns:
        statements.append("ALTER TABLE products ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'")
    if "updated_at" not in columns:
        statements.append("ALTER TABLE products ADD COLUMN updated_at DATETIME NULL")
    if "selling_price" not in columns:
        statements.append("ALTER TABLE products ADD COLUMN selling_price DECIMAL(10, 2) NOT NULL DEFAULT 0")
    if "product_code" not in columns:
        statements.append("ALTER TABLE products ADD COLUMN product_code VARCHAR(100) NULL")
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        connection.execute(text("UPDATE products SET product_code = CONCAT('SKU-', id) WHERE product_code IS NULL"))
        indexes = {index["name"] for index in inspect(engine).get_indexes("products")}
        if "uq_products_product_code" not in indexes:
            connection.execute(text("CREATE UNIQUE INDEX uq_products_product_code ON products (product_code)"))
        if "selling_price" in columns and "price" not in columns:
            connection.execute(text("UPDATE products SET price = selling_price"))
        if "cost_price" in columns and "unit_cost" not in columns:
            connection.execute(text("UPDATE products SET unit_cost = cost_price"))
        if "product_status" in columns and "status" not in columns:
            connection.execute(text("UPDATE products SET status = product_status"))
        if "selling_price" not in columns:
            connection.execute(text("UPDATE products SET selling_price = price"))
        connection.execute(text("UPDATE products SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL"))


def _migrate_legacy_inventory():
    if "inventory" not in inspect(engine).get_table_names():
        return
    columns = {column["name"] for column in inspect(engine).get_columns("inventory")}
    statements = []
    if "quantity" not in columns:
        statements.append("ALTER TABLE inventory ADD COLUMN quantity INTEGER NOT NULL DEFAULT 0")
    if "location" not in columns:
        statements.append("ALTER TABLE inventory ADD COLUMN location VARCHAR(100) NULL")
    if "updated_at" not in columns:
        statements.append("ALTER TABLE inventory ADD COLUMN updated_at DATETIME NULL")
    if "stock_in_hand" not in columns:
        statements.append("ALTER TABLE inventory ADD COLUMN stock_in_hand INTEGER NOT NULL DEFAULT 0")
    if "last_updated" not in columns:
        statements.append("ALTER TABLE inventory ADD COLUMN last_updated DATETIME NULL")
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        if "quantity" not in columns and "stock_in_hand" in columns:
            connection.execute(text("UPDATE inventory SET quantity = stock_in_hand"))
        if "stock_in_hand" not in columns:
            connection.execute(text("UPDATE inventory SET stock_in_hand = quantity"))
        if "location" not in columns:
            connection.execute(text("UPDATE inventory SET location = 'main'"))
        if "updated_at" not in columns and "last_updated" in columns:
            connection.execute(text("UPDATE inventory SET updated_at = last_updated"))
        if "last_updated" not in columns:
            connection.execute(text("UPDATE inventory SET last_updated = COALESCE(updated_at, CURRENT_TIMESTAMP)"))
        if "updated_at" not in columns:
            connection.execute(text("UPDATE inventory SET updated_at = last_updated"))


def _migrate_legacy_orders():
    if "orders" not in inspect(engine).get_table_names():
        return
    columns = {column["name"] for column in inspect(engine).get_columns("orders")}
    statements = []
    if "stock_reserved" not in columns:
        statements.append("ALTER TABLE orders ADD COLUMN stock_reserved TINYINT(1) NOT NULL DEFAULT 0")
    if "payment_method" not in columns:
        statements.append("ALTER TABLE orders ADD COLUMN payment_method VARCHAR(50) NOT NULL DEFAULT 'unknown'")
    if "payment_status" not in columns:
        statements.append("ALTER TABLE orders ADD COLUMN payment_status VARCHAR(30) NOT NULL DEFAULT 'unknown'")
    if "rejection_reason" not in columns:
        statements.append("ALTER TABLE orders ADD COLUMN rejection_reason TEXT NULL")
    if "idempotency_key" not in columns:
        statements.append("ALTER TABLE orders ADD COLUMN idempotency_key VARCHAR(64) NULL")
    if "updated_at" not in columns:
        statements.append("ALTER TABLE orders ADD COLUMN updated_at DATETIME NULL")
    if "received_at" not in columns:
        statements.append("ALTER TABLE orders ADD COLUMN received_at DATETIME NULL")
    for column, definition in (
        ("customer_name_snapshot", "VARCHAR(255) NULL"),
        ("customer_email_snapshot", "VARCHAR(255) NULL"),
        ("contact_number", "VARCHAR(32) NULL"),
        ("address_line", "VARCHAR(255) NULL"),
        ("barangay", "VARCHAR(120) NULL"),
        ("city", "VARCHAR(120) NULL"),
        ("province", "VARCHAR(120) NULL"),
        ("postal_code", "VARCHAR(20) NULL"),
    ):
        if column not in columns:
            statements.append(f"ALTER TABLE orders ADD COLUMN {column} {definition}")
    indexes = inspect(engine).get_indexes("orders")
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        if not any(index.get("unique") and index.get("column_names") == ["idempotency_key"] for index in indexes):
            connection.execute(text("CREATE UNIQUE INDEX uq_orders_idempotency_key ON orders (idempotency_key)"))


def _migrate_legacy_notifications():
    if "notifications" not in inspect(engine).get_table_names():
        return
    columns = {column["name"]: column for column in inspect(engine).get_columns("notifications")}
    statements = []
    if "related_type" not in columns:
        statements.append("ALTER TABLE notifications ADD COLUMN related_type VARCHAR(30) NULL")
    if "related_id" not in columns:
        statements.append("ALTER TABLE notifications ADD COLUMN related_id VARCHAR(64) NULL")
    if "event_key" not in columns:
        statements.append("ALTER TABLE notifications ADD COLUMN event_key VARCHAR(128) NULL")
    indexes = {index["name"] for index in inspect(engine).get_indexes("notifications")}
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        if "product_id" in columns and not columns["product_id"]["nullable"]:
            connection.execute(text("ALTER TABLE notifications MODIFY COLUMN product_id INTEGER NULL"))
        if "uq_notification_product_recipient" in indexes:
            connection.execute(text("ALTER TABLE notifications DROP INDEX uq_notification_product_recipient"))
        if "uq_notifications_event_key" not in indexes:
            connection.execute(text("CREATE UNIQUE INDEX uq_notifications_event_key ON notifications (event_key)"))


def _migrate_activity_logs():
    if "activity_logs" not in inspect(engine).get_table_names():
        return
    inspector = inspect(engine)
    columns = {column["name"]: column for column in inspector.get_columns("activity_logs")}
    foreign_keys = inspector.get_foreign_keys("activity_logs")
    user_fk = next((foreign_key for foreign_key in foreign_keys if foreign_key["constrained_columns"] == ["user_id"]), None)
    statements = []
    for column, definition in (
        ("user_name", "VARCHAR(255) NULL"),
        ("username", "VARCHAR(255) NULL"),
        ("user_role", "VARCHAR(20) NULL"),
    ):
        if column not in columns:
            statements.append(f"ALTER TABLE activity_logs ADD COLUMN {column} {definition}")

    indexes = {index["name"] for index in inspector.get_indexes("activity_logs")}
    needs_user_fk_update = bool(user_fk and (
        not columns.get("user_id", {}).get("nullable")
        or str(user_fk.get("options", {}).get("ondelete", "")).upper() != "SET NULL"
    ))
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        if needs_user_fk_update and user_fk and user_fk["name"]:
            connection.execute(text(f"ALTER TABLE activity_logs DROP FOREIGN KEY `{user_fk['name']}`"))
        if "user_id" in columns and not columns["user_id"]["nullable"]:
            connection.execute(text("ALTER TABLE activity_logs MODIFY COLUMN user_id INTEGER NULL"))
        connection.execute(text(
            "UPDATE activity_logs a LEFT JOIN users u ON u.id = a.user_id "
            "SET a.user_name = COALESCE(a.user_name, u.name), "
            "a.username = COALESCE(a.username, u.username), "
            "a.user_role = COALESCE(a.user_role, u.role) "
            "WHERE a.user_name IS NULL OR a.username IS NULL OR a.user_role IS NULL"
        ))
        if needs_user_fk_update or not user_fk:
            connection.execute(text(
                "ALTER TABLE activity_logs ADD CONSTRAINT fk_activity_logs_user "
                "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL"
            ))
        if "ix_activity_logs_created_at" not in indexes:
            connection.execute(text("CREATE INDEX ix_activity_logs_created_at ON activity_logs (created_at)"))
        if "ix_activity_logs_module_action" not in indexes:
            connection.execute(text("CREATE INDEX ix_activity_logs_module_action ON activity_logs (module, action)"))
