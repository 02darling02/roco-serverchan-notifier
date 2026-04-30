import type {
  Config,
  DeliveryReport,
  NotificationMessage,
  ProviderConfig,
  PushResult,
} from "./types";
import { providerRequiredFields, providerSecretFields } from "./provider-specs";
import { fetchWithTimeout } from "./rocom";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function missingRequired(provider: ProviderConfig): string[] {
  return [...providerRequiredFields(provider.type)].filter(
    (name) => !(provider.config[name] || "").trim()
  );
}

const SENSITIVE_NAMES =
  "access_token|app_token|corpsecret|key|read_key|readkey|secret|sendkey|token|webhook";
const SENSITIVE_QUERY_RE = new RegExp(
  `(\\b(?:${SENSITIVE_NAMES})=)([^&\\s]+)`,
  "gi"
);
const SENSITIVE_FIELD_RE = new RegExp(
  `(['"]?\\b(?:${SENSITIVE_NAMES})\\b['"]?\\s*[:=]\\s*['"]?)([^'",\\s}&]+)(['"]?)`,
  "gi"
);

function redactSensitiveText(provider: ProviderConfig, text: string): string {
  let r = text;
  for (const fieldName of providerSecretFields(provider.type)) {
    const v = (provider.config[fieldName] || "").trim();
    if (v) {
      r = r.replaceAll(v, "[已脱敏]");
      r = r.replaceAll(encodeURIComponent(v), "[已脱敏]");
    }
  }
  r = r.replace(SENSITIVE_QUERY_RE, "$1[已脱敏]");
  r = r.replace(SENSITIVE_FIELD_RE, "$1[已脱敏]$3");
  return r;
}

function jsonResult(
  payload: Record<string, unknown>,
  successCodes: Set<unknown>
): { success: boolean; message: string } {
  const code = payload.code ?? payload.errcode;
  let success = successCodes.has(code);
  if (code === undefined && Object.keys(payload).length === 0) {
    success = true;
  }
  const message = String(
    payload.message || payload.msg || payload.errmsg || JSON.stringify(payload)
  );
  return { success, message };
}

async function readResponsePayload(resp: Response): Promise<{
  payload: Record<string, unknown>;
  text: string;
}> {
  const text = await resp.text();
  if (!text.trim()) return { payload: {}, text: "" };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { payload: parsed as Record<string, unknown>, text };
    }
  } catch {
    // non-json response body
  }
  return { payload: {}, text };
}

function resultFromParsedResponse(
  provider: ProviderConfig,
  resp: Response,
  payload: Record<string, unknown>,
  text: string,
  successCodes: Set<unknown>
): PushResult {
  let { success, message } = jsonResult(payload, successCodes);
  const textMessage = text.slice(0, 200);
  if (Object.keys(payload).length === 0 && textMessage) {
    message = textMessage;
  }
  if (resp.status >= 400) {
    success = false;
    message = textMessage || message;
  }
  return {
    providerId: provider.id,
    providerName: provider.name,
    providerType: provider.type,
    success,
    message: redactSensitiveText(provider, message),
    statusCode: resp.status,
  };
}

async function postJson(
  provider: ProviderConfig,
  url: string,
  payload: Record<string, unknown>,
  timeoutSec: number,
  options?: { headers?: Record<string, string>; successCodes?: Set<unknown> }
): Promise<PushResult> {
  const successCodes = options?.successCodes ?? new Set([0, "0"]);
  try {
    const resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
        body: JSON.stringify(payload),
      },
      timeoutSec
    );

    const { payload: respPayload, text } = await readResponsePayload(resp);
    return resultFromParsedResponse(
      provider,
      resp,
      respPayload,
      text,
      successCodes
    );
  } catch (err) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      message: redactSensitiveText(provider, String(err)),
      statusCode: null,
    };
  }
}

// ---------------------------------------------------------------------------
// WeCom Token Cache
// ---------------------------------------------------------------------------

const wecomTokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>();

async function getWecomToken(
  corpid: string,
  secret: string,
  timeoutSec: number
): Promise<string> {
  const key = `${corpid}:${secret}`;
  const cached = wecomTokenCache.get(key);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpid)}&corpsecret=${encodeURIComponent(secret)}`;
  const resp = await fetchWithTimeout(url, { method: "GET" }, timeoutSec);
  const payload = (await resp.json()) as {
    errcode: number | string;
    access_token?: string;
    expires_in?: number;
    errmsg?: string;
  };

  if (resp.status >= 400 || (payload.errcode !== 0 && payload.errcode !== "0")) {
    throw new Error(payload.errmsg || JSON.stringify(payload));
  }

  const token = payload.access_token!;
  const expiresIn = payload.expires_in || 7200;
  wecomTokenCache.set(key, { token, expiresAt: now + expiresIn });
  return token;
}

// ---------------------------------------------------------------------------
// HMAC Signing (DingTalk + Feishu)
// ---------------------------------------------------------------------------

async function hmacSha256Base64(
  keyData: BufferSource,
  messageData: BufferSource
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, messageData);
  // base64 encode
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function appendDingTalkSign(
  webhook: string,
  secret: string
): Promise<string> {
  if (!secret) return webhook;
  const timestamp = Date.now().toString();
  const stringToSign = `${timestamp}\n${secret}`;
  const encoder = new TextEncoder();
  const sign = await hmacSha256Base64(
    encoder.encode(secret),
    encoder.encode(stringToSign)
  );
  const sep = webhook.includes("?") ? "&" : "?";
  return `${webhook}${sep}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
}

