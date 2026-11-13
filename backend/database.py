from datetime import datetime, timedelta

from decimal import Decimal
import re

from sqlalchemy import func, inspect, or_, select, text
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

try:
    from .db import engine, session_scope
    from .models import ActivityLog, Category, Inventory, Notification, Order, OrderItem, OrderStatusHistory, Product, ProductFeedback, Sale, SaleItem, SystemSetting, User, UserSession
except ImportError:
    from db import engine, session_scope
    from models import ActivityLog, Category, Inventory, Notification, Order, OrderItem, OrderStatusHistory, Product, ProductFeedback, Sale, SaleItem, SystemSetting, User, UserSession

VALID_ROLES = {"admin", "staff", "customer"}
MANAGED_ROLES = {"admin", "staff"}
ACCOUNT_STATUSES = {"active", "inactive", "suspended"}
CUSTOMER_LIMIT = 500
GENERIC_LOGIN_ERROR = "Invalid Gmail/Email or password."
PRESENCE_TIMEOUT_SECONDS = 90
SYSTEM_SETTINGS_KEY = "application"
DEFAULT_SYSTEM_SETTINGS = {
    "store": {"name": "SchoolSupply", "email": "", "phone": "", "address": "", "logo_url": ""},
    "preferences": {"currency": "PHP", "time_zone": "Asia/Manila", "date_format": "DD/MM/YYYY", "language": "en"},
    "notifications": {"customer_orders": True, "low_stock": True, "supplier_updates": False, "daily_summary": True},
    "security": {"session_timeout_minutes": 30},
    "inventory": {"low_stock_threshold": 5, "automatic_alerts": True},
}


class CheckoutValidationError(ValueError):
    def __init__(self, field_errors: dict[str, str]):
        self.field_errors = field_errors
        super().__init__("Please correct the highlighted customer information.")


DEMO_ACCOUNTS = [("Admin User", "admin@gmail.com", "admin", "admin")]
PRODUCT_PHOTOS = {
    "Student Arm Chair": "/product-images/product-01.jpeg",
    "Teacher Table": "/product-images/product-02.jpeg",
    "Student Desk": "/product-images/product-03.jpeg",
    "Spiral Notebook": "/product-images/product-04.jpeg",
    "Composition Notebook": "/product-images/product-05.jpeg",
    "Hardbound Notebook": "/product-images/product-06.jpeg",
    "Pocket Notebook": "/product-images/product-07.jpeg",
    "Ballpoint Pen - Blue": "/product-images/product-08.jpeg",
    "Ballpoint Pen - Black": "/product-images/product-09.jpeg",
    "Ballpoint Pen - Red": "/product-images/product-10.jpeg",
    "Mechanical Pencil": "/product-images/product-11.jpeg",
    "Wooden Pencil": "/product-images/product-12.jpeg",
    "Highlighter": "/product-images/product-13.jpeg",
    "Permanent Marker": "/product-images/product-14.jpeg",
    "Pencil Case": "/product-images/product-15.jpeg",
    "Desk Organizer": "/product-images/product-16.jpeg",
    "Paper Clips": "/product-images/product-17.jpeg",
    "Binder Clips": "/product-images/product-18.jpeg",
    "Stapler": "/product-images/product-19.jpeg",
    "Basic School Backpack": "/product-images/product-20.jpeg",
    "Student Backpack": "/product-images/product-21.jpeg",
    "Laptop Backpack": "/product-images/product-22.jpeg",
    "Drawstring Bag": "/product-images/product-23.jpeg",
    "Bond Paper A4": "/product-images/product-24.jpeg",
    "Bond Paper Letter": "/product-images/product-25.jpeg",
    "Colored Paper": "/product-images/product-26.jpeg",
    "Color Pencils": "/product-images/product-27.jpeg",
    "Crayons": "/product-images/product-28.jpeg",
    "Watercolor Set": "/product-images/product-29.jpeg",
    "Paint Brush Set": "/product-images/product-30.jpeg",
    "Drawing Pad": "/product-images/product-31.jpeg",
    "Scissors": "/product-images/product-32.jpeg",
    "Glue Stick": "/product-images/product-33.jpeg",
    "Liquid Glue": "/product-images/product-34.jpeg",
    "Ruler 30cm": "/product-images/product-35.jpeg",
    "Correction Tape": "/product-images/product-36.jpeg",
    "Eraser": "/product-images/product-37.jpeg",
    "Sharpener": "/product-images/product-38.jpeg",
    "Calculator": "/product-images/product-39.jpeg",
}


def get_system_settings():
    with session_scope() as session:
        setting = session.get(SystemSetting, SYSTEM_SETTINGS_KEY)
        if setting is None:
            return {key: value.copy() for key, value in DEFAULT_SYSTEM_SETTINGS.items()}
        return {
            key: {**defaults, **(setting.setting_value.get(key) or {})}
            for key, defaults in DEFAULT_SYSTEM_SETTINGS.items()
        }


def save_system_settings(values):
    with session_scope() as session:
        setting = session.get(SystemSetting, SYSTEM_SETTINGS_KEY)
        if setting is None:
            setting = SystemSetting(setting_key=SYSTEM_SETTINGS_KEY, setting_value=values)
            session.add(setting)
        else:
            setting.setting_value = values
        return values


def get_admin_dashboard_overview():
    now = datetime.utcnow()
    year_start = datetime(now.year, 1, 1)
    first_day = now.date() - timedelta(days=13)
    daily_start = datetime.combine(first_day, datetime.min.time())

    inspector = inspect(engine)
    table_columns = {
        table: {column["name"] for column in inspector.get_columns(table)}
        for table in ("orders", "sales", "sale_items")
    }

    def column(table, *choices):
        match = next((candidate for candidate in choices if candidate in table_columns[table]), None)
        if match is None:
            raise RuntimeError(f"The {table} table is missing a required dashboard column.")
        return f"`{match}`"

    order_date = column("orders", "created_at", "order_date")
    order_total = column("orders", "total", "total_amount")
    sale_date = column("sales", "created_at", "sale_date")
    sale_total = column("sales", "total", "total_amount")
    sale_item_quantity = column("sale_items", "quantity")
    sale_item_revenue = column("sale_items", "total", "subtotal")
    successful_sale_statuses = {"completed_status": "completed", "paid_status": "paid"}

    with session_scope() as session:
        total_products = session.scalar(select(func.count(Product.id))) or 0
        total_categories = session.scalar(select(func.count(Category.id))) or 0
        total_customers = session.scalar(select(func.count(User.id)).where(User.role == "customer")) or 0
        total_staff = session.scalar(select(func.count(User.id)).where(User.role == "staff")) or 0
        pending_orders = session.scalar(text("SELECT COUNT(*) FROM orders WHERE LOWER(status) = 'pending'")) or 0
        completed_orders = session.scalar(text("SELECT COUNT(*) FROM orders WHERE LOWER(status) = 'completed'")) or 0
        total_sales = session.scalar(
            text(f"SELECT COALESCE(SUM({sale_total}), 0) FROM sales WHERE LOWER(status) IN (:completed_status, :paid_status)"),
            successful_sale_statuses,
        ) or 0
        low_stock_threshold = _low_stock_threshold(session)
        low_stock_products = session.scalars(
            select(Product).where(Product.stock <= low_stock_threshold).order_by(Product.stock, Product.name).limit(8)
        ).all()
        low_stock_count = session.scalar(select(func.count(Product.id)).where(Product.stock <= low_stock_threshold)) or 0
        order_status_rows = session.execute(
            text("SELECT status, COUNT(*) AS total FROM orders GROUP BY status ORDER BY status")
        ).all()
        daily_sales_rows = session.execute(
            text(
                f"SELECT DATE({sale_date}) AS sale_day, COALESCE(SUM({sale_total}), 0) AS total "
                f"FROM sales WHERE LOWER(status) IN (:completed_status, :paid_status) AND {sale_date} >= :daily_start "
                f"GROUP BY DATE({sale_date}) ORDER BY DATE({sale_date})"
            ),
            {"daily_start": daily_start, **successful_sale_statuses},
        ).all()
        monthly_sales_rows = session.execute(
            text(
                f"SELECT MONTH({sale_date}) AS sale_month, COALESCE(SUM({sale_total}), 0) AS total "
                f"FROM sales WHERE LOWER(status) IN (:completed_status, :paid_status) AND {sale_date} >= :year_start "
                f"AND {sale_date} <= :now GROUP BY MONTH({sale_date}) ORDER BY MONTH({sale_date})"
            ),
            {"year_start": year_start, "now": now, **successful_sale_statuses},
        ).all()
        best_sellers_rows = session.execute(
            text(
                f"SELECT p.id, p.name, p.image_url, COALESCE(SUM(si.{sale_item_quantity}), 0) AS quantity_sold, "
                f"COALESCE(SUM(si.{sale_item_revenue}), 0) AS revenue "
                "FROM sale_items si JOIN sales s ON s.id = si.sale_id "
                "JOIN products p ON p.id = si.product_id "
                "WHERE LOWER(s.status) IN (:completed_status, :paid_status) "
                "GROUP BY p.id, p.name, p.image_url "
                f"ORDER BY SUM(si.{sale_item_quantity}) DESC, p.name LIMIT 5"
            ),
            successful_sale_statuses,
        ).all()
        recent_order_rows = session.execute(
            text(
                f"SELECT o.id, o.user_id, u.name AS customer_name, o.{order_date} AS created_at, "
                f"o.{order_total} AS total, o.status FROM orders o "
                "LEFT JOIN users u ON u.id = o.user_id "
                f"ORDER BY o.{order_date} DESC, o.id DESC LIMIT 6"
            )
        ).all()
        recent_sale_rows = session.execute(
            text(
                f"SELECT s.id, s.user_id, u.name AS customer_name, s.{sale_date} AS created_at, "
                f"s.{sale_total} AS total, s.payment_method, s.status FROM sales s "
                f"LEFT JOIN users u ON u.id = s.user_id ORDER BY s.{sale_date} DESC, s.id DESC LIMIT 6"
            )
        ).all()

    daily_sales = {day.isoformat(): float(amount) for day, amount in daily_sales_rows}
    monthly_sales = {int(month): float(amount) for month, amount in monthly_sales_rows}
    return {
        "metrics": {
            "total_products": total_products,
            "total_categories": total_categories,
            "total_customers": total_customers,
            "total_staff": total_staff,
            "pending_orders": pending_orders,
            "completed_orders": completed_orders,
            "low_stock_products": low_stock_count,
            "total_sales": float(total_sales),
        },
        "daily_sales": [
            {
                "date": (first_day + timedelta(days=offset)).isoformat(),
                "total": daily_sales.get((first_day + timedelta(days=offset)).isoformat(), 0),
            }
            for offset in range(14)
        ],
        "monthly_sales": [
            {"month": month, "total": monthly_sales.get(month, 0)}
            for month in range(1, now.month + 1)
        ],
        "order_statuses": [{"status": status, "count": count} for status, count in order_status_rows],
        "best_sellers": [
            {"id": product_id, "name": name, "image_url": image_url, "quantity_sold": int(quantity), "revenue": float(revenue)}
            for product_id, name, image_url, quantity, revenue in best_sellers_rows
        ],
        "recent_orders": [
            {
                "id": row.id,
                "customer": row.customer_name or "Guest",
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "total": float(row.total or 0),
                "status": row.status,
            }
            for row in recent_order_rows
        ],
        "low_stock": [
            {"id": product.id, "name": product.name, "image_url": product.image_url, "stock": product.stock}
            for product in low_stock_products
        ],
        "recent_sales": [
            {
                "id": row.id,
                "customer": row.customer_name or "Guest",
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "total": float(row.total or 0),
                "payment_method": row.payment_method,
                "status": row.status,
            }
            for row in recent_sale_rows
        ],
        "generated_at": now.isoformat(),
    }


