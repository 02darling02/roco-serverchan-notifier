from __future__ import annotations

import unittest

from roco_push_console import app as app_module
from roco_push_console.merchant_message import (
    build_merchant_markdown,
    build_notification_message,
    product_summary,
)


class MerchantMessageTests(unittest.TestCase):
    def test_build_merchant_markdown_keeps_price_display_behavior(self):
        processed = {
            "round_info": {"current": 3, "total": 4, "countdown": "3小时"},
            "products": [
                {"name": "绝缘球", "time_label": "08:00 - 23:59"},
                {
                    "name": "炫彩精灵蛋",
                    "time_label": "16:00 - 20:00",
                    "price": 1600000,
                    "buy_limit_num": 1,
                },
            ],
        }

        markdown = build_merchant_markdown(processed, include_price_info=True)

        self.assertIn("绝缘球（08:00 - 23:59）价格未收录", markdown)
        self.assertIn("炫彩精灵蛋*1（16:00 - 20:00）单价1600000 合计1,600,000（160万洛克贝）", markdown)

    def test_build_merchant_markdown_omits_price_by_default(self):
        processed = {
            "round_info": {"current": 3, "total": 4, "countdown": "3小时"},
            "products": [
                {
                    "name": "黑晶琉璃",
                    "time_label": "16:00 - 20:00",
                    "price": 1000,
                    "buy_limit_num": 100,
                }
            ],
        }

        markdown = build_merchant_markdown(processed)

        self.assertIn("黑晶琉璃（16:00 - 20:00）", markdown)
        self.assertNotIn("单价1000", markdown)

    def test_build_notification_message_uses_summary_and_markdown(self):
        processed = {
            "round_info": {"current": 3, "total": 4, "countdown": "3小时"},
            "products": [{"name": "魔力果", "time_label": "16:00 - 20:00"}],
        }

        message = build_notification_message(processed, include_price_info=False)

        self.assertEqual(message.title, "远行商人已刷新")
        self.assertEqual(message.body, "当前售卖: 魔力果")
        self.assertTrue(message.markdown.startswith("当前售卖: 魔力果\n\n### 远行商人刷新详情"))

    def test_app_reexports_build_merchant_markdown_for_compatibility(self):
        self.assertIs(app_module.build_merchant_markdown, build_merchant_markdown)
        self.assertEqual(product_summary([]), "当前暂无活跃商品")


if __name__ == "__main__":
    unittest.main()
