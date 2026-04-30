# roco-push-worker

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F6821F?logo=cloudflare&logoColor=white)](https://dash.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](../LICENSE)

《洛克王国世界》远行商人推送服务的 Cloudflare Workers 版本。使用 Cron Triggers 定时执行，无需服务器，免费计划即可运行。

## 目录

- [与 Docker 版的对比](#与-docker-版的对比)
- [工作原理](#工作原理)
- [快速开始](#快速开始)
- [部署指南](#部署指南)
- [HTTP 端点](#http-端点)
- [Cron 调度](#cron-调度)
- [推送通道](#推送通道)
- [发送策略](#发送策略)
- [环境变量参考](#环境变量参考)
- [项目结构](#项目结构)
- [本地开发](#本地开发)
- [从其他部署方式迁移](#从其他部署方式迁移)
- [外部监控集成](#外部监控集成)
- [费用说明](#费用说明)
- [常见问题](#常见问题)
- [许可](#许可)

## 与 Docker 版的对比

| 特性 | Docker 版 | CF Workers 版 |
|------|----------|--------------|
| Web 控制台 | 有（页面管理配置） | 无（通过环境变量配置） |
| 定时触发 | 内置调度器 | CF Cron Triggers |
| 推送通道 | 10 种 | 10 种（完全一致） |
| 费用 | 服务器费用 | 免费（CF 免费计划） |
| 精确度 | 精确到秒 | 可能延迟 1-2 分钟 |
| 部署复杂度 | Docker + 服务器 | `wrangler deploy` 一条命令 |
| 持久化 | `config.json` 文件 | 环境变量（无文件系统） |
| 最佳场景 | 长期运行、需要 Web 管理 | 免费托管、轻量运行 |

两个版本共享相同的推送逻辑和通道配置，可以根据需要选择或切换。

## 工作原理

```
┌─────────────────────────────────────────────────┐
│              Cloudflare Workers                  │
│                                                  │
│  Cron Trigger ──┐     HTTP Request ──┐          │
│  (每天4次定时)    │     (/trigger)     │          │
│                  ▼                    ▼          │
│            ┌──────────┐                         │
│            │ runPipeline│                        │
│            └─────┬─────┘                         │
│                  │                               │
│      ┌───────────┼───────────┐                   │
│      ▼           ▼           ▼                   │
│  fetchMerchant  process    sendDelivery          │
│  (获取数据)     (过滤活跃)   (推送到通道)           │
│      │           │           │                   │
│      ▼           ▼           ▼                   │
│  ROCOM API    按时间戳      10种推送通道            │
│  (数据源)     过滤+轮次      同时/单选/主备         │
└─────────────────────────────────────────────────┘
```

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) 18+
- [Cloudflare 账号](https://dash.cloudflare.com/)（免费即可）
- 已获取 `ROCOM_API_KEY`（参考 [数据源项目](https://github.com/Entropy-Increase-Team/)）

### 安装

```bash
cd cf-workers
npm install
```

### 配置 Secrets

```bash
# 1. 数据源 Key（必需）
npx wrangler secret put ROCOM_API_KEY

# 2. 至少配置一个推送通道（以下任选其一）
npx wrangler secret put SERVERCHAN_SENDKEY    # Server 酱
npx wrangler secret put PUSHPLUS_TOKEN        # PushPlus
npx wrangler secret put BARK_DEVICE_KEY       # Bark
npx wrangler secret put DINGTALK_WEBHOOK      # 钉钉
npx wrangler secret put FEISHU_WEBHOOK        # 飞书
npx wrangler secret put NTFY_TOPIC            # ntfy
npx wrangler secret put GOTIFY_APP_TOKEN      # Gotify
```

### 部署

```bash
npm run deploy
```

部署完成后，Worker 会按 cron 调度自动运行。也可以通过 HTTP 端点手动触发。

## 部署指南

### 完整部署流程

```bash
# 1. 登录 Cloudflare（首次使用）
npx wrangler login

# 2. 配置所有需要的 secrets
npx wrangler secret put ROCOM_API_KEY
npx wrangler secret put SERVERCHAN_SENDKEY
# ... 其他通道

# 3. 编辑 wrangler.toml 中的非敏感变量（可选）
# 如需修改定时时间、超时等

# 4. 部署
npm run deploy

# 5. 验证
curl https://roco-push-worker.<你的子域>.workers.dev/health
curl https://roco-push-worker.<你的子域>.workers.dev/trigger

# 6. 查看实时日志
npm run tail
```

### 自定义域名（可选）

在 Cloudflare Dashboard 中为 Worker 添加自定义域名路由，或在 `wrangler.toml` 中配置：

```toml
routes = [
  { pattern = "push.example.com/*", zone_name = "example.com" }
]
```

### 查看和管理 Secrets

```bash
# 列出已配置的 secrets（只显示名称，不显示值）
npx wrangler secret list

# 删除某个 secret
npx wrangler secret delete SECRET_NAME
```

## HTTP 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查，返回 `{ ok: true, timestamp: "..." }` |
| `/trigger` | GET/POST | 手动触发一次完整推送流程，返回执行结果 |

`/trigger` 默认保持开放，便于迁移和外部手动触发。配置 `TRIGGER_TOKEN` secret 后，触发请求必须提供匹配 token；Cron Trigger 和 `/health` 不受影响。

**示例：**

```bash
# 健康检查
curl https://roco-push-worker.<子域>.workers.dev/health

# 手动触发
curl https://roco-push-worker.<子域>.workers.dev/trigger

# 配置 TRIGGER_TOKEN 后任选一种
curl "https://roco-push-worker.<子域>.workers.dev/trigger?token=你的token"
curl -H "X-Trigger-Token: 你的token" https://roco-push-worker.<子域>.workers.dev/trigger
curl -H "Authorization: Bearer 你的token" https://roco-push-worker.<子域>.workers.dev/trigger

# 配合外部监控（如 UptimeRobot）
# 监控 /health 端点，5xx 告警
```

**触发返回示例：**

```json
// 有活跃商品时
{ "exitCode": 0, "summary": "2/3 个通道成功" }

// 无活跃商品时（NOTIFY_EMPTY=false）
{ "exitCode": 0, "summary": "当前暂无活跃商品，已按 NOTIFY_EMPTY=false 跳过推送" }

// 缺少配置时
{ "exitCode": 2, "summary": "缺少必要环境变量: ROCOM_API_KEY" }
```

## Cron 调度

默认每天北京时间 08:05、12:05、16:05、20:05 触发，即远行商人刷新后 5 分钟。

| 北京时间 | UTC 时间 | Cron 表达式 |
|:--------:|:--------:|:-----------:|
| 08:05 | 00:05 | `5 0 * * *` |
| 12:05 | 04:05 | `5 4 * * *` |
| 16:05 | 08:05 | `5 8 * * *` |
| 20:05 | 12:05 | `5 12 * * *` |

在 `wrangler.toml` 中修改：

```toml
[triggers]
crons = ["5 0,4,8,12 * * *"]
```

**自定义时间示例：**

```toml
# 每小时检查一次
crons = ["5 * * * *"]

# 只在早晚各一次
crons = ["5 0,12 * * *"]

# 每 2 小时
crons = ["5 */2 * * *"]
```

> **注意：** Cloudflare 的 Cron Triggers 不保证精确到秒，实际执行可能延迟 1-2 分钟。免费计划有 Cron Triggers 数量限制，修改 cron 后需要重新部署 `npm run deploy`。

## 推送通道

10 种推送通道，与 Docker 版完全一致：

| 通道 | 最少需要 | 说明 |
|------|---------|------|
| Server 酱 | `SERVERCHAN_SENDKEY` | 推送到微信 |
| PushPlus | `PUSHPLUS_TOKEN` | 支持群组、渠道 |
| 企业微信应用 | `WECOM_CORPID` + `WECOM_SECRET` + `WECOM_AGENTID` | 自动获取 access_token |
| 企业微信群机器人 | `WECOM_BOT_WEBHOOK` 或 `WECOM_BOT_KEY` | Markdown 消息 |
| WxPusher | `WXPUSHER_APP_TOKEN` | 支持 UID / Topic |
| Bark | `BARK_DEVICE_KEY` | 推送到 iOS |
| 钉钉群机器人 | `DINGTALK_WEBHOOK` | 可选加签 |
| 飞书群机器人 | `FEISHU_WEBHOOK` | 可选加签 |
| ntfy | `NTFY_TOPIC` | 可选 bearer token |
| Gotify | `GOTIFY_BASE_URL` + `GOTIFY_APP_TOKEN` | 可配优先级 |

**添加新通道只需两步：**

1. `npx wrangler secret put` 添加敏感字段
2. `npm run deploy` 重新部署

通道会自动启用（只要必需字段齐全）。

## 发送策略

通过 `DELIVERY_MODE` 环境变量控制：

| 值 | 行为 |
|---|---|
| `all`（默认） | 向所有启用通道发送，至少一个成功即认为送达 |
| `single` | 只向 `SELECTED_PROVIDER` 指定的通道发送，未配置或无效时回退第一个启用通道 |
| `failover` | 按 `FAILOVER_ORDER` 指定顺序尝试通道，第一个成功后停止；未配置时按默认通道顺序 |

在 `wrangler.toml` 中设置：

```toml
[vars]
DELIVERY_MODE = "failover"
SELECTED_PROVIDER = "serverchan-default"
FAILOVER_ORDER = "pushplus-env,serverchan-default"
```

`all` 模式会并发向所有启用通道发送；`failover` 为保证主备语义会顺序尝试。

**可用通道 ID：**

| 通道 | Provider ID |
|------|-------------|
| Server 酱 | `serverchan-default` |
| PushPlus | `pushplus-env` |
| 企业微信应用 | `wecomchan-env` |
| 企业微信群机器人 | `wecom-bot-env` |
| WxPusher | `wxpusher-env` |
| Bark | `bark-env` |
| 钉钉群机器人 | `dingtalk-env` |
| 飞书群机器人 | `feishu-env` |
| ntfy | `ntfy-env` |
| Gotify | `gotify-env` |

## 环境变量参考

### Secrets（`wrangler secret put`）

| 变量 | 通道 | 说明 |
|------|------|------|
| `ROCOM_API_KEY` | — | 数据源接口 Key（**必需**） |
| `SERVERCHAN_SENDKEY` | Server 酱 | SendKey |
| `PUSHPLUS_TOKEN` | PushPlus | Token |
| `WECOM_CORPID` | 企业微信 | CorpID |
| `WECOM_SECRET` | 企业微信 | Secret |
| `WECOM_AGENTID` | 企业微信 | AgentID |
| `WECOM_BOT_WEBHOOK` | 企微群机器人 | Webhook URL |
| `WECOM_BOT_KEY` | 企微群机器人 | Key |
| `WXPUSHER_APP_TOKEN` | WxPusher | AppToken |
| `BARK_DEVICE_KEY` | Bark | Device Key |
| `DINGTALK_WEBHOOK` | 钉钉 | Webhook URL |
| `DINGTALK_SECRET` | 钉钉 | 加签密钥（可选） |
| `FEISHU_WEBHOOK` | 飞书 | Webhook URL |
| `FEISHU_SECRET` | 飞书 | 加签密钥（可选） |
| `NTFY_TOPIC` | ntfy | Topic |
| `NTFY_TOKEN` | ntfy | Bearer Token（可选） |
| `GOTIFY_APP_TOKEN` | Gotify | App Token |
| `TRIGGER_TOKEN` | — | `/trigger` 手动触发 token（可选） |

### Vars（`wrangler.toml [vars]`）

| 变量 | 默认值 | 说明 |
|------|-------|------|
| `ROCOM_API_URL` | 内置默认 | 数据接口地址 |
| `NOTIFY_EMPTY` | `false` | 无商品时是否推送 |
| `DELIVERY_MODE` | `all` | 发送策略：`all` / `single` / `failover` |
| `SELECTED_PROVIDER` | 第一个启用通道 | `single` 模式使用的 provider id |
| `FAILOVER_ORDER` | 启用通道默认顺序 | `failover` 模式顺序，逗号分隔 provider id |
| `HTTP_TIMEOUT` | `30` | 请求超时秒数 |
| `PUSHPLUS_TOPIC` | — | PushPlus 群组编码 |
| `PUSHPLUS_CHANNEL` | — | PushPlus 渠道 |
| `WECOM_TOUSER` | `@all` | 企业微信接收人 |
| `WXPUSHER_UIDS` | — | WxPusher UID 列表（逗号分隔） |
| `WXPUSHER_TOPIC_IDS` | — | WxPusher Topic ID 列表 |
| `BARK_SERVER_URL` | `https://api.day.app` | Bark 服务器地址 |
| `BARK_GROUP` | `洛克王国` | Bark 消息分组 |
| `NTFY_BASE_URL` | `https://ntfy.sh` | ntfy 服务器地址 |
| `NTFY_PRIORITY` | `default` | ntfy 优先级 |
| `NTFY_TAGS` | — | ntfy 标签 |
| `GOTIFY_BASE_URL` | — | Gotify 服务器地址 |
| `GOTIFY_PRIORITY` | `5` | Gotify 优先级 |

## 项目结构

```
cf-workers/
├── wrangler.toml              # Cron 触发 + 非敏感变量配置
├── package.json               # 依赖：wrangler、@cloudflare/workers-types
├── tsconfig.json              # TypeScript 配置（strict, ES2022）
├── .gitignore                 # 忽略 node_modules、.wrangler、.dev.vars
├── .dev.vars.example          # 本地开发 secrets 模板
├── README.md                  # 本文档
└── src/
    ├── index.ts               # 入口：scheduled（cron）+ fetch（HTTP）handler
    ├── types.ts               # 所有 TypeScript 接口定义
    ├── config.ts              # 环境变量 → Config 对象构建
    ├── rocom.ts               # API 客户端 + 时间工具 + Markdown 构建
    ├── push.ts                # 10 个推送通道实现 + 投递引擎
    └── provider-specs.ts      # 通道字段规格定义（required/secret/default）
```

**源码映射（Python → TypeScript）：**

| Python 文件 | TypeScript 文件 | 内容 |
|---|---|---|
| `app.py` | `index.ts` | 流程编排 |
| `config.py` | `config.ts` | 环境变量映射 |
| `rocom.py` | `rocom.ts` | API 客户端 |
| `time_utils.py` | `rocom.ts` | 时间工具（合并） |
| `push.py` | `push.ts` | 10 个通道 + 投递引擎 |
| `provider_specs.py` | `provider-specs.ts` | 通道规格 |

## 本地开发

```bash
# 1. 复制 secrets 模板
cp .dev.vars.example .dev.vars

# 2. 编辑 .dev.vars 填入你的 secrets
# ROCOM_API_KEY=你的Key
# SERVERCHAN_SENDKEY=你的SendKey

# 3. 启动本地开发服务器
npm run dev
# → http://localhost:8787

# 4. 测试端点
curl http://localhost:8787/health
curl http://localhost:8787/trigger

# 5. 测试和类型检查
npm test
npx tsc --noEmit
npx wrangler deploy --dry-run --outdir dist
```

`.dev.vars` 文件已被 `.gitignore` 忽略，不会被提交。

## 从其他部署方式迁移

### 从 GitHub Actions 迁移

GitHub Actions 的定时任务可能延迟或被暂停，CF Workers 更稳定。

**Secrets 映射：**

| GitHub Actions Secret | CF Workers Secret |
|---|---|
| `ROCOM_API_KEY` | `ROCOM_API_KEY` |
| `SERVERCHAN_SENDKEY` | `SERVERCHAN_SENDKEY` |
| `PUSHPLUS_TOKEN` | `PUSHPLUS_TOKEN` |
| 其他同名 secret | 同名 `wrangler secret put` |

**步骤：**

```bash
# 1. 安装并配置
cd cf-workers && npm install
npx wrangler login

# 2. 逐个迁移 secrets（值从 GitHub 仓库 Settings 复制）
npx wrangler secret put ROCOM_API_KEY
npx wrangler secret put SERVERCHAN_SENDKEY
# ... 其他

# 3. 部署并验证
npm run deploy
curl <worker-url>/trigger

# 4. 确认正常后，删除 GitHub Actions 定时 workflow
# 删除 .github/workflows/scheduled-push.yml
# 保留 ci.yml 和 docker-publish.yml
```

### 从 Docker 版迁移

**环境变量映射：**

| Docker 环境变量 | CF Workers 变量类型 |
|---|---|
| `ROCOM_API_KEY` | Secret |
| `SERVERCHAN_SENDKEY` | Secret |
| `DELIVERY_MODE` | Var（wrangler.toml） |
| `NOTIFY_EMPTY` | Var（wrangler.toml） |
| `HTTP_TIMEOUT` | Var（wrangler.toml） |
| 其他通道 Key | Secret |
| 其他通道可选参数 | Var（wrangler.toml） |

**不需要迁移的变量：** `APP_MODE`、`WEB_PORT`、`CONSOLE_*`、`SCHEDULE_TIMES`、`RUN_ON_START`（CF Workers 版不涉及）。

## 外部监控集成

### UptimeRobot（免费）

1. 注册 [UptimeRobot](https://uptimerobot.com/)
2. 创建 Monitor → 类型 HTTP(S)
3. URL 填写 `https://roco-push-worker.<子域>.workers.dev/health`
4. 监控间隔 5 分钟
5. 设置告警通知

### 其他监控服务

任何支持 HTTP 健康检查的服务都可以使用 `/health` 端点：

- [Better Uptime](https://betteruptime.com/)
- [Freshping](https://www.freshworks.com/website-monitoring/)
- [Hetrix Tools](https://hetrixtools.com/)

## 费用说明

| 项目 | CF 免费计划 | CF 付费计划 |
|------|-----------|-------------------|
| Cron 触发器 | 5 个/账号 | 250 个/账号 |
| 子请求 | 50 次/请求 | 10,000 次/请求 |
| 每日请求 | 100,000 次 | 不限制 |

本 Worker 默认每天 4 次触发，请求量很低，通常适合免费计划。具体额度请以 [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) 为准。

## 常见问题

### 如何获取 ROCOM_API_KEY？

参考 [Entropy-Increase-Team](https://github.com/Entropy-Increase-Team/) 项目或相关社区的规则获取。本项目不提供、不分发 API Key。

### 如何添加新的推送通道？

1. 在 `wrangler.toml` 中添加对应变量
2. 使用 `npx wrangler secret put` 添加敏感字段
3. 通道会自动启用（只要必需字段齐全）

### 如何修改定时时间？

编辑 `wrangler.toml`：

```toml
[triggers]
crons = ["5 0,4,8,12 * * *"]  # UTC 时间
```

然后重新部署 `npm run deploy`。

### 如何查看执行日志？

```bash
npm run tail
```

或在 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers → 你的 Worker → Logs。

### 为什么没有收到推送？

1. 检查 secrets 是否配置正确：`npx wrangler secret list`
2. 手动触发测试：`curl <worker-url>/trigger`
3. 查看实时日志：`npm run tail`
4. 确认至少有一个通道的必需字段完整

### 如何更新到最新版本？

```bash
cd cf-workers
git pull
npm install
npm run deploy
```

### 支持多架构吗？

Cloudflare Workers 运行在 V8 引擎上，不涉及架构问题。全球 300+ 边缘节点自动分发。

### Worker 名称可以改吗？

可以。编辑 `wrangler.toml` 中的 `name` 字段：

```toml
name = "my-roco-push"
```

修改后重新部署即可。

## 许可

本项目使用 [MIT License](../LICENSE)。