def get_sales_analytics(start_date, end_date, product_id=None, category_id=None, order_status=None, sale_status=None):
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    required_tables = {"orders", "order_items", "products", "users", "categories"}
    if not required_tables.issubset(tables):
        raise RuntimeError("The database is missing tables required for the sales report.")

    columns = {
        table: {column["name"] for column in inspector.get_columns(table)}
        for table in required_tables | ({"sales"} if "sales" in tables else set())
    }

    def column(table, *choices):
        match = next((candidate for candidate in choices if candidate in columns[table]), None)
        if match is None:
            raise RuntimeError(f"The {table} table is missing a required sales-report column.")
        return f"`{match}`"

    order_date = column("orders", "created_at", "order_date")
    order_total = column("orders", "total", "total_amount")
    item_quantity = column("order_items", "quantity")
    item_total = next((name for name in ("total", "subtotal") if name in columns["order_items"]), None)
    item_price = next((name for name in ("unit_price", "price") if name in columns["order_items"]), None)
    item_amount = f"oi.`{item_total}`" if item_total else f"(oi.{item_quantity} * oi.`{item_price}`)" if item_price else "0"
    sales_join = ""
    sale_status_sql = "'Not recorded'"
    payment_method_sql = "'—'"
    sale_revenue_sql = "0"
    if "sales" in tables and "order_id" in columns["sales"]:
        sale_status_column = column("sales", "status") if "status" in columns["sales"] else "'Not recorded'"
        sale_method = column("sales", "payment_method") if "payment_method" in columns["sales"] else "'—'"
        sale_total = column("sales", "total", "total_amount") if ({"total", "total_amount"} & columns["sales"]) else "0"
        sales_join = (
            " LEFT JOIN (SELECT `order_id`, MAX(" + sale_status_column + ") AS sale_status, "
            "MAX(" + sale_method + ") AS payment_method, COALESCE(SUM(" + sale_total + "), 0) AS revenue "
            "FROM `sales` GROUP BY `order_id`) sa ON sa.order_id = o.id"
        )
        sale_status_sql = "COALESCE(sa.sale_status, 'Not recorded')"
        payment_method_sql = "COALESCE(sa.payment_method, '—')"
        sale_revenue_sql = "COALESCE(sa.revenue, 0)"

    predicates = ["DATE(o." + order_date + ") >= :start_date", "DATE(o." + order_date + ") <= :end_date"]
    parameters = {"start_date": start_date, "end_date": end_date}
    if order_status:
        predicates.append("LOWER(o.`status`) = :order_status")
        parameters["order_status"] = order_status.strip().lower()
    if sale_status and "sales" in tables:
        predicates.append("LOWER(" + sale_status_sql + ") = :sale_status")
        parameters["sale_status"] = sale_status.strip().lower()
    if product_id is not None or category_id is not None:
        predicates.append(
            "EXISTS (SELECT 1 FROM `order_items` filter_oi "
            "JOIN `products` filter_p ON filter_p.id = filter_oi.product_id "
            "WHERE filter_oi.order_id = o.id"
            + (" AND filter_p.id = :product_id" if product_id is not None else "")
            + (" AND filter_p.category_id = :category_id" if category_id is not None else "")
            + ")"
        )
        if product_id is not None:
            parameters["product_id"] = product_id
        if category_id is not None:
            parameters["category_id"] = category_id
    where_sql = " AND ".join(predicates)
    order_subquery = (
        "SELECT o.id, o.user_id, o." + order_date + " AS order_date, o." + order_total + " AS order_total, "
        "o.`status` AS order_status, " + sale_status_sql + " AS sale_status, "
        + payment_method_sql + " AS payment_method, " + sale_revenue_sql + " AS revenue "
        "FROM `orders` o LEFT JOIN `users` u ON u.id = o.user_id"
        + sales_join + " WHERE " + where_sql
    )
    line_amount = item_amount
    with session_scope() as session:
        summary_row = session.execute(
            text(
                "SELECT COUNT(*) AS order_count, COALESCE(SUM(filtered.order_total), 0) AS total_sales, "
                "COALESCE(SUM(CASE WHEN LOWER(filtered.sale_status) IN ('completed', 'paid') "
                "THEN filtered.revenue ELSE 0 END), 0) AS total_revenue "
                "FROM (" + order_subquery + ") filtered"
            ),
            parameters,
        ).one()
        status_rows = session.execute(
            text(
                "SELECT filtered.order_status AS status, COUNT(*) AS count "
                "FROM (" + order_subquery + ") filtered GROUP BY filtered.order_status ORDER BY filtered.order_status"
            ),
            parameters,
        ).all()
        order_rows = session.execute(
            text(
                "SELECT filtered.id, filtered.order_date, filtered.order_total, filtered.order_status, "
                "filtered.sale_status, filtered.payment_method, filtered.revenue, "
                "COALESCE(u.name, 'Guest') AS customer_name, oi.id AS order_item_id, "
                "COALESCE(p.name, '—') AS product_name, COALESCE(c.name, '—') AS category_name, "
                "COALESCE(oi." + item_quantity + ", 0) AS quantity, COALESCE(" + line_amount + ", 0) AS line_amount "
                "FROM (" + order_subquery + ") filtered "
                "LEFT JOIN `users` u ON u.id = filtered.user_id "
                "LEFT JOIN `order_items` oi ON oi.order_id = filtered.id "
                "LEFT JOIN `products` p ON p.id = oi.product_id "
                "LEFT JOIN `categories` c ON c.id = p.category_id "
                + ("WHERE (p.id = :product_id OR p.id IS NULL) " if product_id is not None else "")
                + ("AND " if product_id is not None and category_id is not None else "WHERE " if category_id is not None else "")
                + ("(p.category_id = :category_id OR p.id IS NULL) " if category_id is not None else "")
                + "ORDER BY filtered.order_date DESC, filtered.id DESC, oi.id"
            ),
            parameters,
        ).all()
        order_status_options = session.execute(
            text("SELECT DISTINCT `status` FROM `orders` WHERE `status` IS NOT NULL ORDER BY `status`")
        ).scalars().all()
        sale_status_options = []
        if "sales" in tables and "status" in columns["sales"]:
            sale_status_options = session.execute(
                text("SELECT DISTINCT `status` FROM `sales` WHERE `status` IS NOT NULL ORDER BY `status`")
            ).scalars().all()
        categories = session.execute(
            text("SELECT id, name FROM `categories` ORDER BY name")
        ).all()
        products = session.execute(
            text("SELECT id, name, category_id FROM `products` ORDER BY name")
        ).all()

    rows = []
    daily_totals = {}
    monthly_totals = {}
    status_counts = {str(row.status or "Unknown").lower(): int(row.count) for row in status_rows}
    product_totals = {}
    for row in order_rows:
        order_day = row.order_date.date().isoformat() if hasattr(row.order_date, "date") else str(row.order_date)[:10]
        rows.append({
            "order_id": row.id,
            "order_date": row.order_date.isoformat() if hasattr(row.order_date, "isoformat") else str(row.order_date),
            "customer_name": row.customer_name,
            "product_name": row.product_name,
            "category_name": row.category_name,
            "quantity": int(row.quantity or 0),
            "line_amount": float(row.line_amount or 0),
            "order_total": float(row.order_total or 0),
            "sale_status": row.sale_status or "Not recorded",
            "payment_method": row.payment_method or "—",
            "order_status": row.order_status or "Unknown",
        })
        if row.order_item_id is not None:
            product = product_totals.setdefault(row.product_name, {"product_name": row.product_name, "category_name": row.category_name, "quantity_sold": 0, "revenue": 0})
            product["quantity_sold"] += int(row.quantity or 0)
            product["revenue"] += float(row.line_amount or 0)
    unique_orders = {}
    for row in order_rows:
        unique_orders[row.id] = row
    for row in unique_orders.values():
        day = row.order_date.date() if hasattr(row.order_date, "date") else datetime.fromisoformat(str(row.order_date)[:10]).date()
        daily_totals[day.isoformat()] = daily_totals.get(day.isoformat(), 0) + float(row.order_total or 0)
        month = day.strftime("%Y-%m")
        monthly_totals[month] = monthly_totals.get(month, 0) + float(row.order_total or 0)

    trend = [{"date": date, "total": total} for date, total in sorted(daily_totals.items())]
    month_points = [{"month": month, "total": total} for month, total in sorted(monthly_totals.items())]
    return {
        "summary": {
            "total_sales": float(summary_row.total_sales or 0),
            "total_revenue": float(summary_row.total_revenue or 0),
            "total_orders": int(summary_row.order_count or 0),
            "pending_orders": status_counts.get("pending", 0),
            "completed_orders": status_counts.get("completed", 0),
            "cancelled_orders": status_counts.get("cancelled", 0) + status_counts.get("canceled", 0),
        },
        "sales_trend": trend,
        "monthly_sales": month_points,
        "order_statuses": [{"status": status, "count": count} for status, count in sorted(status_counts.items())],
        "top_products": sorted(product_totals.values(), key=lambda item: (-item["quantity_sold"], -item["revenue"], item["product_name"]))[:10],
        "rows": rows,
        "filters": {
            "order_statuses": [str(status) for status in order_status_options],
            "sale_statuses": [str(status) for status in sale_status_options],
            "categories": [{"id": int(category.id), "name": category.name} for category in categories],
            "products": [{"id": int(product.id), "name": product.name, "category_id": product.category_id} for product in products],
        },
    }


def initialize_database():
    try:
        from .db import initialize_database as create_tables
        from . import models
    except ImportError:
        from db import initialize_database as create_tables
        import models
    models
    create_tables()
    try:
        with session_scope() as session:
            standard_categories = (
                "Papers",
                "Ballpens",
                "Notebooks",
                "Writing Materials",
                "Bags",
                "Desk & Organizing",
            )
            existing_names = {
                name.casefold()
                for name in session.scalars(select(Category.name)).all()
            }
            session.add_all(
                Category(name=name)
                for name in standard_categories
                if name.casefold() not in existing_names
            )
    except IntegrityError:
        pass
    with session_scope() as session:
        for item in session.scalars(select(Product)).all():
            photo = PRODUCT_PHOTOS.get(item.name)
            if photo and (not item.image_url or item.image_url.lower().endswith(".svg")):
                item.image_url = photo
    with session_scope() as session:
        for name, email, password, role in DEMO_ACCOUNTS:
            user = session.scalar(select(User).where(User.email == email))
            if user is None:
                session.add(User(username=name.lower().replace(" ", ""), email=email, name=name, password_hash=generate_password_hash(password), role=role, active=True, status="active"))
        legacy_demo_staff = session.scalar(
            select(User).where(
                User.email == "staff@gmail.com",
                User.username == "staffuser",
                User.name == "Staff User",
                User.role == "staff",
            )
        )
        if legacy_demo_staff is not None:
            legacy_demo_staff.active = False
            legacy_demo_staff.status = "inactive"
    return models


def _user_dict(user):
    result = {"id": user.id, "email": user.email, "username": user.username, "name": user.name, "role": user.role.strip().lower() if user.role else "", "position": user.position, "status": user.status, "active": user.active, "profile_image_url": user.profile_image_url, "auth_version": user.auth_version}
    return result


def get_admin_profile(user_id):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.id == user_id, User.role == "admin"))
        if user is None:
            return None
        last_logout = session.scalar(
            select(UserSession.logout_time)
            .where(UserSession.user_id == user_id, UserSession.logout_time.is_not(None))
            .order_by(UserSession.logout_time.desc())
            .limit(1)
        )
        return {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "status": user.status,
            "active": user.active,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
            "last_login": user.last_login,
            "last_logout": last_logout,
        }


def get_staff_profile(user_id):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.id == user_id, User.role == "staff"))
        if user is None:
            return None
        return {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "position": user.position,
            "contact_number": user.contact_number,
            "profile_image_url": user.profile_image_url,
            "status": user.status,
            "active": user.active,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
            "last_login": user.last_login,
        }


def get_staff_account_activity(user_id, limit=30):
    with session_scope() as session:
        rows = session.execute(
            select(UserSession, User.name, User.username, User.email, User.role)
            .join(User)
            .where(UserSession.user_id == user_id, User.role == "staff")
            .order_by(UserSession.login_time.desc())
            .limit(limit)
        ).all()
    return [_session_dict(item, name, username, email, role) for item, name, username, email, role in rows]


def update_staff_profile(user_id, name, username, email, contact_number, session_id=None, ip_address=None):
    try:
        with session_scope() as session:
            user = session.scalar(select(User).where(User.id == user_id, User.role == "staff"))
            if user is None:
                return None, "not_found"
            if session.scalar(
                select(User.id).where(func.lower(User.username) == username.lower(), User.id != user_id).limit(1)
            ) is not None:
                return None, "username_exists"
            if session.scalar(
                select(User.id).where(func.lower(User.email) == email.lower(), User.id != user_id).limit(1)
            ) is not None:
                return None, "email_exists"
            user.name = name
            user.username = username
            user.email = email
            user.contact_number = contact_number or None
            user.updated_at = datetime.utcnow()
            session.add(
                ActivityLog(
                    user_id=user_id,
                    session_id=session_id,
                    action="profile_updated",
                    description="Updated staff profile information",
                    module="Staff Profile",
                    ip_address=ip_address,
                )
            )
            session.flush()
            return {
                "id": user.id,
                "name": user.name,
                "username": user.username,
                "email": user.email,
                "role": user.role,
                "position": user.position,
                "contact_number": user.contact_number,
                "profile_image_url": user.profile_image_url,
                "status": user.status,
                "active": user.active,
                "created_at": user.created_at,
                "updated_at": user.updated_at,
                "last_login": user.last_login,
            }, None
    except IntegrityError:
        return None, "duplicate"


