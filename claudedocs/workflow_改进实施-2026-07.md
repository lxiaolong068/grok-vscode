# Grok Coder 改进实施工作流(2026-07-09)

> 输入:[docs/改进调研-2026-07.md](../docs/改进调研-2026-07.md) + `/sc:estimate` 校准估算
> 策略:systematic · 深度:normal · 基线:v0.3.1(品牌清理已落地,649 测试绿 / tsc 干净)
> 单位:人日(PERT 期望,单人 + AI 辅助)。总量 **~12.5 人日**,85% 落在 **9–17 人日**。
> 性质:**实施计划**,非执行。执行用 `/sc:implement`。

---

## 0. 总览:阶段 → 里程碑 → 发布切点

| 阶段 | 主题 | 期望人日 | 发布切点 |
|---|---|---|---|
| **Phase 0** | 验证 spike(降不确定性) | ~0.2 | — |
| **Phase 1** | 发布阻塞集(Cursor + 合规 + 认证) | ~3.3 | → **0.3.2**(阻塞清零) |
| **Phase 2** | 代码质量与健壮性 | ~2.8 | → 0.3.x |
| **Phase 3** | 收益功能(快赢) | ~2.8 | → 0.3.x |
| **Phase 4** | 中文市场主题 | ~3.6 | → **0.4.0** |

**贯穿全程的硬门(每个任务完成都要过):**
1. `npx tsc -p . --noEmit` 干净
2. `npm test` 保持全绿(测试数只增不减,当前 649 是底线)
3. 改了 `src/sidebar.ts` / `media/*` / docs 后,`npm run package` 重建 vsix 再手测(打包顺序:改完所有 → package → reinstall)
4. 涉及 wire 格式 / 真机行为的项,过 `npm run test:live`

---

## 1. 依赖图与关键路径

```
Phase 0 (spike) ──┐
                  ▼
P0-3 认证降级链 ───┐
                  │
P0-1 Cursor 守卫 ──┤
P0-2 刷新去重 ─────┼──► [0.3.2 发布门] ──► Phase 2/3(可交错并行)
P0-4 reasoning ───┤
图标替换 ─────────┘         P1-5 测试(建议前移，给 P0 兜底)

P1-6 l10n ──────────────────────────► P2-14 webview 中文化 ──► [0.4.0 发布门]
   (基础设施先行，模式被 webview 复用)
```

**关键路径**:`Phase 0 → P0-3 → 0.3.2 门`;以及 `P1-6 → P2-14 → 0.4.0 门`。
**最大并行度**:Phase 1 内 P0-2 / P0-4 / 图标 互相独立;Phase 2/3 各项几乎全独立。

---

## Phase 0 — 验证 spike(前置,~0.2 人日)

**目的**:P0-3 是本轮**最大波动项**,它是「验证任务」不是「实现任务」。先花 1–2 小时确认假设,避免在错误前提上写完整降级链。

| 任务 | 做法 | 产出/决策门 |
|---|---|---|
| CLI token 权限勘查 | 取 `~/.grok/auth.json` 的 access token,直接 `curl`/脚本打一次 `POST /v1/responses` | **放行** → P0-3 做完整降级链;**403** → P0-3 收敛为「grokCli 失败即降级 oauth/apiKey + 友好提示」,并下修其估时 |

**退出标准**:P0-3 的方案分支已确定,写进 P0-3 任务卡。

---

## Phase 2 — 代码质量与健壮性(~2.8 人日)

> 顺序上排在 Phase 1 之后,但 **P1-5 建议前移**与 Phase 1 交错(测试先行能给 P0-2/P0-3 的认证改动兜底)。

| # | 任务 | 改动落点 | 依赖 | 验证门 |
|---|---|---|---|---|
| P1-5 | 补 direct 纯函数测试 + 拆 SSE 解析 | 从 `XaiClient.stream`([src/direct/xaiClient.ts](../src/direct/xaiClient.ts))抽出 SSE 行解析为纯函数;新增测试覆盖 `sanitizeInput`、`provider` 的 `convertMessages/convertTools`(system→instructions/图像/工具回放)、`oauth` 的 `validateEndpoint/toCredentials`、`commit` 的 `stripFences` | 无 | 测试数明显上升 |
| P1-7 | commit 多仓库选仓 | [src/direct/commit.ts](../src/direct/commit.ts):`repositories[0]` → 按活动编辑器归属选,多个则 QuickPick;引入官方 `git.d.ts` 替 `any` | 无 | 多 repo workspace 手测 |
| P1-9 | 三小项 | ① `auth.ts` 按 mtime 缓存 auth.json 读取几秒;② `xaiClient` 流加 stall 超时;③ `grokCoder.statusBarMenu` 在 [package.json](../package.json) `contributes.commands` 补声明 | 无 | 命令面板可搜到该命令 |
| P1-8 | 上游同步流程文档 | [CLAUDE.md](../CLAUDE.md) 记录:`git remote add upstream …` + `git diff v1.4.30..upstream/main -- src/ media/ \| git apply` patch 式同步;每次同步后重跑测试底线 | 无 | 文档评审 |

**退出标准**:direct 模块纯函数有测试网;多仓库不再误取仓库;上游同步有 runbook。

---

## Phase 3 — 收益功能(快赢,~2.8 人日)