async function feishuSign(secret: string, timestamp: string): Promise<string> {
  const stringToSign = `${timestamp}\n${secret}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(stringToSign),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new Uint8Array(0));
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Provider Senders
// ---------------------------------------------------------------------------

type Sender = (
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
) => Promise<PushResult>;

async function sendServerChan(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  const sendkey = provider.config.sendkey;
  const url = `https://sctapi.ftqq.com/${sendkey}.send`;
  const body = new URLSearchParams({
    title: message.title,
    desp: message.markdown,
  });

  try {
    const resp = await fetchWithTimeout(
      url,
      { method: "POST", body },
      timeoutSec
    );
    const successCodes = new Set([0, "0", null, undefined]);
    const { payload, text } = await readResponsePayload(resp);
    return resultFromParsedResponse(provider, resp, payload, text, successCodes);
  } catch (err) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      message: redactSensitiveText(provider, String(err)),
      statusCode: null,
    };
  }
}

async function sendPushPlus(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  const payload: Record<string, unknown> = {
    token: provider.config.token,
    title: message.title,
    content: message.markdown,
    template: "markdown",
  };
  for (const key of ["topic", "channel"]) {
    const v = (provider.config[key] || "").trim();
    if (v) payload[key] = v;
  }
  return postJson(provider, "https://www.pushplus.plus/send", payload, timeoutSec, {
    successCodes: new Set([200, "200", 0, "0"]),
  });
}

async function sendWecomChan(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  try {
    const token = await getWecomToken(
      provider.config.corpid,
      provider.config.secret,
      timeoutSec
    );
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
    const payload = {
      touser: provider.config.touser || "@all",
      msgtype: "text",
      agentid: parseInt(provider.config.agentid, 10),
      text: {
        content: `${message.title}\n\n${message.body}\n\n${message.markdown}`,
      },
      safe: 0,
    };
    return postJson(provider, url, payload, timeoutSec);
  } catch (err) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      message: redactSensitiveText(provider, String(err)),
      statusCode: null,
    };
  }
}