def update_staff_profile_image(user_id, image_url, session_id=None, ip_address=None):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.id == user_id, User.role == "staff"))
        if user is None:
            return None, None
        previous_url = user.profile_image_url
        user.profile_image_url = image_url
        user.updated_at = datetime.utcnow()
        session.add(
            ActivityLog(
                user_id=user_id,
                session_id=session_id,
                action="profile_photo_updated",
                description="Updated staff profile picture" if image_url else "Removed staff profile picture",
                module="Staff Profile",
                ip_address=ip_address,
            )
        )
        session.flush()
        profile = {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "position": user.position,
            "contact_number": user.contact_number,
            "profile_image_url": user.profile_image_url,
            "status": user.status,
            "active": user.active,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
            "last_login": user.last_login,
        }
        return profile, previous_url


def change_staff_password(user_id, current_password, new_password, session_id=None, ip_address=None):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.id == user_id, User.role == "staff").with_for_update())
        if user is None:
            return "not_found"
        try:
            valid = check_password_hash(user.password_hash, current_password)
        except (TypeError, ValueError):
            valid = False
        if not valid:
            return "invalid_current_password"
        try:
            unchanged = check_password_hash(user.password_hash, new_password)
        except (TypeError, ValueError):
            unchanged = False
        if unchanged:
            return "unchanged_password"
        user.password_hash = generate_password_hash(new_password)
        user.auth_version += 1
        user.updated_at = datetime.utcnow()
        now = datetime.utcnow()
        for active_session in session.scalars(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.session_status == "online",
                UserSession.id != (session_id or -1),
            )
        ):
            active_session.logout_time = now
            active_session.last_activity = now
            active_session.session_status = "offline"
            active_session.session_duration = max(0, int((now - active_session.login_time).total_seconds()))
        session.add(
            ActivityLog(
                user_id=user_id,
                session_id=session_id,
                action="password_changed",
                description="Changed staff account password",
                module="Staff Account",
                ip_address=ip_address,
            )
        )
        return "updated"


def update_admin_profile(user_id, name, username, email, session_id=None, ip_address=None):
    try:
        with session_scope() as session:
            user = session.scalar(select(User).where(User.id == user_id, User.role == "admin"))
            if user is None:
                return None, "not_found"
            if session.scalar(select(User.id).where(User.username == username, User.id != user_id).limit(1)) is not None:
                return None, "username_exists"
            if session.scalar(select(User.id).where(User.email == email, User.id != user_id).limit(1)) is not None:
                return None, "email_exists"
            user.name = name
            user.username = username
            user.email = email
            user.updated_at = datetime.utcnow()
            session.add(
                ActivityLog(
                    user_id=user_id,
                    session_id=session_id,
                    action="profile_updated",
                    description="Updated administrator profile information",
                    module="Admin Profile",
                    ip_address=ip_address,
                )
            )
            session.flush()
            last_logout = session.scalar(
                select(UserSession.logout_time)
                .where(UserSession.user_id == user_id, UserSession.logout_time.is_not(None))
                .order_by(UserSession.logout_time.desc())
                .limit(1)
            )
            result = {
                "id": user.id,
                "name": user.name,
                "username": user.username,
                "email": user.email,
                "role": user.role,
                "status": user.status,
                "active": user.active,
                "created_at": user.created_at,
                "updated_at": user.updated_at,
                "last_login": user.last_login,
                "last_logout": last_logout,
            }
            return result, None
    except IntegrityError:
        return None, "duplicate"


def change_admin_password(user_id, current_password, new_password, session_id=None, ip_address=None):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.id == user_id, User.role == "admin"))
        if user is None:
            return "not_found"
        try:
            valid = check_password_hash(user.password_hash, current_password)
        except (TypeError, ValueError):
            valid = False
        if not valid:
            return "invalid_current_password"
        user.password_hash = generate_password_hash(new_password)
        user.updated_at = datetime.utcnow()
        session.add(
            ActivityLog(
                user_id=user_id,
                session_id=session_id,
                action="password_changed",
                description="Changed administrator account password",
                module="Admin Profile",
                ip_address=ip_address,
            )
        )
        return None


def get_admin_account_activity(user_id, limit=15):
    with session_scope() as session:
        logs = session.scalars(
            select(ActivityLog)
            .where(ActivityLog.user_id == user_id)
            .order_by(ActivityLog.created_at.desc())
            .limit(limit)
        ).all()
    return [
        {
            "id": item.id,
            "action": item.action,
            "description": item.description,
            "module": item.module,
            "created_at": item.created_at,
        }
        for item in logs
    ]


def _get_active_user(email, role=None):
    with session_scope() as session:
        query = select(User).where(User.email == email, User.active.is_(True))
        if role:
            query = query.where(User.role == role)
        return session.scalar(query)


def _system_setting_values(session):
    setting = session.get(SystemSetting, SYSTEM_SETTINGS_KEY)
    if setting is None:
        return DEFAULT_SYSTEM_SETTINGS
    return setting.setting_value


def _low_stock_threshold(session, inventory_item=None):
    if inventory_item is not None and inventory_item.reorder_level > 0:
        return inventory_item.reorder_level
    inventory_settings = _system_setting_values(session).get("inventory", {})
    return int(inventory_settings.get("low_stock_threshold", DEFAULT_SYSTEM_SETTINGS["inventory"]["low_stock_threshold"]))


def _notify_admins(session, kind, title, message, related_type=None, related_id=None, event_key=None, product_id=None, reset_read=False):
    notification_setting = {
        "customer-order": "customer_orders",
        "low-stock": "low_stock",
        "daily-sales-report": "daily_summary",
    }.get(kind)
    settings = _system_setting_values(session)
    preferences = settings.get("notifications", {})
    if notification_setting and not preferences.get(notification_setting, True):
        return
    if kind == "low-stock" and not settings.get("inventory", {}).get("automatic_alerts", True):
        return
    admins = session.scalars(
        select(User).where(User.role == "admin", User.active.is_(True))
    ).all()
    now = datetime.utcnow()
    for admin in admins:
        recipient_event_key = f"{event_key}:admin:{admin.id}" if event_key else None
        existing = session.scalar(
            select(Notification).where(Notification.event_key == recipient_event_key)
        ) if recipient_event_key else None
        if existing is None and product_id is not None:
            existing = session.scalar(
                select(Notification).where(
                    Notification.user_id == admin.id,
                    Notification.product_id == product_id,
                    Notification.kind == kind,
                )
            )
        if existing is not None:
            existing.title = title
            existing.message = message
            existing.related_type = related_type
            existing.related_id = str(related_id) if related_id is not None else None
            existing.event_key = recipient_event_key
            existing.product_id = product_id
            existing.created_at = now
            if reset_read:
                existing.read_at = None
            continue
        session.add(Notification(
            user_id=admin.id,
            product_id=product_id,
            related_type=related_type,
            related_id=str(related_id) if related_id is not None else None,
            event_key=recipient_event_key,
            kind=kind,
            title=title,
            message=message,
            created_at=now,
        ))


def _notify_order_managers(session, kind, title, message, related_type, related_id, event_key):
    managers = session.scalars(
        select(User).where(User.role.in_({"admin", "staff"}), User.active.is_(True))
    ).all()
    for manager in managers:
        _create_user_notification(
            session,
            manager.id,
            kind,
            title,
            message,
            related_type=related_type,
            related_id=related_id,
            event_key=f"{event_key}:user:{manager.id}",
        )


def _notify_staff_users(session, kind, title, message, related_type, related_id, event_key):
    staff_users = session.scalars(
        select(User).where(User.role == "staff", User.active.is_(True))
    ).all()
    for staff_user in staff_users:
        _create_user_notification(
            session,
            staff_user.id,
            kind,
            title,
            message,
            related_type=related_type,
            related_id=related_id,
            event_key=f"{event_key}:user:{staff_user.id}",
        )


def _create_user_notification(session, user_id, kind, title, message, related_type=None, related_id=None, event_key=None):
    if event_key and session.scalar(
        select(Notification.id).where(Notification.event_key == event_key)
    ) is not None:
        return
    session.add(Notification(
        user_id=user_id,
        related_type=related_type,
        related_id=str(related_id) if related_id is not None else None,
        event_key=event_key,
        kind=kind,
        title=title,
        message=message,
        created_at=datetime.utcnow(),
    ))


def _notify_customer_account_update(session, user, kind, title, message):
    _create_user_notification(
        session,
        user.id,
        kind,
        title,
        message,
        related_type="account",
        related_id=user.id,
        event_key=f"{kind}:{user.id}:{datetime.utcnow().isoformat()}",
    )


def _sync_low_stock_notification(session, product, previous_quantity, quantity, threshold):
    if product is None:
        return
    settings = _system_setting_values(session)
    if not settings.get("inventory", {}).get("automatic_alerts", True):
        return
    if not settings.get("notifications", {}).get("low_stock", True):
        return
    was_low = previous_quantity is not None and previous_quantity <= threshold
    is_low = quantity <= threshold
    if is_low:
        _notify_admins(
            session,
            "low-stock",
            f"Low stock alert: {product.name}",
            f"Only {quantity} units remaining. Consider restocking soon.",
            related_type="product",
            related_id=product.id,
            event_key=f"low-stock:product:{product.id}",
            product_id=product.id,
            reset_read=not was_low,
        )
    elif was_low:
        for admin in session.scalars(select(User).where(User.role == "admin", User.active.is_(True))).all():
            alert = session.scalar(select(Notification).where(
                Notification.user_id == admin.id,
                Notification.event_key == f"low-stock:product:{product.id}:admin:{admin.id}",
            ))
            if alert:
                alert.title = f"Low stock alert: {product.name}"
                alert.message = f"Stock has been replenished to {quantity} units."
                alert.created_at = datetime.utcnow()
                if alert.read_at is None:
                    alert.read_at = datetime.utcnow()


def create_product(name, category_id=None, price=0, stock=0, description="", image_url=None, unit_cost=0, status="active", product_code=None, reorder_level=0):
    if not isinstance(name, str) or not name.strip() or not image_url:
        return None
    with session_scope() as session:
        category = session.get(Category, int(category_id)) if category_id not in (None, "") else None
        if category is None or status not in {"active", "inactive"}:
            return None
        normalized_code = product_code.strip().upper() if isinstance(product_code, str) else ""
        if not normalized_code or session.scalar(select(Product.id).where(func.lower(Product.product_code) == normalized_code.lower())) is not None:
            raise ValueError("This product code is already in use or invalid.")
        product = Product(
            name=name.strip(),
            category_id=category.id,
            description=(description or "").strip() or None,
            price=Decimal(str(price)),
            selling_price=Decimal(str(price)),
            unit_cost=Decimal(str(unit_cost)),
            stock=int(stock or 0),
            status=status,
            product_code=normalized_code,
            image_url=image_url,
        )
        session.add(product)
        session.flush()
        initial_stock = int(stock or 0)
        now = datetime.utcnow()
        inventory_item = Inventory(product_id=product.id, quantity=initial_stock, stock_in_hand=initial_stock, reorder_level=int(reorder_level), location="main", updated_at=now, last_updated=now)
        session.add(inventory_item)
        _sync_low_stock_notification(session, product, None, initial_stock, _low_stock_threshold(session, inventory_item))
        recipient_roles = ("staff", "customer") if status == "active" else ("staff",)
        recipient_users = session.scalars(
            select(User).where(User.role.in_(recipient_roles), User.active.is_(True))
        ).all()
        for recipient in recipient_users:
            kind = f"new-product-{recipient.role}"
            title = "New Product Added to Inventory" if recipient.role == "staff" else "New Product Available!"
            message = (
                f"The Admin has added a new product: {product.name}, under the {category.name} category."
                if recipient.role == "staff"
                else f"Check out our new product: {product.name}! It is now available in SchoolSupply."
            )
            session.add(
                Notification(
                    user_id=recipient.id,
                    product_id=product.id,
                    kind=kind,
                    title=title,
                    message=message,
                )
            )
        return {
            "id": product.id,
            "name": product.name,
            "category_id": product.category_id,
            "category_name": category.name,
            "description": product.description,
            "price": float(product.price),
            "unit_cost": float(product.unit_cost),
            "stock": product.stock,
            "reorder_level": inventory_item.reorder_level,
            "product_code": product.product_code,
            "status": product.status,
            "image_url": product.image_url,
            "created_at": product.created_at,
        }


