from __future__ import annotations

from typing import Any

from .push import NotificationMessage


def product_summary(products: list[dict[str, Any]]) -> str:
    names = [str(product.get("name") or "未知") for product in products]
    return f"当前售卖: {'、'.join(names)}" if names else "当前暂无活跃商品"


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _format_luoke_bay(value: int) -> str:
    if value >= 10000:
        amount = value / 10000
        amount_text = f"{amount:.2f}".rstrip("0").rstrip(".")
        return f"{amount_text}万洛克贝"
    return f"{value}洛克贝"


def _product_line(product: dict[str, Any], *, include_price_info: bool) -> str:
    name = product.get("name", "未知")
    time_label = product.get("time_label", "--:--")
    if include_price_info:
        price = _to_int(product.get("price"))
        buy_limit_num = _to_int(product.get("buy_limit_num"))
        if price is not None and buy_limit_num is not None:
            total = price * buy_limit_num
            return (
                f"{name}*{buy_limit_num}（{time_label}）"
                f"单价{price} 合计{total:,}（{_format_luoke_bay(total)}）"
            )
        return f"{name}（{time_label}）价格未收录"
    return f"{name}（{time_label}）"


def build_merchant_markdown(processed: dict[str, Any], *, include_price_info: bool = False) -> str:
    round_info = processed.get("round_info") or {}
    products = processed.get("products") or []

    lines = [
        "### 远行商人刷新详情",
        "",
        f"- 当前轮次：{round_info.get('current', '--')}/{round_info.get('total', '--')}",
        f"- 剩余时间：{round_info.get('countdown', '--')}",
        f"- 商品数量：{len(products)}",
        "",
    ]

    if products:
        lines.append("#### 当前售卖")
        for product in products:
            lines.append(f"- {_product_line(product, include_price_info=include_price_info)}")
    else:
        lines.append("当前暂无活跃商品。")

    return "\n".join(lines)


def build_notification_message(processed: dict[str, Any], *, include_price_info: bool = False) -> NotificationMessage:
    products = processed.get("products") or []
    body = product_summary(products)
    markdown = build_merchant_markdown(processed, include_price_info=include_price_info)
    return NotificationMessage("远行商人已刷新", body, f"{body}\n\n{markdown}")