async function sendWecomBot(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  let webhook = (provider.config.webhook || "").trim();
  if (!webhook) {
    const key = (provider.config.key || "").trim();
    if (!key) {
      return {
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.type,
        success: false,
        message: "缺少 webhook 或 key",
        statusCode: null,
      };
    }
    webhook = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`;
  }
  const payload = {
    msgtype: "markdown",
    markdown: { content: message.markdown },
  };
  return postJson(provider, webhook, payload, timeoutSec);
}

async function sendWxPusher(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  const payload: Record<string, unknown> = {
    appToken: provider.config.app_token,
    content: message.markdown,
    summary: message.title,
    contentType: 3,
  };
  const uids = splitCsv(provider.config.uids);
  const topicIds = splitCsv(provider.config.topic_ids);
  if (uids.length > 0) payload.uids = uids;
  if (topicIds.length > 0) {
    payload.topicIds = topicIds.map((id) => (/^\d+$/.test(id) ? parseInt(id, 10) : id));
  }
  return postJson(
    provider,
    "https://wxpusher.zjiecode.com/api/send/message",
    payload,
    timeoutSec,
    { successCodes: new Set([1000, "1000", 0, "0"]) }
  );
}

async function sendBark(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  const serverUrl = (provider.config.server_url || "https://api.day.app").replace(
    /\/$/,
    ""
  );
  const url = `${serverUrl}/${provider.config.device_key}`;
  const payload: Record<string, unknown> = {
    title: message.title,
    body: `${message.body}\n\n${message.markdown}`,
  };
  const group = (provider.config.group || "").trim();
  if (group) payload.group = group;
  return postJson(provider, url, payload, timeoutSec, {
    successCodes: new Set([200, "200", 0, "0"]),
  });
}

async function sendDingTalkBot(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  const webhook = await appendDingTalkSign(
    provider.config.webhook,
    provider.config.secret || ""
  );
  const payload = {
    msgtype: "markdown",
    markdown: { title: message.title, text: message.markdown },
  };
  return postJson(provider, webhook, payload, timeoutSec);
}

async function sendFeishuBot(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  const payload: Record<string, unknown> = {
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title: message.title,
          content: [
            [{ tag: "text", text: `${message.body}\n\n${message.markdown}` }],
          ],
        },
      },
    },
  };
  const secret = (provider.config.secret || "").trim();
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    payload.timestamp = timestamp;
    payload.sign = await feishuSign(secret, timestamp);
  }
  return postJson(provider, provider.config.webhook, payload, timeoutSec);
}

async function sendNtfy(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  const baseUrl = (provider.config.base_url || "https://ntfy.sh").replace(
    /\/$/,
    ""
  );
  const url = `${baseUrl}/${provider.config.topic}`;
  const headers: Record<string, string> = {
    Title: message.title,
    Markdown: "yes",
  };
  for (const [cfgKey, headerName] of [
    ["priority", "Priority"],
    ["tags", "Tags"],
  ] as const) {
    const v = (provider.config[cfgKey] || "").trim();
    if (v) headers[headerName] = v;
  }
  const token = (provider.config.token || "").trim();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers,
        body: message.markdown,
      },
      timeoutSec
    );
    const success = resp.status >= 200 && resp.status < 300;
    const text = (await resp.text()).slice(0, 200) || resp.statusText;
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success,
      message: text,
      statusCode: resp.status,
    };
  } catch (err) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      message: String(err),
      statusCode: null,
    };
  }
}

async function sendGotify(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  const baseUrl = (provider.config.base_url || "").replace(/\/$/, "");
  const appToken = encodeURIComponent(provider.config.app_token);
  const url = `${baseUrl}/message?token=${appToken}`;
  const priority = parseInt(provider.config.priority || "5", 10) || 5;
  const payload = {
    title: message.title,
    message: message.markdown,
    priority,
  };

  try {
    const resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      timeoutSec
    );
    const success = resp.status >= 200 && resp.status < 300;
    const text = (await resp.text()).slice(0, 200) || resp.statusText;
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success,
      message: text,
      statusCode: resp.status,
    };
  } catch (err) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      message: String(err),
      statusCode: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Sender Dispatch
// ---------------------------------------------------------------------------

const PROVIDER_SENDERS: Record<string, Sender> = {
  serverchan: sendServerChan,
  pushplus: sendPushPlus,
  wecomchan: sendWecomChan,
  wecom_bot: sendWecomBot,
  wxpusher: sendWxPusher,
  bark: sendBark,
  dingtalk_bot: sendDingTalkBot,
  feishu_bot: sendFeishuBot,
  ntfy: sendNtfy,
  gotify: sendGotify,
};

// ---------------------------------------------------------------------------
// Send Provider (with validation + redaction)
// ---------------------------------------------------------------------------

async function sendProvider(
  provider: ProviderConfig,
  message: NotificationMessage,
  timeoutSec: number
): Promise<PushResult> {
  const missing = missingRequired(provider);
  if (missing.length > 0) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      message: `缺少配置: ${missing.join(", ")}`,
      statusCode: null,
    };
  }

  const sender = PROVIDER_SENDERS[provider.type];
  if (!sender) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      message: `未知通道类型: ${provider.type}`,
      statusCode: null,
    };
  }

  try {
    const result = await sender(provider, message, timeoutSec);
    return {
      ...result,
      message: redactSensitiveText(provider, result.message),
    };
  } catch (err) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      message: redactSensitiveText(provider, String(err)),
      statusCode: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Delivery Engine
// ---------------------------------------------------------------------------

export async function sendDelivery(
  providers: ProviderConfig[],
  message: NotificationMessage,
  mode: string,
  selectedProvider: string,
  failoverOrder: string[],
  timeoutSec: number
): Promise<DeliveryReport> {
  const enabled = providers.filter((p) => p.enabled);
  const validMode = ["all", "single", "failover"].includes(mode) ? mode : "all";

  let targets: ProviderConfig[];
  if (validMode === "single") {
    targets = enabled.filter((p) => p.id === selectedProvider);
  } else if (validMode === "failover") {
    const order =
      failoverOrder.length > 0
        ? failoverOrder
        : enabled.map((p) => p.id);
    const providerMap = new Map(enabled.map((p) => [p.id, p]));
    targets = order
      .map((id) => providerMap.get(id))
      .filter((p): p is ProviderConfig => p !== undefined);
  } else {
    targets = enabled;
  }

  let results: PushResult[];
  if (validMode === "all") {
    results = await Promise.all(
      targets.map((provider) => sendProvider(provider, message, timeoutSec))
    );
  } else {
    results = [];
    for (const provider of targets) {
      const result = await sendProvider(provider, message, timeoutSec);
      results.push(result);
      if (validMode === "failover" && result.success) break;
    }
  }

  return {
    success: results.some((r) => r.success),
    mode: validMode,
    results,
  };
}

// ---------------------------------------------------------------------------
// Summary Helper
// ---------------------------------------------------------------------------

export function deliverySummary(report: DeliveryReport): string {
  if (report.results.length === 0) return "没有可用推送通道";
  const okCount = report.results.filter((r) => r.success).length;
  return `${okCount}/${report.results.length} 个通道成功`;
}
