import assert from "node:assert/strict";
import { test } from "node:test";

import { deliverySummary } from "../src/push-delivery";
import { clearWecomTokenCache, getWecomToken } from "../src/push-provider-auth";
import { postJson } from "../src/push-http";
import { redactSensitiveText } from "../src/push-redaction";
import { sendProvider } from "../src/push-providers";
import type { DeliveryReport, NotificationMessage, ProviderConfig } from "../src/types";

test("split push modules expose delivery, redaction, and provider boundaries", async () => {
  const report: DeliveryReport = { success: true, mode: "all", results: [] };
  const provider: ProviderConfig = {
    id: "p1",
    type: "serverchan",
    name: "Server 酱",
    enabled: true,
    config: { sendkey: "secret-send-key" },
  };
  const message: NotificationMessage = {
    title: "标题",
    body: "摘要",
    markdown: "正文",
  };

  assert.equal(deliverySummary(report), "没有可用推送通道");
  assert.equal(redactSensitiveText(provider, "secret-send-key"), "[已脱敏]");
  assert.equal(typeof sendProvider, "function");
  assert.equal(message.title, "标题");
});

test("push-http preserves non-json error bodies and redacts provider secrets", async () => {
  const originalFetch = globalThis.fetch;
  const provider: ProviderConfig = {
    id: "p1",
    type: "pushplus",
    name: "PushPlus",
    enabled: true,
    config: { token: "secret-token" },
  };
  globalThis.fetch = async () =>
    new Response("bad token=abc secret-token", {
      status: 500,
      statusText: "Internal Server Error",
    });

  try {
    const result = await postJson(provider, "https://example.com/send", {}, 30);

    assert.equal(result.success, false);
    assert.equal(result.statusCode, 500);
    assert.equal(result.message, "bad token=[已脱敏] [已脱敏]");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("push-provider-auth caches WeCom tokens", async () => {
  const originalFetch = globalThis.fetch;
  let tokenFetches = 0;
  clearWecomTokenCache();
  globalThis.fetch = async () => {
    tokenFetches += 1;
    return new Response(
      JSON.stringify({ errcode: 0, access_token: "token-value", expires_in: 7200 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const first = await getWecomToken("corp", "secret", 30);
    const second = await getWecomToken("corp", "secret", 30);

    assert.equal(first, "token-value");
    assert.equal(second, "token-value");
    assert.equal(tokenFetches, 1);
  } finally {
    clearWecomTokenCache();
    globalThis.fetch = originalFetch;
  }
});
