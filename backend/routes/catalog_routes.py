import re

from flask import Blueprint, jsonify, request, session
from sqlalchemy.exc import IntegrityError

from ..auth import authenticated_user, login_required, role_required
from ..database import (
    add_stock,
    create_category,
    create_order,
    create_product,
    create_sale,
    delete_category,
    get_order_details,
    list_all_product_feedback,
    list_product_feedback,
    update_order_status,
    update_order_payment_status,
    submit_product_feedback,
    list_categories,
    list_inventory,
    list_orders,
    list_products,
    list_sales,
    update_category,
    update_inventory,
    update_product,
)
catalog_bp = Blueprint("catalog_bp", __name__)


@catalog_bp.get("/api/categories")
def categories():
    return jsonify({"items": list_categories()})


@catalog_bp.post("/api/categories")
@role_required("admin")
def create_category_route():
    payload = request.get_json(silent=True) or {}
    name = payload.get("name", "")
    description = payload.get("description", "")
    item = create_category(name, description)
    if item is None:
        return jsonify({"error": "Category name is required."}), 400
    return jsonify({"message": "Category created successfully.", "category": item}), 201


@catalog_bp.put("/api/categories/<int:category_id>")
@role_required("admin")
def update_category_route(category_id):
    payload = request.get_json(silent=True) or {}
    item = update_category(category_id, payload.get("name"), payload.get("description", ""))
    if item is None:
        return jsonify({"error": "Category not found."}), 404
    return jsonify({"message": "Category updated successfully.", "category": item})


@catalog_bp.delete("/api/categories/<int:category_id>")
@role_required("admin")
def delete_category_route(category_id):
    if not delete_category(category_id):
        return jsonify({"error": "Category not found."}), 404
    return jsonify({"message": "Category deleted successfully."})


@catalog_bp.get("/api/products")
@login_required
def products():
    user = authenticated_user()
    if session.get("monitoring_session_id"):
        from ..database import record_activity

        record_activity(user["id"], session["monitoring_session_id"], "product_viewed", "Viewed the product catalog", "Products", request.remote_addr)
    return jsonify(
        list_products(
            include_inactive=user["role"] != "customer",
            include_cost=user["role"] == "admin",
        )
    )