def list_products(include_inactive=True, include_cost=True):
    with session_scope() as session:
        query = select(Product).order_by(Product.created_at.desc(), Product.id.desc())
        if not include_inactive:
            query = query.where(Product.status == "active")
        feedback_summary = {
            product_id: {"average_rating": float(average_rating), "review_count": int(review_count)}
            for product_id, average_rating, review_count in session.execute(
                select(
                    ProductFeedback.product_id,
                    func.avg(ProductFeedback.rating),
                    func.count(ProductFeedback.id),
                ).group_by(ProductFeedback.product_id)
            ).all()
        }
        inventory_by_product = {
            item.product_id: item
            for item in session.scalars(select(Inventory)).all()
        }
        default_stock_threshold = int(
            _system_setting_values(session)
            .get("inventory", {})
            .get("low_stock_threshold", DEFAULT_SYSTEM_SETTINGS["inventory"]["low_stock_threshold"])
        )
        products = []
        for item in session.scalars(query).all():
            inventory_item = inventory_by_product.get(item.id)
            reorder_level = inventory_item.reorder_level if inventory_item else 0
            product = {
                "id": item.id,
                "name": item.name,
                "category_id": item.category_id,
                "category": item.category_id,
                "category_name": item.category.name if item.category else None,
                "image_url": item.image_url,
                "price": float(item.price),
                "stock": item.stock,
                "reorder_level": reorder_level,
                "stock_threshold": reorder_level if reorder_level > 0 else default_stock_threshold,
                "product_code": item.product_code,
                "description": item.description,
                "status": item.status,
                "created_at": item.created_at,
                "average_rating": feedback_summary.get(item.id, {}).get("average_rating"),
                "review_count": feedback_summary.get(item.id, {}).get("review_count", 0),
            }
            if include_cost:
                product["unit_cost"] = float(item.unit_cost)
            products.append(product)
        return products


def update_product(product_id, price, stock, image_url=None, name=None, description=None, category_id=None, unit_cost=None, status=None, actor_name="Admin", product_code=None, reorder_level=None):
    with session_scope() as session:
        product = session.get(Product, product_id)
        if product is None:
            return False
        if category_id is not None and session.get(Category, int(category_id)) is None:
            return False
        normalized_code = product_code.strip().upper() if isinstance(product_code, str) else product.product_code
        if not normalized_code:
            raise ValueError("Product code is required.")
        if session.scalar(select(Product.id).where(
            func.lower(Product.product_code) == normalized_code.lower(),
            Product.id != product.id,
        )) is not None:
            raise ValueError("This product code is already in use.")
        previous_stock = product.stock
        product.price, product.selling_price, product.stock = price, price, stock
        if unit_cost is not None:
            product.unit_cost = unit_cost
        if status is not None:
            if status not in {"active", "inactive"}:
                return False
            product.status = status
        if image_url is not None:
            product.image_url = image_url
        product.product_code = normalized_code
        if name is not None:
            product.name = name
        if description is not None:
            product.description = description
        if category_id is not None:
            product.category_id = int(category_id)
        inventory_item = session.scalar(select(Inventory).where(Inventory.product_id == product.id))
        if inventory_item is None:
            now = datetime.utcnow()
            inventory_item = Inventory(product_id=product.id, quantity=stock, stock_in_hand=stock, reorder_level=max(0, int(reorder_level or 0)), location="main", updated_at=now, last_updated=now)
            session.add(inventory_item)
        else:
            now = datetime.utcnow()
            inventory_item.quantity = inventory_item.stock_in_hand = stock
            if reorder_level is not None:
                inventory_item.reorder_level = max(0, int(reorder_level))
            inventory_item.updated_at = inventory_item.last_updated = now
        threshold = _low_stock_threshold(session, inventory_item)
        _sync_low_stock_notification(session, product, previous_stock, stock, threshold)
        if previous_stock != stock:
            _notify_admins(
                session,
                "inventory-updated",
                "Inventory updated",
                f"{product.name} stock was adjusted from {previous_stock} to {stock} by {actor_name}.",
                related_type="product",
                related_id=product.id,
                event_key=f"inventory-updated:product:{product.id}:{datetime.utcnow().isoformat()}",
                product_id=product.id,
            )
        return True


def ensure_daily_sales_report_notification(user_id):
    with session_scope() as session:
        user = session.get(User, user_id)
        if user is None or user.role != "admin":
            return
        report_date = datetime.utcnow().date().isoformat()
        event_key = f"daily-sales-report:{report_date}"
        exists = session.scalar(select(Notification.id).where(
            Notification.user_id == user_id,
            Notification.event_key == f"{event_key}:admin:{user_id}",
        ))
        if exists is None:
            _notify_admins(
                session,
                "daily-sales-report",
                "Daily sales report ready",
                f"The sales summary for {report_date} is available in Reports and Analytics.",
                related_type="report",
                related_id=report_date,
                event_key=event_key,
            )


def list_notifications(user_id):
    ensure_daily_sales_report_notification(user_id)
    with session_scope() as session:
        items = session.scalars(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
        ).all()
        return [
            {
                "id": item.id,
                "product_id": item.product_id,
                "related_type": item.related_type,
                "related_id": item.related_id,
                "kind": item.kind,
                "title": item.title,
                "message": item.message,
                "image_url": item.product.image_url if item.product else None,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "read_at": item.read_at.isoformat() if item.read_at else None,
                "url": f"/products?product_id={item.product_id}" if item.product_id else None,
            }
            for item in items
        ]


def mark_notification_read(user_id, notification_id):
    with session_scope() as session:
        item = session.scalar(
            select(Notification).where(Notification.id == notification_id, Notification.user_id == user_id)
        )
        if item is None:
            return False
        if item.read_at is None:
            item.read_at = datetime.utcnow()
        return True


def mark_all_notifications_read(user_id):
    with session_scope() as session:
        session.execute(
            text("UPDATE notifications SET read_at = :read_at WHERE user_id = :user_id AND read_at IS NULL"),
            {"read_at": datetime.utcnow(), "user_id": user_id},
        )
        return session.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id,
                Notification.read_at.is_(None),
            )
        ) or 0


def delete_notification(user_id, notification_id):
    with session_scope() as session:
        item = session.scalar(
            select(Notification).where(Notification.id == notification_id, Notification.user_id == user_id)
        )
        if item is None:
            return False
        session.delete(item)
        return True


def delete_product(product_id):
    with session_scope() as session:
        product = session.get(Product, product_id)
        if product is None:
            return False
        has_order_history = session.scalar(select(OrderItem.id).where(OrderItem.product_id == product.id).limit(1)) is not None
        has_sale_history = session.scalar(select(SaleItem.id).where(SaleItem.product_id == product.id).limit(1)) is not None
        if has_order_history or has_sale_history:
            raise ValueError("This product is part of order or sales history and cannot be deleted.")
        for inventory_item in session.scalars(select(Inventory).where(Inventory.product_id == product.id)):
            session.delete(inventory_item)
        session.delete(product)
        return True


def add_stock(product_id, amount, actor_name="Staff"):
    with session_scope() as session:
        product = session.get(Product, product_id)
        if product is None:
            return False
        previous_quantity = product.stock
        product.stock += amount
        inventory_item = session.scalar(select(Inventory).where(Inventory.product_id == product.id))
        if inventory_item is None:
            now = datetime.utcnow()
            session.add(Inventory(product_id=product.id, quantity=product.stock, stock_in_hand=product.stock, reorder_level=0, location="main", updated_at=now, last_updated=now))
            threshold = _low_stock_threshold(session)
        else:
            inventory_item.quantity += amount
            inventory_item.stock_in_hand = inventory_item.quantity
            inventory_item.updated_at = inventory_item.last_updated = datetime.utcnow()
            threshold = _low_stock_threshold(session, inventory_item)
        _sync_low_stock_notification(session, product, previous_quantity, product.stock, threshold)
        _notify_admins(
            session,
            "inventory-updated",
            "Inventory updated",
            f"{product.name} stock was increased by {amount} units to {product.stock} by {actor_name}.",
            related_type="product",
            related_id=product.id,
            event_key=f"inventory-updated:product:{product.id}:{datetime.utcnow().isoformat()}",
            product_id=product.id,
        )
        return True


def create_user(name, email, password, role="customer", username=None, position=None):
    if role not in VALID_ROLES:
        raise ValueError("Invalid user role")
    try:
        with session_scope() as session:
            if role in MANAGED_ROLES:
                admin_id = session.scalar(
                    select(User.id)
                    .where(User.role == "admin")
                    .order_by(User.id)
                    .limit(1)
                    .with_for_update()
                )
                if admin_id is None:
                    raise RuntimeError("An administrator account is required to manage staff accounts.")
            if session.scalar(select(User).where(func.lower(User.email) == email.strip().lower())) is not None:
                return False
            if username and role in MANAGED_ROLES and session.scalar(
                select(User).where(func.lower(User.username) == username.strip().lower())
            ) is not None:
                return False
            if role == "customer" and session.scalar(select(func.count(User.id)).where(User.role == "customer")) >= CUSTOMER_LIMIT:
                return False
            session.add(User(username=(username or name).strip(), email=email.strip().lower(), name=name.strip(), password_hash=generate_password_hash(password), role=role, position=position, active=True, status="active"))
    except IntegrityError:
        return False
    return True


def create_customer(name, email, password):
    try:
        with session_scope() as session:
            admin = session.scalar(
                select(User.id).where(User.email == "admin@gmail.com").with_for_update()
            )
            if admin is None:
                raise RuntimeError("The administrator account must exist before customer registration.")
            if session.scalar(select(User).where(User.email == email)) is not None:
                return False
            customer_count = session.scalar(
                select(func.count(User.id)).where(User.role == "customer")
            ) or 0
            if customer_count >= CUSTOMER_LIMIT:
                return False
            customer = User(
                username=email.split("@", 1)[0],
                email=email,
                name=name.strip(),
                password_hash=generate_password_hash(password),
                role="customer",
                active=True,
                status="active",
            )
            session.add(customer)
            session.flush()
            _create_user_notification(
                session,
                customer.id,
                "account-welcome",
                "Welcome to SchoolSupply",
                f"Welcome, {customer.name}! Your account is ready. Browse the catalog whenever you need school supplies.",
                related_type="account",
                related_id=customer.id,
                event_key=f"customer-welcome:{customer.id}",
            )
    except IntegrityError:
        return False
    return True


def customer_registration_available():
    with session_scope() as session:
        count = session.scalar(select(func.count(User.id)).where(User.role == "customer")) or 0
    return {"count": count, "limit": CUSTOMER_LIMIT, "available": count < CUSTOMER_LIMIT}


def create_managed_user(username, name, email, password, position):
    if "staff" not in MANAGED_ROLES:
        raise ValueError("Only admin and staff accounts can be managed")
    return create_user(name, email, password, "staff", username, position)


def customer_password_matches(email, password):
    user = _get_active_user(email, "customer")
    return user is not None and check_password_hash(user.password_hash, password)


def get_customer(email, password):
    return authenticate_user(email, password, "customer")


def set_user_status(email, status):
    if status not in ACCOUNT_STATUSES:
        return False
    with session_scope() as session:
        user = session.scalar(select(User).where(User.email == email))
        if user is None:
            return False
        user.active, user.status = status == "active", status
        if status != "active":
            now = datetime.utcnow()
            for item in session.scalars(select(UserSession).where(UserSession.user_id == user.id, UserSession.session_status == "online")):
                item.logout_time, item.last_activity, item.session_status = now, now, "offline"
                item.session_duration = max(0, int((now - item.login_time).total_seconds()))
        return True


def update_staff_account(email, username, name, new_email, position=None, password=None):
    try:
        with session_scope() as session:
            admin_id = session.scalar(
                select(User.id)
                .where(User.role == "admin")
                .order_by(User.id)
                .limit(1)
                .with_for_update()
            )
            if admin_id is None:
                raise RuntimeError("An administrator account is required to manage staff accounts.")
            user = session.scalar(select(User).where(User.email == email, User.role == "staff"))
            if user is None:
                return False
            if session.scalar(
                select(User).where(
                    func.lower(User.username) == username.strip().lower(),
                    User.id != user.id,
                )
            ) is not None:
                return False
            if session.scalar(
                select(User).where(
                    func.lower(User.email) == new_email.strip().lower(),
                    User.id != user.id,
                )
            ) is not None:
                return False
            user.username, user.name, user.position = username.strip(), name.strip(), position
            user.email = new_email.strip().lower()
            if password is not None:
                user.password_hash = generate_password_hash(password)
            return True
    except IntegrityError:
        return False


def delete_staff_account(email):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.email == email, User.role == "staff"))
        if user is None:
            return False
        session.delete(user)
        return True


def authenticate_user(email, password, role=None):
    user = _get_active_user(email, role)
    if user is None or not check_password_hash(user.password_hash, password):
        return None
    return _user_dict(user)


def get_user_by_email(email):
    user = _get_active_user(email)
    return _user_dict(user) if user else None


def get_user_by_id(user_id):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.id == user_id, User.active.is_(True)))
        return _user_dict(user) if user else None