| # | 任务 | 改动落点 | 复杂度 | 验证门 |
|---|---|---|---|---|
| P2-10 | prompt caching | provider 请求构造([src/direct/provider.ts](../src/direct/provider.ts))每个 VS Code 会话生成稳定 `prompt_cache_key` 传入;`xaiClient` 请求体透传 | 低 | 观测缓存命中/成本 |
| P2-11 | 状态栏「活值」 | `GrokSidebar` 暴露 EventEmitter(live model/effort/`_meta.totalTokens`),[src/direct/statusbar.ts](../src/direct/statusbar.ts) 订阅替换当前的配置默认值读取 | 中(跨 sidebar↔statusbar) | 会话中数值实时更新 |
| P2-12 | web/x 默认搜索 | 新增 `grokCoder.autoSearch` 配置,默认对话带 `web_search`/`x_search` tool;README 标注工具计费 | 低-中 | 搜索触发 + 引用来源渲染 |
| P2-13 | `/fix` 一键应用 | [src/direct/participant.ts](../src/direct/participant.ts) 用 `stream.button` + 命令,把返回代码块经 `WorkspaceEdit` diff 应用到编辑器 | 中 | 端到端应用修复 |

**退出标准**:每项独立可用;`test:live` 覆盖新 wire 行为(caching/搜索)。

---

## Phase 4 — 中文市场主题(v0.4,~3.6 人日)

> **强顺序**:P1-6 先行(建立 l10n 模式)→ P2-14 复用同一套字典化手法,把跟上游 merge 的冲突压到最小。

| # | 任务 | 改动落点 | 依赖 |
|---|---|---|---|
| P1-6 | direct 模块 l10n | 所有硬编码中文提示/QuickPick/participant 回复改 `vscode.l10n.t()` + `l10n/bundle.l10n.zh-cn.json`;[package.json](../package.json) 加 `"l10n": "./l10n"`;默认英文、中文翻译。涉及 `index.ts`/`config.ts`/`auth.ts`/`participant.ts`/`provider.ts`/`commit.ts` | 无 |
| P2-14 | webview 中文化 | [media/chat.js](../media/chat.js)(4000+行)提取面向用户字符串 → 字典;host 传 locale 进 webview;chat.js 加 `t()` 层。**做成字典文件以最小化上游 merge 冲突** | P1-6(复用模式) |

**退出标准**:中英文随 VS Code 显示语言切换;记录本次改动对上游 merge 冲突面的影响(横切风险登记)。

---

## Phase 1 — 发布阻塞集(~3.3 人日)【放最后叙述,但执行最先】

> 这是能不能发下一个版本的门槛。Phase 0 的结论直接喂给 P0-3。

| # | 任务 | 改动落点 | 依赖 | 验证门 |
|---|---|---|---|---|
| P0-1 | Cursor 兼容守卫 | [src/direct/index.ts](../src/direct/index.ts) `activateDirect`:能力探测 `typeof vscode.lm?.registerLanguageModelChatProvider === 'function'` 才注册 provider,`vscode.chat?.createChatParticipant` 才注册 participant;每块 try/catch 独立降级 + 写日志;SCM 按钮/状态栏不依赖这些 API,照常注册 | 无 | **真机 Cursor 装 vsix**:侧边栏+SCM+状态栏可用、provider/participant 静默缺席 |
| P0-2 | OAuth 刷新去重 | [src/direct/oauth.ts](../src/direct/oauth.ts) `getValidAccessToken`/`refreshCredentials`:模块级 in-flight promise 去重(同上游 `primingPromise` 手法) | 无 | 并发触发不双刷 |
| P0-3 | 认证降级链 | [src/direct/auth.ts](../src/direct/auth.ts) `getAuthToken`:403 时按 grokCli→oauth→apiKey 降级重试,而非直接抛错(方案依 Phase 0 结论) | **Phase 0** | 403 场景自动降级 |
| P0-4 | reasoning 白名单 | provider 请求构造:仿 pi-grok `supportsReasoningEffort`,不支持 reasoning 的模型(grok-code-fast 系)不带 `reasoning.effort`;可加配置开关 | 无 | 非推理模型不再 400 |
| 合规 | 图标替换 | 勘查当前 `package.json` `icon` + `resources/` 图标来源;替换为自有图标 | **外部设计资源** | Marketplace 合规 |

**⚠️ 图标是外部依赖**:替换代码/资源只需 ~0.3 人日,但**图标设计成本未含**,若需新设计可能阻塞发布——尽早启动。

**Phase 1 退出标准(= 0.3.2 发布门)**:
- 真机 Cursor 三功能验证通过 + provider/participant 静默缺席
- 649 测试绿 + tsc 干净 + `test:live` 通过
- 图标合规
- 走一遍发布流程(tag + GitHub Release + vsix)

---

## 2. 风险登记册

| 风险 | 触发项 | 影响 | 缓解 |
|---|---|---|---|
| CLI token 对 /responses 不放行 | P0-3 | 方案重写 | **Phase 0 spike 前置** |
| Cursor 基线 < 1.104 装不上 | P0-1 | engines 讨论(范围爆炸,文档明确不做预案) | 真机验证尽早;若命中再单独立项 |
| 图标设计资源未就绪 | 合规 | 阻塞 0.3.2 发布 | 与代码并行启动设计 |
| webview 中文化跟上游 merge 冲突 | P2-14 | 长期同步税上升 | 字典化设计;P1-8 runbook |
| 上游同步税(历史已断链) | 横切 | 每次改 chat.js/provider 抬高未来 merge 成本 | 集中改 `src/direct/`;纯函数拆分降耦合 |

---

## 3. 里程碑与发布

- **0.3.2 = Phase 1 完成**:Cursor 不崩 + 图标合规 + 认证健壮。最小可发布,清阻塞。
- **0.3.x 迭代 = Phase 2 + 3**:质量网 + 快赢功能,可分多次小发。
- **0.4.0 = Phase 4**:中文市场主题(l10n + webview 中文化),核心差异化卖点。

---

## 4. 下一步

- 执行某一阶段:`/sc:implement`(建议从 **Phase 0 spike** 或 **P0-1 Cursor 守卫** 起步)
- 本文档为计划产物,未做任何代码改动。