@catalog_bp.post("/api/products")
@role_required("admin")
def create_product_route():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    category_id = payload.get("category_id")
    price = payload.get("price")
    stock = payload.get("stock")
    product_code = payload.get("product_code")
    reorder_level = payload.get("reorder_level", 0)
    if not name:
        return jsonify({"error": "Product name is required."}), 400
    if not isinstance(product_code, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", product_code.strip()):
        return jsonify({"error": "Enter a valid product code."}), 400
    try:
        price_value = float(price)
        stock_value = int(stock)
        reorder_value = int(reorder_level)
    except (TypeError, ValueError):
        return jsonify({"error": "Price, stock, and minimum stock level must be valid values."}), 400
    if price_value < 0 or stock_value < 0 or reorder_value < 0:
        return jsonify({"error": "Price, stock, and minimum stock level cannot be negative."}), 400
    try:
        product = create_product(
            name,
            category_id,
            price_value,
            stock_value,
            payload.get("description", ""),
            payload.get("image_url"),
            payload.get("unit_cost", 0),
            payload.get("status", "active"),
            product_code.strip().upper(),
            reorder_value,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 409
    if product is None:
        return jsonify({"error": "Could not create product."}), 400
    return jsonify({"message": "Product created successfully.", "product": product}), 201


@catalog_bp.put("/api/products/<product_id>")
@role_required("admin")
def edit_product(product_id):
    payload = request.get_json(silent=True) or {}
    try:
        price = float(payload["price"])
        stock = int(payload["stock"])
        reorder_level = int(payload.get("reorder_level", 0))
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "price and stock must be valid numbers"}), 400
    product_code = payload.get("product_code")
    if not isinstance(product_code, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", product_code.strip()):
        return jsonify({"error": "Enter a valid product code."}), 400
    if price < 0 or stock < 0 or reorder_level < 0:
        return jsonify({"error": "price, stock, and minimum stock level cannot be negative"}), 400
    user = authenticated_user()
    try:
        updated = update_product(
            product_id,
            price,
            stock,
            name=payload.get("name"),
            description=payload.get("description"),
            category_id=payload.get("category_id"),
            unit_cost=payload.get("unit_cost"),
            status=payload.get("status"),
            actor_name=user["name"],
            product_code=product_code.strip().upper(),
            reorder_level=reorder_level,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 409
    if not updated:
        return jsonify({"error": "product not found"}), 404
    from ..database import record_activity

    record_activity(user["id"], session["monitoring_session_id"], "product_updated", f"Updated product {product_id}", "Products", request.remote_addr)
    return jsonify(next((product for product in list_products() if str(product["id"]) == str(product_id)), None))


@catalog_bp.post("/api/products/<product_id>/stock")
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
    from ..database import record_activity

    record_activity(user["id"], session["monitoring_session_id"], "stock_updated", f"Added {amount} units to product {product_id}", "Inventory", request.remote_addr)
    return jsonify(next((product for product in list_products(include_cost=False) if str(product["id"]) == str(product_id)), None))


@catalog_bp.get("/api/inventory")
@login_required
def inventory():
    return jsonify({"items": list_inventory()})


@catalog_bp.put("/api/inventory/<int:product_id>")
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
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    if item is None:
        return jsonify({"error": "Product not found."}), 404
    from ..database import record_activity

    record_activity(
        user["id"],
        session.get("monitoring_session_id"),
        "inventory_updated",
        f"Adjusted inventory for product {product_id} to {quantity_value} units with reorder level {reorder_value}.",
        "Inventory",
        request.remote_addr,
    )
    return jsonify({"message": "Inventory updated successfully.", "inventory": item})


@catalog_bp.get("/api/orders")
@login_required
def orders():
    user = authenticated_user()
    items = list_orders()
    if user["role"] == "customer":
        items = [order for order in items if order["user_id"] == user["id"]]
    return jsonify({"items": items})


@catalog_bp.post("/api/orders")
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
    return jsonify({"message": "Order created successfully.", "order": order}), 201


@catalog_bp.get("/api/orders/<int:order_id>")
@login_required
def order_details_route(order_id):
    user = authenticated_user()
    order = get_order_details(order_id)
    if order is None or (user["role"] == "customer" and order["user_id"] != user["id"]):
        return jsonify({"error": "Order not found."}), 404
    return jsonify({"order": order})

@catalog_bp.post("/api/orders/<int:order_id>/feedback")
@role_required("customer")
def submit_order_feedback_route(order_id):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "A valid product review is required."}), 400
    product_id = payload.get("product_id")
    if isinstance(product_id, bool) or not isinstance(product_id, int):
        return jsonify({"error": "Choose a valid product to review."}), 400
    user = authenticated_user()
    try:
        feedback = submit_product_feedback(
            order_id,
            product_id,
            user["id"],
            payload.get("rating"),
            payload.get("review"),
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except IntegrityError:
        return jsonify({"error": "You have already submitted feedback for this product and order."}), 409
    if feedback is None:
        return jsonify({"error": "Feedback is available only for products in your own order."}), 404
    return jsonify({"message": "Product feedback submitted successfully.", "feedback": feedback}), 201


@catalog_bp.get("/api/products/<int:product_id>/reviews")
@login_required
def product_reviews_route(product_id):
    reviews = list_product_feedback(product_id)
    if reviews is None:
        return jsonify({"error": "Product not found."}), 404
    return jsonify(reviews)


@catalog_bp.get("/api/product-feedback")
@login_required
def product_feedback_list_route():
    user = authenticated_user()
    if user["role"] not in {"admin", "staff"}:
        return jsonify({"error": "You are not authorized to view product feedback."}), 403
    return jsonify({"items": list_all_product_feedback()})


@catalog_bp.put("/api/orders/<int:order_id>")
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
    return jsonify({"message": "Order updated successfully.", "order": get_order_details(order_id)})


@catalog_bp.put("/api/orders/<int:order_id>/payment")
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
    return jsonify({"message": "Payment status updated.", "order": order})


@catalog_bp.get("/api/sales")
@login_required
def sales():
    user = authenticated_user()
    items = list_sales()
    if user["role"] == "customer":
        items = [sale for sale in items if sale["user_id"] == user["id"]]
    return jsonify({"items": items})


@catalog_bp.post("/api/sales")
@login_required
def create_sale_route():
    payload = request.get_json(silent=True) or {}
    user = authenticated_user()
    items = payload.get("items", [])
    sale = create_sale(user["id"], items, payload.get("payment_method", "cash"))
    if sale is None:
        return jsonify({"error": "Sale requires at least one product."}), 400
    return jsonify({"message": "Sale created successfully.", "sale": sale}), 201