def login_user(email, password):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.email == email))
        if user is None or not user.active:
            return None, GENERIC_LOGIN_ERROR
        try:
            valid = check_password_hash(user.password_hash, password)
        except (TypeError, ValueError):
            valid = False
        if not valid:
            return None, GENERIC_LOGIN_ERROR
        user.last_login = datetime.utcnow()
        return _user_dict(user), None


def get_customer_profile(user_id):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.id == user_id, User.role == "customer"))
        if user is None:
            return None
        return {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "email": user.email,
            "profile_image_url": user.profile_image_url,
            "contact_number": user.contact_number,
            "address_line": user.address_line,
            "barangay": user.barangay,
            "city": user.city,
            "province": user.province,
            "postal_code": user.postal_code,
            "status": user.status,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
        }


def update_customer_name(user_id, name):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.id == user_id, User.role == "customer"))
        if user is None:
            return None
        user.name = name
        user.updated_at = datetime.utcnow()
        _notify_customer_account_update(
            session,
            user,
            "account-profile-updated",
            "Profile updated",
            "Your display name has been updated.",
        )
        return {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "email": user.email,
            "profile_image_url": user.profile_image_url,
            "contact_number": user.contact_number,
            "address_line": user.address_line,
            "barangay": user.barangay,
            "city": user.city,
            "province": user.province,
            "postal_code": user.postal_code,
            "status": user.status,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
        }


def update_customer_email(user_id, email, current_password):
    try:
        with session_scope() as session:
            user = session.scalar(select(User).where(User.id == user_id, User.role == "customer"))
            if user is None:
                return "not_found", None
            try:
                valid_password = check_password_hash(user.password_hash, current_password)
            except (TypeError, ValueError):
                valid_password = False
            if not valid_password:
                return "invalid_password", None
            if session.scalar(
                select(User.id).where(
                    func.lower(User.email) == email.lower(),
                    User.id != user_id,
                )
            ) is not None:
                return "email_exists", None
            user.email = email.lower()
            user.updated_at = datetime.utcnow()
            _notify_customer_account_update(
                session,
                user,
                "account-email-updated",
                "Email address updated",
                "Your sign-in email address has been updated. It has not been independently verified.",
            )
            return "updated", {
                "id": user.id,
                "name": user.name,
                "username": user.username,
                "email": user.email,
                "profile_image_url": user.profile_image_url,
                "contact_number": user.contact_number,
                "address_line": user.address_line,
                "barangay": user.barangay,
                "city": user.city,
                "province": user.province,
                "postal_code": user.postal_code,
                "status": user.status,
                "created_at": user.created_at,
                "updated_at": user.updated_at,
            }
    except IntegrityError:
        return "email_exists", None


def update_customer_profile_image(user_id, image_url):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.id == user_id, User.role == "customer"))
        if user is None:
            return None, None
        previous_url = user.profile_image_url
        user.profile_image_url = image_url
        user.updated_at = datetime.utcnow()
        _notify_customer_account_update(
            session,
            user,
            "account-profile-updated",
            "Profile picture updated" if image_url else "Profile picture removed",
            "Your profile picture has been updated." if image_url else "Your profile picture has been removed.",
        )
        profile = {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "email": user.email,
            "profile_image_url": user.profile_image_url,
            "status": user.status,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
        }
        return profile, previous_url


def change_customer_password(user_id, current_password, new_password, session_id=None, ip_address=None):
    with session_scope() as session:
        user = session.scalar(select(User).where(User.id == user_id, User.role == "customer").with_for_update())
        if user is None:
            return "not_found", None
        try:
            valid = check_password_hash(user.password_hash, current_password)
        except (TypeError, ValueError):
            valid = False
        if not valid:
            return "invalid_current_password", None
        try:
            unchanged = check_password_hash(user.password_hash, new_password)
        except (TypeError, ValueError):
            unchanged = False
        if unchanged:
            return "unchanged_password", None
        user.password_hash = generate_password_hash(new_password)
        user.auth_version += 1
        user.updated_at = datetime.utcnow()
        now = datetime.utcnow()
        for active_session in session.scalars(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.session_status == "online",
                UserSession.id != (session_id or -1),
            )
        ):
            active_session.logout_time = now
            active_session.last_activity = now
            active_session.session_status = "offline"
            active_session.session_duration = max(0, int((now - active_session.login_time).total_seconds()))
        session.add(
            ActivityLog(
                user_id=user_id,
                session_id=session_id,
                action="password_changed",
                description="Changed customer account password",
                module="Customer Account",
                ip_address=ip_address,
            )
        )
        _notify_customer_account_update(
            session,
            user,
            "account-password-changed",
            "Password changed",
            "Your account password was changed successfully. Other active sessions have been signed out.",
        )
        profile = {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "email": user.email,
            "profile_image_url": user.profile_image_url,
            "status": user.status,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
        }
        return "updated", profile


def start_user_session(user_id, ip_address):
    with session_scope() as session:
        item = UserSession(user_id=user_id, session_status="online")
        session.add(item)
        session.flush()
        session_id = item.id
    record_activity(user_id, session_id, "login", "Signed in", "Authentication", ip_address)
    return session_id


def touch_user_session(user_id, session_id):
    refresh_stale_sessions()
    with session_scope() as session:
        item = session.scalar(select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user_id, UserSession.session_status == "online"))
        if item is None:
            return False
        item.last_activity = datetime.utcnow()
        return True


def finish_user_session(user_id, session_id, ip_address):
    refresh_stale_sessions()
    with session_scope() as session:
        item = session.scalar(select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user_id, UserSession.session_status == "online"))
        if item:
            now = datetime.utcnow()
            item.logout_time, item.last_activity, item.session_status = now, now, "offline"
            item.session_duration = max(0, int((now - item.login_time).total_seconds()))
    record_activity(user_id, session_id, "logout", "Signed out", "Authentication", ip_address)


def refresh_stale_sessions():
    cutoff = datetime.utcnow() - timedelta(seconds=PRESENCE_TIMEOUT_SECONDS)
    with session_scope() as session:
        items = session.scalars(select(UserSession).where(UserSession.session_status == "online", UserSession.last_activity < cutoff)).all()
        for item in items:
            item.logout_time, item.session_status = item.last_activity, "offline"
            item.session_duration = max(0, int((item.last_activity - item.login_time).total_seconds()))


def record_activity(user_id, session_id, action, description, module, ip_address):
    with session_scope() as session:
        user = session.get(User, user_id) if user_id is not None else None
        item = ActivityLog(
            user_id=user_id,
            session_id=session_id,
            user_name=user.name if user else None,
            username=user.username if user else None,
            user_role=user.role if user else None,
            action=action,
            description=description,
            module=module,
            ip_address=ip_address,
        )
        session.add(item)
        session.flush()
        return item.id


def _duration_seconds(start, end=None):
    if not start:
        return 0
    return max(0, int(((end or datetime.utcnow()) - start).total_seconds()))


def get_monitoring_users(search="", role="", current_status="", start_date=None, end_date=None, include_admin=False):
    refresh_stale_sessions()
    roles = ["customer", "staff", "admin"] if include_admin else ["customer", "staff"]
    with session_scope() as session:
        users = session.scalars(select(User).where(User.role.in_(roles)).order_by(User.name)).all()
        sessions = session.scalars(select(UserSession).join(User).where(User.role.in_(roles)).order_by(UserSession.login_time.desc())).all()
        counts = dict(session.execute(select(ActivityLog.user_id, func.count(ActivityLog.id)).group_by(ActivityLog.user_id)).all())
    grouped = {}
    for item in sessions:
        date = item.login_time.date().isoformat()
        if start_date and date < start_date and item.session_status != "online":
            continue
        if end_date and date > end_date:
            continue
        grouped.setdefault(item.user_id, []).append(item)
    needle = search.strip().lower()
    result = []
    for user in users:
        user_sessions = grouped.get(user.id, [])
        current = next((item for item in user_sessions if item.session_status == "online"), None)
        latest = user_sessions[0] if user_sessions else None
        current_seconds = _duration_seconds(current.login_time) if current else 0
        item = {"id": user.id, "name": user.name, "username": user.username, "email": user.email, "role": user.role, "position": user.position, "account_status": user.status, "profile_image_url": user.profile_image_url, "current_status": "online" if current else "offline", "last_login": latest.login_time if latest else None, "last_logout": next((s.logout_time for s in user_sessions if s.logout_time), None), "current_session_duration": current_seconds, "total_login_seconds": sum(s.session_duration for s in user_sessions) + current_seconds, "login_count": len(user_sessions), "action_count": counts.get(user.id, 0), "created_at": user.created_at, "updated_at": user.updated_at, "last_activity": current.last_activity if current else None}
        if (role and item["role"] != role) or (current_status and item["current_status"] != current_status):
            continue
        if needle and needle not in " ".join(str(item[field]).lower() for field in ("name", "username", "email")):
            continue
        result.append(item)
    return result


def _session_dict(item, name, username, email, role):
    return {"id": item.id, "user_id": item.user_id, "login_time": item.login_time, "logout_time": item.logout_time, "last_activity": item.last_activity, "session_duration": _duration_seconds(item.login_time) if item.session_status == "online" else item.session_duration, "session_status": item.session_status, "created_at": item.created_at, "name": name, "username": username, "email": email, "role": role}


def get_session_history(user_id=None, start_date=None, end_date=None):
    refresh_stale_sessions()
    with session_scope() as session:
        query = select(UserSession, User.name, User.username, User.email, User.role).join(User).where(User.role.in_(["customer", "staff"]))
        if user_id:
            query = query.where(UserSession.user_id == user_id)
        if start_date:
            query = query.where(func.date(UserSession.login_time) >= start_date)
        if end_date:
            query = query.where(func.date(UserSession.login_time) <= end_date)
        rows = session.execute(query.order_by(UserSession.login_time.desc()).limit(500)).all()
    return [_session_dict(item, name, username, email, role) for item, name, username, email, role in rows]


def get_activity_logs(user_id=None, action="", start_date=None, end_date=None, search=""):
    with session_scope() as session:
        query = select(ActivityLog, User.name, User.username, User.email, User.role).join(User).where(User.role.in_(["customer", "staff"]))
        if user_id:
            query = query.where(ActivityLog.user_id == user_id)
        if action:
            query = query.where(ActivityLog.action == action)
        if start_date:
            query = query.where(func.date(ActivityLog.created_at) >= start_date)
        if end_date:
            query = query.where(func.date(ActivityLog.created_at) <= end_date)
        if search:
            value = f"%{search}%"
            query = query.where(or_(ActivityLog.description.like(value), User.name.like(value), User.username.like(value), User.email.like(value)))
        rows = session.execute(query.order_by(ActivityLog.created_at.desc()).limit(500)).all()
    return [{"id": item.id, "user_id": item.user_id, "session_id": item.session_id, "action": item.action, "description": item.description, "module": item.module, "ip_address": item.ip_address, "created_at": item.created_at, "name": name, "username": username, "email": email, "role": role} for item, name, username, email, role in rows]


