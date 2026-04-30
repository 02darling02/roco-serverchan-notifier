import type { ProviderSpec } from "./types";

export const PROVIDER_TYPES: Record<string, ProviderSpec> = {
  serverchan: {
    label: "Server 酱",
    description: "通过 Server 酱 SendKey 推送到微信。",
    fields: [
      { name: "sendkey", label: "SendKey", secret: true, required: true },
    ],
  },
  pushplus: {
    label: "PushPlus",
    description: "通过 PushPlus token 推送，默认使用 markdown 模板。",
    fields: [
      { name: "token", label: "Token", secret: true, required: true },
      { name: "topic", label: "群组编码", required: false },
      { name: "channel", label: "渠道", required: false },
    ],
  },
  wecomchan: {
    label: "Wecom 酱 / 企业微信应用",
    description: "使用企业微信应用参数获取 access_token 后发送消息。",
    fields: [
      { name: "corpid", label: "CorpID", secret: true, required: true },
      { name: "secret", label: "Secret", secret: true, required: true },
      { name: "agentid", label: "AgentID", required: true },
      { name: "touser", label: "接收人", required: true, default: "@all" },
    ],
  },
  wecom_bot: {
    label: "企业微信群机器人",
    description: "使用企业微信群机器人 webhook 或 key 推送 markdown。",
    fields: [
      { name: "webhook", label: "Webhook", secret: true, required: false },
      { name: "key", label: "Key", secret: true, required: false },
    ],
  },
  wxpusher: {
    label: "WxPusher",
    description: "通过 WxPusher appToken 推送给 UID 或主题。",
    fields: [
      { name: "app_token", label: "AppToken", secret: true, required: true },
      { name: "uids", label: "UID 列表", required: false },
      { name: "topic_ids", label: "Topic ID 列表", required: false },
    ],
  },
  bark: {
    label: "Bark",
    description: "通过 Bark server 和 device key 推送到 iOS。",
    fields: [
      {
        name: "server_url",
        label: "Server URL",
        required: true,
        default: "https://api.day.app",
      },
      { name: "device_key", label: "Device Key", secret: true, required: true },
      { name: "group", label: "分组", required: false, default: "洛克王国" },
    ],
  },
  dingtalk_bot: {
    label: "钉钉群机器人",
    description: "使用钉钉 webhook 推送 markdown，可选 secret 加签。",
    fields: [
      { name: "webhook", label: "Webhook", secret: true, required: true },
      { name: "secret", label: "Secret", secret: true, required: false },
    ],
  },
  feishu_bot: {
    label: "飞书群机器人",
    description: "使用飞书 webhook 推送富文本，可选 secret 加签。",
    fields: [
      { name: "webhook", label: "Webhook", secret: true, required: true },
      { name: "secret", label: "Secret", secret: true, required: false },
    ],
  },
  ntfy: {
    label: "ntfy",
    description: "发布到 ntfy topic，可选 bearer token。",
    fields: [
      {
        name: "base_url",
        label: "Base URL",
        required: true,
        default: "https://ntfy.sh",
      },
      { name: "topic", label: "Topic", secret: true, required: true },
      { name: "token", label: "Token", secret: true, required: false },
      { name: "priority", label: "优先级", required: false, default: "default" },
      { name: "tags", label: "标签", required: false },
    ],
  },
  gotify: {
    label: "Gotify",
    description: "通过 Gotify app token 推送消息。",
    fields: [
      { name: "base_url", label: "Base URL", required: true },
      { name: "app_token", label: "App Token", secret: true, required: true },
      { name: "priority", label: "优先级", required: false, default: "5" },
    ],
  },
};

export function providerSecretFields(providerType: string): Set<string> {
  const spec = PROVIDER_TYPES[providerType];
  if (!spec) return new Set();
  return new Set(
    spec.fields.filter((f) => f.secret).map((f) => f.name)
  );
}

export function providerRequiredFields(providerType: string): Set<string> {
  const spec = PROVIDER_TYPES[providerType];
  if (!spec) return new Set();
  return new Set(
    spec.fields.filter((f) => f.required).map((f) => f.name)
  );
}
