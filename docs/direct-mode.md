# Grok Coder

把 **Grok 4.5** 带进 VS Code 的编码助手插件，两种用法合一：

1. **原生模型接入（BYOK Provider）** — `grok-4.5` 直接出现在 VS Code Chat 的模型选择器中，可用于 Ask / Edit / Agent 模式，不占 Copilot 配额，按 xAI API 计费。
2. **`@grok` 聊天参与者** — 面向编码场景的垂直命令，独有 xAI 实时 Web/X 搜索能力。

## 功能

| 命令 | 说明 |
|---|---|
| `@grok /fix` | 修复选中代码或当前文件中的问题 |
| `@grok /explain` | 解释代码逻辑与坑点 |
| `@grok /review` | 按严重程度审查代码（bug/安全/性能/可读性） |
| `@grok /docs` | 生成惯用风格的文档注释 |
| `@grok /search` | 实时搜索 Web/X：最新库版本、breaking changes、社区讨论（附来源） |
| `@grok /commit` | 读取 git diff，生成 Conventional Commits 提交信息 |

## 快速开始

**方式一：Grok 账号授权登录（推荐，用订阅额度，无需 API Key）**

1. 需要 SuperGrok 或 X Premium+ 订阅。
2. 运行命令 **Grok Coder: 登录 Grok 账号** → 浏览器打开 xAI 授权页 → 确认授权。
3. 凭据保存在本机 SecretStorage，token 到期自动刷新。

**方式二：xAI API Key（按量计费，回退方案）**

在 [console.x.ai](https://console.x.ai) 创建 Key，运行 **Grok Coder: 设置 xAI API Key**。

然后打开 Chat 面板：在模型选择器中选择 **Grok 4.5**，或输入 `@grok` 使用垂直命令。

## 设置

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `grokCoder.baseUrl` | `https://api.x.ai/v1` | API 端点 |
| `grokCoder.model` | `grok-4.5` | `@grok` 使用的模型 |
| `grokCoder.reasoningEffort` | `low` | 推理强度（low/medium/high），日常编码问答建议 low |
| `grokCoder.enableLiveSearch` | `true` | 允许 /search 使用 xAI 服务端搜索（按 xAI 工具计费） |
| `grokCoder.additionalModels` | `[]` | 注册额外模型到模型选择器 |

## 开发

```bash
npm install
npm run build      # 类型检查 + esbuild 打包
npm run watch      # 开发监听
npm run package    # 生成 .vsix
```

按 F5（"运行插件"配置）启动 Extension Development Host 调试。

## 说明与限制

- 需要 VS Code ≥ 1.104。BYOK Provider 与聊天参与者依赖 VS Code 原生 Chat（Copilot Chat）。Cursor 兼容计划在 v2 提供。
- 账号授权走 xAI 官方 OAuth 2.0 PKCE 流程（`auth.x.ai`，Grok Build CLI 同款），登录时会在本机 `127.0.0.1:56121` 起临时回调服务；SSH 远程开发场景需转发该端口。
- ⚠️ xAI 后端对部分订阅档位限制 OAuth API 访问：若登录成功但请求返回 403，请改用 API Key 或升级订阅。
- API 调用统一走 xAI Responses API（`/v1/responses`），OAuth 与 API Key 均支持；客户端隔离在 `src/xaiClient.ts`。
- API Key 路径按量计费：Grok 4.5 输入 $2/M、输出 $6/M、缓存输入 $0.5/M（以 xAI 官方定价为准）。
- xAI API 当前在 EU 区不可用（xAI 预计 2026 年 7 月中旬开放）。

## License

MIT