def get_admin_activity_page(page=1, page_size=10, search="", user_id=None, role="", action_group="", module="", start_date=None, end_date=None, sort_by="created_at", sort_direction="desc"):
    from sqlalchemy import asc, desc

    user_name = func.coalesce(ActivityLog.user_name, User.name, ActivityLog.username, User.username, "Deleted user")
    username = func.coalesce(ActivityLog.username, User.username, "")
    role_value = func.coalesce(ActivityLog.user_role, User.role, "unknown")
    conditions = []
    if user_id is not None:
        conditions.append(ActivityLog.user_id == user_id)
    if role:
        conditions.append(func.lower(role_value) == role.lower())
    if module:
        conditions.append(ActivityLog.module == module)
    if start_date:
        conditions.append(func.date(ActivityLog.created_at) >= start_date)
    if end_date:
        conditions.append(func.date(ActivityLog.created_at) <= end_date)

    action_value = func.lower(ActivityLog.action)
    action_groups = {
        "login": action_value.in_(("login", "logout")),
        "create": or_(action_value.like("%created%"), action_value.like("%added%"), action_value.like("%registered%")),
        "update": or_(action_value.like("%updated%"), action_value.like("%edited%"), action_value.like("%changed%")),
        "delete": action_value.like("%deleted%"),
        "view": action_value.like("%viewed%"),
        "order": action_value.like("%order%"),
        "inventory_update": or_(action_value.like("%stock%"), action_value.like("%inventory%")),
        "report": action_value.like("%report%"),
    }
    if action_group in action_groups:
        conditions.append(action_groups[action_group])
    elif action_group == "other":
        conditions.append(~or_(*action_groups.values()))
    if search:
        value = f"%{search.strip()}%"
        conditions.append(or_(
            user_name.ilike(value),
            username.ilike(value),
            ActivityLog.action.ilike(value),
            ActivityLog.description.ilike(value),
            ActivityLog.module.ilike(value),
            ActivityLog.ip_address.ilike(value),
        ))

    sort_columns = {
        "created_at": ActivityLog.created_at,
        "user": func.lower(user_name),
        "role": func.lower(role_value),
        "action": func.lower(ActivityLog.action),
        "module": func.lower(ActivityLog.module),
    }
    order_column = sort_columns.get(sort_by, ActivityLog.created_at)
    order = asc(order_column) if sort_direction == "asc" else desc(order_column)

    with session_scope() as session:
        base_query = select(ActivityLog).outerjoin(User, ActivityLog.user_id == User.id).where(*conditions)
        total = session.scalar(select(func.count(ActivityLog.id)).select_from(ActivityLog).outerjoin(User, ActivityLog.user_id == User.id).where(*conditions)) or 0
        rows = session.execute(
            base_query.order_by(order, ActivityLog.id.desc()).offset((page - 1) * page_size).limit(page_size)
        ).scalars().all()
        users = session.execute(
            select(User.id, User.name, User.username, User.role).order_by(User.name, User.username)
        ).all()
        modules = session.scalars(
            select(ActivityLog.module).distinct().order_by(ActivityLog.module)
        ).all()
        actions = session.scalars(
            select(ActivityLog.action).distinct().order_by(ActivityLog.action)
        ).all()
        result = [{
            "id": item.id,
            "user_id": item.user_id,
            "name": item.user_name or (item.user.name if item.user else None) or item.username or (item.user.username if item.user else None) or "Deleted user",
            "username": item.username or (item.user.username if item.user else None),
            "role": item.user_role or (item.user.role if item.user else None) or "unknown",
            "action": item.action,
            "description": item.description,
            "module": item.module,
            "ip_address": item.ip_address,
            "created_at": item.created_at.isoformat() if item.created_at else None,
        } for item in rows]
    return {
        "items": result,
        "total": int(total),
        "page": page,
        "page_size": page_size,
        "users": [{"id": user.id, "name": user.name, "username": user.username, "role": user.role} for user in users],
        "roles": ["admin", "staff", "customer"],
        "actions": [str(action) for action in actions],
        "modules": [str(module) for module in modules],
    }


def get_monitoring_stats():
    refresh_stale_sessions()
    users = get_monitoring_users()
    today = datetime.utcnow().date()
    with session_scope() as session:
        counts = dict(session.execute(select(ActivityLog.action, func.count(ActivityLog.id)).where(func.date(ActivityLog.created_at) == today).group_by(ActivityLog.action)).all())
        today_sessions = session.scalar(select(func.coalesce(func.sum(UserSession.session_duration), 0)).where(func.date(UserSession.login_time) == today)) or 0
    today_hours = sum(item["current_session_duration"] if item["current_status"] == "online" else 0 for item in users)
    return {"total_users": len(users), "online_users": sum(item["current_status"] == "online" for item in users), "offline_users": sum(item["current_status"] == "offline" for item in users), "active_staff": sum(item["role"] == "staff" and item["account_status"] == "active" for item in users), "active_customers": sum(item["role"] == "customer" and item["account_status"] == "active" for item in users), "total_logins": counts.get("login", 0), "total_logouts": counts.get("logout", 0), "total_actions": sum(counts.values()), "total_active_sessions": counts.get("login", 0) - counts.get("logout", 0), "total_hours_logged": today_sessions + today_hours}


def list_categories():
    with session_scope() as session:
        return [{"id": item.id, "name": item.name, "description": item.description, "created_at": item.created_at} for item in session.scalars(select(Category).order_by(Category.id)).all()]


def create_category(name, description=""):
    if not isinstance(name, str) or not name.strip():
        return None
    with session_scope() as session:
        item = Category(name=name.strip(), description=(description or "").strip())
        session.add(item)
        session.flush()
        return {"id": item.id, "name": item.name, "description": item.description, "created_at": item.created_at}


def update_category(category_id, name, description=""):
    with session_scope() as session:
        item = session.get(Category, category_id)
        if item is None:
            return None
        if name is not None and str(name).strip():
            item.name = str(name).strip()
        if description is not None:
            item.description = str(description).strip()
        return {"id": item.id, "name": item.name, "description": item.description, "created_at": item.created_at}


def delete_category(category_id):
    with session_scope() as session:
        item = session.get(Category, category_id)
        if item is None:
            return False
        session.delete(item)
        return True


def list_inventory():
    with session_scope() as session:
        return [{"id": item.id, "product_id": item.product_id, "quantity": item.quantity, "reorder_level": item.reorder_level, "location": item.location, "updated_at": item.updated_at} for item in session.scalars(select(Inventory).order_by(Inventory.id)).all()]


def update_inventory(product_id, quantity, reorder_level=0, location="main", actor_name="Admin"):
    if int(quantity) < 0 or int(reorder_level) < 0:
        raise ValueError("Stock and minimum stock level cannot be negative.")
    with session_scope() as session:
        product = session.get(Product, product_id)
        if product is None:
            return None
        item = session.scalar(select(Inventory).where(Inventory.product_id == product_id))
        if item is None:
            item = Inventory(product_id=product_id, quantity=0, stock_in_hand=0, reorder_level=reorder_level, location=location)
            session.add(item)
            session.flush()
        previous_quantity = item.quantity
        item.quantity = item.stock_in_hand = int(quantity)
        item.reorder_level = int(reorder_level)
        if location:
            item.location = str(location)
        item.updated_at = item.last_updated = datetime.utcnow()
        product.stock = int(quantity)
        _sync_low_stock_notification(session, product, previous_quantity, int(quantity), _low_stock_threshold(session, item))
        if previous_quantity != int(quantity):
            _notify_admins(
                session,
                "inventory-updated",
                "Inventory updated",
                f"{product.name} stock was adjusted from {previous_quantity} to {quantity} by {actor_name}.",
                related_type="product",
                related_id=product.id,
                event_key=f"inventory-updated:product:{product.id}:{datetime.utcnow().isoformat()}",
                product_id=product.id,
            )
        return {"id": item.id, "product_id": item.product_id, "quantity": item.quantity, "reorder_level": item.reorder_level, "location": item.location, "updated_at": item.updated_at}


def list_orders():
    columns = {column["name"] for column in inspect(engine).get_columns("orders")}
    date_column = next((name for name in ("created_at", "order_date") if name in columns), None)
    total_column = next((name for name in ("total", "total_amount") if name in columns), None)
    if date_column is None or total_column is None:
        raise RuntimeError("The orders table is missing required list columns.")
    tables = set(inspect(engine).get_table_names())
    item_count_sql = "0 AS item_count"
    first_item_sql = (
        "NULL AS first_product_name, NULL AS first_product_image_url, NULL AS product_names, "
        "NULL AS first_product_quantity, NULL AS first_product_unit_price"
    )
    if "order_items" in tables:
        item_columns = {column["name"] for column in inspect(engine).get_columns("order_items")}
        if {"order_id", "quantity"}.issubset(item_columns):
            item_count_sql = (
                "(SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi "
                "WHERE oi.order_id = orders.id) AS item_count"
            )
        if {"order_id", "product_id"}.issubset(item_columns) and "products" in tables:
            product_columns = {column["name"] for column in inspect(engine).get_columns("products")}
            if "name" in product_columns:
                first_quantity_sql = (
                    "(SELECT oi.quantity FROM order_items oi WHERE oi.order_id = o.id "
                    "ORDER BY oi.product_id LIMIT 1) AS first_product_quantity"
                    if "quantity" in item_columns
                    else "NULL AS first_product_quantity"
                )
                item_price_column = next((name for name in ("unit_price", "price") if name in item_columns), None)
                first_price_sql = (
                    f"(SELECT oi.`{item_price_column}` FROM order_items oi WHERE oi.order_id = o.id "
                    "ORDER BY oi.product_id LIMIT 1) AS first_product_unit_price"
                    if item_price_column
                    else "NULL AS first_product_unit_price"
                )
                first_item_sql = (
                    "(SELECT p.name FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id "
                    "WHERE oi.order_id = o.id ORDER BY oi.product_id LIMIT 1) AS first_product_name, "
                    "(SELECT p.image_url FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id "
                    "WHERE oi.order_id = o.id ORDER BY oi.product_id LIMIT 1) AS first_product_image_url, "
                    "(SELECT GROUP_CONCAT(p.name ORDER BY oi.product_id SEPARATOR ', ') FROM order_items oi "
                    "LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS product_names, "
                    f"{first_quantity_sql}, {first_price_sql}"
                    if "image_url" in product_columns
                    else "(SELECT p.name FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id "
                    "WHERE oi.order_id = o.id ORDER BY oi.product_id LIMIT 1) AS first_product_name, "
                    "NULL AS first_product_image_url, "
                    "(SELECT GROUP_CONCAT(p.name ORDER BY oi.product_id SEPARATOR ', ') FROM order_items oi "
                    "LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS product_names, "
                    f"{first_quantity_sql}, {first_price_sql}"
                )
    with session_scope() as session:
        rows = session.execute(
            text(
                f"SELECT o.id, o.user_id, COALESCE(o.customer_name_snapshot, u.name) AS customer_name, "
                f"COALESCE(o.customer_email_snapshot, u.email) AS customer_email, "
                "o.contact_number, o.address_line, o.barangay, o.city, o.province, o.postal_code, "
                f"u.profile_image_url AS customer_profile_image_url, "
                f"o.`{total_column}` AS total, o.status, o.payment_method, o.payment_status, "
                f"o.rejection_reason, o.received_at, o.`{date_column}` AS created_at, "
                f"{item_count_sql.replace('orders.id', 'o.id')}, {first_item_sql} "
                "FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC"
            )
        ).all()
        return [
            {
                "id": row.id,
                "user_id": row.user_id,
                "customer_name": row.customer_name,
                "customer_email": row.customer_email,
                "contact_number": row.contact_number,
                "address_line": row.address_line,
                "barangay": row.barangay,
                "city": row.city,
                "province": row.province,
                "postal_code": row.postal_code,
                "customer_profile_image_url": row.customer_profile_image_url,
                "total": float(row.total or 0),
                "status": row.status,
                "payment_method": row.payment_method,
                "payment_status": row.payment_status,
                "rejection_reason": row.rejection_reason,
                "received_at": row.received_at.isoformat() if row.received_at else None,
                "created_at": row.created_at,
                "item_count": int(row.item_count or 0),
                "first_product_name": row.first_product_name,
                "first_product_image_url": row.first_product_image_url,
                "product_names": row.product_names,
                "first_product_quantity": int(row.first_product_quantity or 0) if row.first_product_quantity is not None else None,
                "first_product_unit_price": float(row.first_product_unit_price) if row.first_product_unit_price is not None else None,
            }
            for row in rows
        ]


def get_order_details(order_id):
    with session_scope() as session:
        order = session.get(Order, order_id)
        if order is None:
            return None
        customer = session.get(User, order.user_id) if order.user_id is not None else None
        lines = session.execute(
            select(OrderItem, Product, Category)
            .outerjoin(Product, Product.id == OrderItem.product_id)
            .outerjoin(Category, Category.id == Product.category_id)
            .where(OrderItem.order_id == order.id)
            .order_by(OrderItem.id)
        ).all()
        history = session.scalars(
            select(OrderStatusHistory)
            .where(OrderStatusHistory.order_id == order.id)
            .order_by(OrderStatusHistory.created_at, OrderStatusHistory.id)
        ).all()
        feedback_by_product = {
            feedback.product_id: feedback
            for feedback in session.scalars(
                select(ProductFeedback).where(
                    ProductFeedback.order_id == order.id,
                    ProductFeedback.user_id == order.user_id,
                )
            ).all()
        }
        timeline = [
            {
                "status": event.status,
                "reason": event.reason,
                "created_at": event.created_at.isoformat() if event.created_at else None,
            }
            for event in history
        ]
        if not timeline:
            timeline.append({
                "status": order.status,
                "reason": order.rejection_reason,
                "created_at": order.created_at.isoformat() if order.created_at else None,
            })
        return {
            "id": order.id,
            "user_id": order.user_id,
            "customer_name": order.customer_name_snapshot or (customer.name if customer else None),
            "customer_email": order.customer_email_snapshot or (customer.email if customer else None),
            "customer_profile_image_url": customer.profile_image_url if customer else None,
            "contact_number": order.contact_number,
            "address_line": order.address_line,
            "barangay": order.barangay,
            "city": order.city,
            "province": order.province,
            "postal_code": order.postal_code,
            "total": float(order.total or 0),
            "status": order.status,
            "payment_method": order.payment_method,
            "payment_status": order.payment_status,
            "rejection_reason": order.rejection_reason,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "received_at": order.received_at.isoformat() if order.received_at else None,
            "items": [
                {
                    "product_id": line.product_id,
                    "name": product.name if product else "Product no longer available",
                    "image_url": product.image_url if product else None,
                    "category_name": category.name if category else None,
                    "quantity": line.quantity,
                    "unit_price": float(line.unit_price or 0),
                    "subtotal": float(line.total or 0),
                    "feedback": (
                        {
                            "id": feedback_by_product[line.product_id].id,
                            "rating": feedback_by_product[line.product_id].rating,
                            "review": feedback_by_product[line.product_id].review,
                            "created_at": feedback_by_product[line.product_id].created_at.isoformat()
                            if feedback_by_product[line.product_id].created_at else None,
                        }
                        if line.product_id in feedback_by_product else None
                    ),
                }
                for line, product, category in lines
            ],
            "timeline": timeline,
        }


