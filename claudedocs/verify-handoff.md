# 真机验证交接（Claude → Codex）

> 来源：Claude 完成 P1 全部 + Phase 3 全部后的验证交接。
> 范围：commit `c558e86`→`5a84afd`（Claude 的 5 个）+ `61efed3`（Codex 的 P0）。
> 这些改动 **tsc + 687 单测全绿，但大多是 impure、没在真机跑过**——需真机验证。

## 环境前提（先确认）
- 测试环境的 `@rollup/rollup-darwin-arm64` 之前是 `--no-save` 补的，`npm ci` 会掉。跑测试前先确认 `npm test` 能起；起不来就 `rm -rf node_modules package-lock.json && npm install`。
- `npm run test:live` 需要登录 grok + 订阅 + 一个 xAI API key（用于测 apiKey 降级档）。

## 必跑
`npm run test:live`（真机 ACP 握手 + 生成式，验证 wire 格式）。

## 逐项真机验证（每项要有证据，别只跑 tsc）

| # | 项 | 落点 | 验证方法 / 预期 |
|---|---|---|---|
| P0-1 | Cursor 守卫 | `src/direct/index.ts` | 真实 **Cursor** 装 vsix → 侧边栏 + SCM 提交按钮 + 状态栏都可用、`activate` 不崩、Chat provider / `@grok` participant 静默缺席 |
| P0-3 | 403 降级 | `src/direct/auth.ts` / `authed-stream.ts` | 真机触发 403（如用无直连 API 权限的档）→ 自动降级 grokCli→oauth→apiKey，而非直接抛错 |
| P2-10 | 缓存 header | `src/direct/xaiClient.ts` | 多轮对话看 API `usage.cached_tokens` 是否非 0，且带 `x-grok-conv-id` header 不导致 400 |
| P2-12 | autoSearch | `src/direct/participant.ts` | 开 `grokCoder.autoSearch` 后普通 `@grok` 对话确认联网搜索触发 + 引用来源渲染 |
| P2-13 | /fix 一键应用 | `participant.ts` / `index.ts` | 选中代码 `/fix` → 点「应用到编辑器」→ `WorkspaceEdit` 正确替换目标 range |
| P2-11 | 状态栏 model | `src/direct/statusbar.ts` | 会话内切 model → 状态栏实时更新 |

## 已知 gap / 待办（验证时留意，可顺手补）
- **token 用量没做**：`sidebar.ts` 里搜不到 `totalTokens` 数据流（CLAUDE.md 说的 `_meta.totalTokens` 可能在 acp 层、字段名不同）。若能定位，可给状态栏补 token 显示。
- **会话切换 model 滞后**：model 只在 `modelChanged` 事件 fire，切换会话时状态栏可能滞后到下次 model 变化。可在 focus 切换点补 `statusEmitter.fire()`。
- **/fix range 错位**：目标 range 在 handler 开始捕获，若流式期间用户编辑了文档可能错位。

## 判定
一个 SKIP（没订阅 / grok 没选择降级等）不算失败，只有 FAIL 才是。验证完把结果回报给维护者。