def submit_product_feedback(order_id, product_id, user_id, rating, review):
    if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
        raise ValueError("Choose a rating from 1 to 5 stars.")
    if review is not None and not isinstance(review, str):
        raise ValueError("Feedback must be text.")
    if isinstance(review, str) and len(review) > 1500:
        raise ValueError("Feedback must be 1,500 characters or fewer.")
    clean_review = review.strip() if isinstance(review, str) else ""
    with session_scope() as session:
        order = session.scalar(
            select(Order).where(Order.id == order_id).with_for_update()
        )
        if order is None or order.user_id != user_id:
            return None
        if order.status.casefold() != "completed":
            raise ValueError("You can review products only after Staff marks the order as completed.")
        purchased_product = session.scalar(
            select(OrderItem.id).where(
                OrderItem.order_id == order.id,
                OrderItem.product_id == product_id,
            )
        )
        if purchased_product is None:
            return None
        if session.scalar(
            select(ProductFeedback.id).where(
                ProductFeedback.order_id == order.id,
                ProductFeedback.product_id == product_id,
            )
        ) is not None:
            raise ValueError("You have already submitted feedback for this product and order.")
        product = session.get(Product, product_id)
        if product is None:
            raise ValueError("This product is no longer available for feedback.")
        feedback = ProductFeedback(
            order_id=order.id,
            product_id=product.id,
            user_id=user_id,
            rating=rating,
            review=clean_review or None,
        )
        session.add(feedback)
        session.flush()
        customer = session.get(User, user_id)
        customer_name = customer.name if customer else "Customer"
        _create_user_notification(
            session,
            user_id,
            "product-feedback-submitted",
            "Feedback submitted",
            f"Your {rating}-star review for {product.name} was submitted.",
            related_type="product",
            related_id=product.id,
            event_key=f"customer-product-feedback:{feedback.id}",
        )
        _notify_order_managers(
            session,
            "product-feedback",
            "New product feedback",
            f"{customer_name} submitted a {rating}-star review for {product.name} from order #{order.id}.",
            "product",
            product.id,
            f"product-feedback:{feedback.id}",
        )
        return {
            "id": feedback.id,
            "order_id": feedback.order_id,
            "product_id": feedback.product_id,
            "rating": feedback.rating,
            "review": feedback.review,
            "created_at": feedback.created_at.isoformat() if feedback.created_at else None,
        }


def list_product_feedback(product_id):
    with session_scope() as session:
        if session.get(Product, product_id) is None:
            return None
        rows = session.execute(
            select(ProductFeedback, User)
            .join(User, User.id == ProductFeedback.user_id)
            .where(ProductFeedback.product_id == product_id)
            .order_by(ProductFeedback.created_at.desc(), ProductFeedback.id.desc())
        ).all()
        ratings = [feedback.rating for feedback, _customer in rows]
        return {
            "average_rating": sum(ratings) / len(ratings) if ratings else None,
            "review_count": len(ratings),
            "items": [
                {
                    "id": feedback.id,
                    "order_id": feedback.order_id,
                    "customer_name": customer.name,
                    "customer_profile_image_url": customer.profile_image_url,
                    "rating": feedback.rating,
                    "review": feedback.review,
                    "created_at": feedback.created_at.isoformat() if feedback.created_at else None,
                }
                for feedback, customer in rows
            ],
        }


def list_all_product_feedback():
    with session_scope() as session:
        rows = session.execute(
            select(ProductFeedback, User, Product)
            .join(User, User.id == ProductFeedback.user_id)
            .join(Product, Product.id == ProductFeedback.product_id)
            .order_by(ProductFeedback.created_at.desc(), ProductFeedback.id.desc())
        ).all()
        return [
            {
                "id": feedback.id,
                "order_id": feedback.order_id,
                "product_id": product.id,
                "product_name": product.name,
                "product_image_url": product.image_url,
                "customer_id": customer.id,
                "customer_name": customer.name,
                "customer_profile_image_url": customer.profile_image_url,
                "rating": feedback.rating,
                "review": feedback.review,
                "created_at": feedback.created_at.isoformat() if feedback.created_at else None,
            }
            for feedback, customer, product in rows
        ]


def _validate_checkout_info(customer_info):
    if not isinstance(customer_info, dict):
        raise ValueError("Complete the customer information before placing your order.")
    fields = {
        "customer_name": customer_info.get("full_name"),
        "customer_email": customer_info.get("email"),
        "contact_number": customer_info.get("contact_number"),
        "address_line": customer_info.get("address_line"),
        "barangay": customer_info.get("barangay"),
        "city": customer_info.get("city"),
        "province": customer_info.get("province"),
        "postal_code": customer_info.get("postal_code"),
    }
    clean = {
        key: value.strip() if isinstance(value, str) else ""
        for key, value in fields.items()
    }
    errors = {}
    if not clean["customer_name"] or len(clean["customer_name"]) > 255:
        errors["full_name"] = "Enter your full name using no more than 255 characters."
    if len(clean["customer_email"]) > 255 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", clean["customer_email"]):
        errors["email"] = "Enter a valid contact email address."
    if not re.fullmatch(r"(?:09\d{9}|\+639\d{9})", clean["contact_number"]):
        errors["contact_number"] = "Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX)."
    for key, label, maximum in (
        ("address_line", "House number, building, and street", 255),
        ("barangay", "Barangay", 120),
        ("city", "City or municipality", 120),
        ("province", "Province", 120),
    ):
        if not clean[key]:
            errors[key] = f"Enter your {label.lower()}."
        elif len(clean[key]) > maximum:
            errors[key] = f"This field must be {maximum} characters or fewer."
    if len(clean["postal_code"]) > 20:
        errors["postal_code"] = "Postal code must be 20 characters or fewer."
    if errors:
        raise CheckoutValidationError(errors)
    clean["save_to_profile"] = customer_info.get("save_to_profile") is True
    return clean


def create_order(user_id, items, payment_method="cash_on_pickup", idempotency_key=None, customer_info=None):
    if not isinstance(items, list) or not items:
        return None
    if payment_method != "cash_on_pickup":
        raise ValueError("Choose a supported payment method.")
    if not isinstance(idempotency_key, str) or not idempotency_key.strip() or len(idempotency_key) > 64:
        raise ValueError("A valid checkout request key is required.")
    checkout_info = _validate_checkout_info(customer_info)
    order_columns = {column["name"] for column in inspect(engine).get_columns("orders")}
    item_columns = {column["name"] for column in inspect(engine).get_columns("order_items")}
    order_date_column = next((name for name in ("created_at", "order_date") if name in order_columns), None)
    order_total_column = next((name for name in ("total", "total_amount") if name in order_columns), None)
    item_price_column = next((name for name in ("unit_price", "price") if name in item_columns), None)
    item_total_column = next((name for name in ("total", "subtotal") if name in item_columns), None)
    item_date_column = "created_at" if "created_at" in item_columns else None
    if not order_date_column or not order_total_column or not item_price_column or not item_total_column:
        raise RuntimeError("The orders tables are missing required order creation columns.")
    with session_scope() as session:
        customer = session.scalar(select(User).where(User.id == user_id).with_for_update())
        if customer is None or customer.role != "customer":
            raise ValueError("Only a customer account can place an order.")
        existing_order = session.scalar(
            select(Order).where(
                Order.user_id == user_id,
                Order.idempotency_key == idempotency_key.strip(),
            )
        )
        if existing_order is not None:
            return {
                "id": existing_order.id,
                "user_id": existing_order.user_id,
                "total": float(existing_order.total or 0),
                "status": existing_order.status,
                "payment_method": existing_order.payment_method,
                "payment_status": existing_order.payment_status,
                "customer_name": existing_order.customer_name_snapshot,
                "customer_email": existing_order.customer_email_snapshot,
                "contact_number": existing_order.contact_number,
                "address_line": existing_order.address_line,
                "barangay": existing_order.barangay,
                "city": existing_order.city,
                "province": existing_order.province,
                "postal_code": existing_order.postal_code,
                "created_at": existing_order.created_at,
            }
        if checkout_info["save_to_profile"]:
            customer.contact_number = checkout_info["contact_number"]
            customer.address_line = checkout_info["address_line"]
            customer.barangay = checkout_info["barangay"]
            customer.city = checkout_info["city"]
            customer.province = checkout_info["province"]
            customer.postal_code = checkout_info["postal_code"] or None
            customer.updated_at = datetime.utcnow()
        total = Decimal("0.00")
        order_lines = []
        requested_quantities = {}
        for entry in items:
            if not isinstance(entry, dict):
                raise ValueError("Each cart item must include a product and quantity.")
            product_id = entry.get("product_id")
            quantity = entry.get("quantity", 1)
            if isinstance(product_id, bool) or not isinstance(quantity, int) or isinstance(quantity, bool) or quantity < 1:
                raise ValueError("Cart quantities must be whole numbers greater than zero.")
            if not isinstance(product_id, (int, str)):
                raise ValueError("A product in your cart is invalid.")
            try:
                product_id = int(product_id)
            except (TypeError, ValueError):
                raise ValueError("A product in your cart is invalid.") from None
            if product_id < 1:
                raise ValueError("A product in your cart is invalid.")
            requested_quantities[product_id] = requested_quantities.get(product_id, 0) + quantity

        for product_id in sorted(requested_quantities):
            quantity = requested_quantities[product_id]
            product = session.scalar(select(Product).where(Product.id == product_id).with_for_update())
            if product is None:
                raise ValueError("A product in your cart is no longer available.")
            if product.status != "active":
                raise ValueError(f"{product.name} is no longer available.")
            if quantity > int(product.stock or 0):
                raise ValueError(f"Only {int(product.stock or 0)} units of {product.name} are currently available.")
            unit_price = Decimal(str(product.price))
            line_total = unit_price * quantity
            total += line_total
            order_lines.append((product_id, quantity, unit_price, line_total))
            product.stock -= quantity
            inventory_item = session.scalar(select(Inventory).where(Inventory.product_id == product.id).with_for_update())
            now = datetime.utcnow()
            if inventory_item is None:
                inventory_item = Inventory(
                    product_id=product.id,
                    quantity=product.stock,
                    stock_in_hand=product.stock,
                    reorder_level=0,
                    location="main",
                    updated_at=now,
                    last_updated=now,
                )
                session.add(inventory_item)
            else:
                inventory_item.quantity = inventory_item.stock_in_hand = product.stock
                inventory_item.updated_at = inventory_item.last_updated = now
            _sync_low_stock_notification(
                session,
                product,
                product.stock + quantity,
                product.stock,
                _low_stock_threshold(session, inventory_item),
            )
        insert_columns = ["`user_id`", f"`{order_total_column}`", "`status`", f"`{order_date_column}`"]
        insert_values = [":user_id", ":total", ":status", ":order_date"]
        insert_columns.extend(["`payment_method`", "`payment_status`", "`idempotency_key`", "`stock_reserved`"])
        insert_values.extend([":payment_method", ":payment_status", ":idempotency_key", ":stock_reserved"])
        insert_columns.extend([
            "`customer_name_snapshot`",
            "`customer_email_snapshot`",
            "`contact_number`",
            "`address_line`",
            "`barangay`",
            "`city`",
            "`province`",
            "`postal_code`",
        ])
        insert_values.extend([
            ":customer_name",
            ":customer_email",
            ":contact_number",
            ":address_line",
            ":barangay",
            ":city",
            ":province",
            ":postal_code",
        ])
        order_parameters = {
            "user_id": user_id,
            "total": str(total),
            "status": "Pending Confirmation",
            "order_date": datetime.utcnow(),
            "payment_method": payment_method,
            "payment_status": "Unpaid",
            "idempotency_key": idempotency_key.strip(),
            "stock_reserved": True,
            "customer_name": checkout_info["customer_name"],
            "customer_email": checkout_info["customer_email"],
            "contact_number": checkout_info["contact_number"],
            "address_line": checkout_info["address_line"],
            "barangay": checkout_info["barangay"],
            "city": checkout_info["city"],
            "province": checkout_info["province"],
            "postal_code": checkout_info["postal_code"] or None,
        }
        order_result = session.execute(
            text(
                f"INSERT INTO `orders` ({', '.join(insert_columns)}) "
                f"VALUES ({', '.join(insert_values)})"
            ),
            order_parameters,
        )
        order_id = order_result.lastrowid
        session.add(OrderStatusHistory(
            order_id=order_id,
            status="Pending Confirmation",
            reason=None,
            changed_by=user_id,
        ))
        for product_id, quantity, unit_price, line_total in order_lines:
            item_insert_columns = [
                "`order_id`",
                "`product_id`",
                "`quantity`",
                f"`{item_price_column}`",
                f"`{item_total_column}`",
            ]
            item_insert_values = [
                ":order_id",
                ":product_id",
                ":quantity",
                ":unit_price",
                ":line_total",
            ]
            if item_date_column:
                item_insert_columns.append(f"`{item_date_column}`")
                item_insert_values.append(":created_at")
            item_parameters = {
                "order_id": order_id,
                "product_id": product_id,
                "quantity": quantity,
                "unit_price": str(unit_price),
                "line_total": str(line_total),
            }
            if item_date_column:
                item_parameters["created_at"] = datetime.utcnow()
            session.execute(
                text(
                    f"INSERT INTO `order_items` ({', '.join(item_insert_columns)}) "
                    f"VALUES ({', '.join(item_insert_values)})"
                ),
                item_parameters,
            )
            product = session.get(Product, product_id)
            if product is not None:
                _notify_admins(
                    session,
                    "inventory-updated",
                    "Order stock reserved",
                    f"{quantity} units of {product.name} were deducted for order #{order_id}.",
                    related_type="order",
                    related_id=order_id,
                    event_key=f"inventory-order-reserved:order:{order_id}:product:{product_id}",
                    product_id=product_id,
                )
        customer = session.get(User, user_id)
        customer_name = customer.name if customer else "A customer"
        _notify_admins(
            session,
            "customer-order",
            "New customer order received",
            f"Order #{order_id} from {customer_name} has been submitted and is Pending Confirmation.",
            related_type="order",
            related_id=order_id,
            event_key=f"customer-order:{order_id}",
        )
        _notify_staff_users(
            session,
            "customer-order",
            "New customer order",
            f"Order #{order_id} from {customer_name} is waiting for confirmation.",
            "order",
            order_id,
            f"staff-customer-order:{order_id}",
        )
        if customer is not None and customer.role == "customer":
            _create_user_notification(
                session,
                customer.id,
                "order-placed",
                "Order placed",
                f"Your order #{order_id} has been submitted successfully.",
                related_type="order",
                related_id=order_id,
                event_key=f"customer-order-placed:{order_id}",
            )
        return {
            "id": order_id,
            "user_id": user_id,
            "total": float(total),
            "status": "Pending Confirmation",
            "payment_method": payment_method,
            "payment_status": "Unpaid",
            "customer_name": checkout_info["customer_name"],
            "customer_email": checkout_info["customer_email"],
            "contact_number": checkout_info["contact_number"],
            "address_line": checkout_info["address_line"],
            "barangay": checkout_info["barangay"],
            "city": checkout_info["city"],
            "province": checkout_info["province"],
            "postal_code": checkout_info["postal_code"] or None,
            "created_at": datetime.utcnow(),
        }


def update_order_status(order_id, status, reason=None, changed_by=None, customer_user_id=None):
    if not isinstance(status, str) or not status.strip() or len(status.strip()) > 50:
        raise ValueError("Order status must be text with 1 to 50 characters.")
    if reason is not None and (not isinstance(reason, str) or len(reason.strip()) > 500):
        raise ValueError("Order status reason must be text with 500 characters or fewer.")

    requested_key = status.strip().casefold().replace(" ", "").replace("-", "").replace("_", "")
    status_names = {
        "pending": "Pending",
        "pendingconfirmation": "Pending Confirmation",
        "approved": "Confirmed",
        "confirmed": "Confirmed",
        "rejected": "Rejected",
        "processing": "Processing",
        "ready": "Ready for Pickup",
        "readyforpickup": "Ready for Pickup",
        "outfordelivery": "Out for Delivery",
        "completed": "Completed",
        "cancelled": "Cancelled",
        "canceled": "Cancelled",
    }
    if requested_key not in status_names:
        raise ValueError("Choose a supported order status.")
    next_status = status_names[requested_key]
    status_key = next_status.casefold().replace(" ", "").replace("-", "").replace("_", "")
    clean_reason = reason.strip() if isinstance(reason, str) else ""
    if status_key == "rejected" and not clean_reason:
        raise ValueError("A reason is required when rejecting an order.")
    status_notifications = {
        "confirmed": ("order-confirmed", "Order confirmed", "Your order has been confirmed by Staff."),
        "rejected": ("order-rejected", "Order rejected", "Your order was rejected."),
        "processing": ("order-processing", "Order processing", "Your order is being prepared."),
        "readyforpickup": ("order-ready-for-pickup", "Ready for pickup", "Your order is ready for pickup."),
        "outfordelivery": ("order-out-for-delivery", "Out for delivery", "Your order is on its way."),
        "completed": ("order-completed", "Order completed", "Your order has been picked up and completed."),
        "cancelled": ("order-cancelled", "Order cancelled", "Your order has been cancelled."),
    }

    with session_scope() as session:
        order = session.scalar(select(Order).where(Order.id == order_id).with_for_update())
        if order is None:
            return None

        previous_status = order.status
        previous_key = previous_status.casefold().replace(" ", "").replace("-", "").replace("_", "")
        previous_key = {
            "pendingconfirmation": "pending",
            "approved": "confirmed",
            "ready": "readyforpickup",
        }.get(previous_key, previous_key)
        status_key = {"pendingconfirmation": "pending"}.get(status_key, status_key)
        if customer_user_id is not None:
            if order.user_id != customer_user_id:
                return None
            if previous_key != "pending" or status_key != "cancelled":
                raise ValueError("You can cancel an order only while it is waiting for Staff confirmation.")
            if order.created_at is None or datetime.utcnow() - order.created_at > timedelta(minutes=5):
                raise ValueError("The 5-minute cancellation period for this order has expired.")
        if previous_key != status_key:
            transitions = {
                "pending": {"confirmed", "rejected", "cancelled"},
                "confirmed": {"processing", "cancelled"},
                "processing": {"readyforpickup", "outfordelivery", "cancelled"},
                "readyforpickup": {"completed", "cancelled"},
                "outfordelivery": {"completed", "cancelled"},
            }
            if status_key not in transitions.get(previous_key, set()):
                raise ValueError(f"Order status cannot change from {previous_status} to {next_status}.")
            is_cancelled_after = status_key in {"cancelled", "rejected"}
            if is_cancelled_after and order.stock_reserved:
                order_items = session.execute(
                    text("SELECT product_id, quantity FROM order_items WHERE order_id = :order_id ORDER BY product_id FOR UPDATE"),
                    {"order_id": order.id},
                ).all()
                for product_id, quantity in order_items:
                    product = session.scalar(select(Product).where(Product.id == product_id).with_for_update())
                    if product is None:
                        continue
                    previous_quantity = int(product.stock or 0)
                    product.stock = previous_quantity + int(quantity)
                    inventory_item = session.scalar(select(Inventory).where(Inventory.product_id == product.id).with_for_update())
                    changed_at = datetime.utcnow()
                    if inventory_item is None:
                        inventory_item = Inventory(
                            product_id=product.id,
                            quantity=product.stock,
                            stock_in_hand=product.stock,
                            reorder_level=0,
                            location="main",
                            updated_at=changed_at,
                            last_updated=changed_at,
                        )
                        session.add(inventory_item)
                    else:
                        inventory_item.quantity = inventory_item.stock_in_hand = product.stock
                        inventory_item.updated_at = inventory_item.last_updated = changed_at
                    _sync_low_stock_notification(
                        session,
                        product,
                        previous_quantity,
                        product.stock,
                        _low_stock_threshold(session, inventory_item),
                    )
                    _notify_admins(
                        session,
                        "inventory-updated",
                        "Cancelled order stock returned",
                        f"{quantity} units of {product.name} were returned to inventory after order #{order.id} was cancelled.",
                        related_type="order",
                        related_id=order.id,
                        event_key=f"inventory-return:order:{order.id}:product:{product.id}",
                        product_id=product.id,
                    )
                order.stock_reserved = False
            changed_at = datetime.utcnow()
            order.status = next_status
            order.updated_at = changed_at
            if status_key == "completed":
                order.received_at = changed_at
                if order.payment_method == "cash_on_pickup":
                    order.payment_status = "Paid"
            order.rejection_reason = clean_reason if status_key in {"rejected", "cancelled"} else None
            session.add(OrderStatusHistory(
                order_id=order.id,
                status=next_status,
                reason=clean_reason or None,
                changed_by=changed_by,
                created_at=changed_at,
            ))
            customer = session.get(User, order.user_id) if order.user_id is not None else None
            if customer is not None and customer.role == "customer":
                kind, title, message = status_notifications[status_key]
                if clean_reason:
                    message = f"{message} Reason: {clean_reason}"
                _create_user_notification(
                    session,
                    customer.id,
                    kind,
                    title,
                    f"Order #{order.id}: {message}",
                    related_type="order",
                    related_id=order.id,
                    event_key=f"customer-order-status:{order.id}:{changed_at.isoformat()}",
                )
                if status_key == "completed" and order.payment_method == "cash_on_pickup":
                    _create_user_notification(
                        session,
                        customer.id,
                        "order-payment-received",
                        "Cash payment received",
                        f"Cash payment for order #{order.id} was confirmed by Staff at pickup.",
                        related_type="order",
                        related_id=order.id,
                        event_key=f"customer-order-payment:{order.id}:paid",
                    )
        return {
            "id": order.id,
            "user_id": order.user_id,
            "previous_status": previous_status,
            "status": order.status,
            "payment_status": order.payment_status,
            "received_at": order.received_at.isoformat() if order.received_at else None,
        }


def update_order_payment_status(order_id, payment_status, changed_by):
    normalized_status = payment_status.strip().casefold() if isinstance(payment_status, str) else ""
    if normalized_status != "paid":
        raise ValueError("For Cash on Pickup, payment can only be marked paid after collection.")
    with session_scope() as session:
        order = session.scalar(select(Order).where(Order.id == order_id).with_for_update())
        if order is None:
            return None
        if order.payment_status.casefold() == "paid":
            return {"id": order.id, "payment_status": order.payment_status}
        if order.status.casefold() in {"rejected", "cancelled", "canceled"}:
            raise ValueError("Payment cannot be recorded for a rejected or cancelled order.")
        if order.status.casefold() != "completed":
            raise ValueError("Payment can be recorded after the pickup order is completed.")
        order.payment_status = "Paid"
        changed_at = datetime.utcnow()
        customer = session.get(User, order.user_id) if order.user_id is not None else None
        if customer is not None and customer.role == "customer":
            _create_user_notification(
                session,
                customer.id,
                "order-payment-received",
                "Payment received",
                f"Payment for order #{order.id} was recorded after collection.",
                related_type="order",
                related_id=order.id,
                event_key=f"customer-order-payment:{order.id}:paid",
            )
        return {"id": order.id, "payment_status": order.payment_status}


def list_sales():
    columns = {column["name"] for column in inspect(engine).get_columns("sales")}
    date_column = next((name for name in ("created_at", "sale_date") if name in columns), None)
    total_column = next((name for name in ("total", "total_amount") if name in columns), None)
    if date_column is None or total_column is None:
        raise RuntimeError("The sales table is missing required list columns.")
    with session_scope() as session:
        rows = session.execute(
            text(
                f"SELECT id, user_id, `{total_column}` AS total, payment_method, status, "
                f"`{date_column}` AS created_at FROM sales ORDER BY id DESC"
            )
        ).all()
        return [
            {
                "id": row.id,
                "user_id": row.user_id,
                "total": float(row.total or 0),
                "payment_method": row.payment_method,
                "status": row.status,
                "created_at": row.created_at,
            }
            for row in rows
        ]


def create_sale(user_id, items, payment_method="cash", status="completed"):
    if not items:
        return None
    with session_scope() as session:
        sale = Sale(user_id=user_id, total=Decimal("0.00"), payment_method=payment_method, status=status)
        session.add(sale)
        session.flush()
        total = Decimal("0.00")
        for entry in items:
            product_id = entry.get("product_id")
            quantity = int(entry.get("quantity", 1))
            if product_id is None:
                continue
            product = session.get(Product, product_id)
            if product is None:
                continue
            unit_price = Decimal(str(product.price))
            line_total = unit_price * quantity
            total += line_total
            session.add(SaleItem(sale_id=sale.id, product_id=product_id, quantity=quantity, unit_price=unit_price, total=line_total))
        sale.total = total
        return {"id": sale.id, "user_id": user_id, "total": float(sale.total), "payment_method": payment_method, "status": status, "created_at": sale.created_at}
