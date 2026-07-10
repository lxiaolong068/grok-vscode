# Upstream sync plan: v1.4.30 → v1.5.1

**Status:** Waves A–B–C applied (2026-07-10) — full sync to v1.5.1  
**Date:** 2026-07-10  
**Upstream:** [phuryn/grok-build-vscode](https://github.com/phuryn/grok-build-vscode)  
**Base (fork documented):** ≈ `v1.4.30`  
**Target:** `v1.5.1` (`d128de8`)  
**Local branch:** `main` @ `37b75b3` (ahead of origin by local work; version `0.3.1`)

## 0. Remotes (done)

```text
origin   https://github.com/lxiaolong068/grok-vscode.git
upstream https://github.com/phuryn/grok-build-vscode.git
```

```bash
git fetch upstream --tags   # already run
```

Do **not** `git merge upstream/main` — this is a detached fork (no common ancestor). Sync is patch / cherry-pick only.

## 1. Gap summary

| Upstream release | Date | Headline | Local status |
|---|---|---|---|
| **1.4.31** | 2026-07-09 | defaultModel setModel 容错；install 支持任意 IDE CLI | **Missing** (local has `shouldApplyModel` skip-list only, not try/catch on live setModel) |
| **1.5.0** | 2026-07-09 | vision 贴图；live selection chip；`/compact` 修复；plan-gate 只读链式命令 | **Missing** |
| **1.5.1** | 2026-07-09 | config.toml always-approve 检测；隐藏 `/always-approve`；`protocol.ts`；release/live/CI 门禁 | **Missing** |

**Upstream delta size** (`v1.4.30..v1.5.1`): ~17 commits, **~1.6k insertions** on shared `src/` / `media/` / `scripts/`.

### Local-only (never take from upstream brand / skip)

| Area | Notes |
|---|---|
| `src/direct/**` | Fork BYOK / `@grok` / OAuth / SCM / status bar |
| Publisher / package identity | Keep `brucelee` / `grok-coder` / Chinese copy |
| Status-bar live model | `notifyStatus` / `getStatusModel` / `status-label.ts` (37b75b3) — **preserve** when merging `sidebar.ts` |
| `shouldApplyModel` | Local hardening (# stale default) — **keep** and **stack** upstream try/catch on top |

## 2. File map (what to apply)

### 2.1 New files (copy wholesale from `v1.5.1`)

| Path | Role |
|---|---|
| `src/protocol.ts` | Host→webview message discriminated union |
| `src/grok-config.ts` | Read project/global `config.toml` for `permission_mode` |
| `test/protocol.test.ts` | Host/webview protocol parity |
| `test/grok-config.test.ts` | Config parsing |
| `test/image-attach.dom.test.ts` | Vision chip / paste DOM |
| `research/vision-input.md`, `research/vision-probe.cjs` | Wire notes / probe |
| `research/compact.md`, `research/compact-probe.cjs` | Compact regression notes |
| `integration/**`, `.vscode-test.mjs` | `@vscode/test-electron` smoke (optional same PR as CI) |

### 2.2 Shared code (high conflict risk — 3-way apply + hand-resolve)

| Path | Upstream change | Conflict risk with fork |
|---|---|---|
| **`src/sidebar.ts`** | +~520 lines: image stage/paste/drop, always-approve notice, compact confirm, HostMsg typing, selection chip, focus caret | **Highest** — also has `statusEmitter` / `notifyStatus` / direct-related wiring |
| **`media/chat.js`** | vision chips, compact UI, composer card, gear/model refresh paths | **High** — local model-label refresh (`refreshGearModelUi`) must stay |
| **`media/chat.css`** | composer card, scrollbars, attachment image styles | Medium |
| **`media/webview-helpers.js`** | protocol mirror, selection/chip helpers, image parse | Medium–high |
| **`src/chips.ts`** | image chip types | Low–medium |
| **`src/prompt-builder.ts`** | vision blocks + slash-first compact fix + context envelope order | **High** (behavior-critical) |
| **`src/acp.ts`** | `prompt(string \| blocks)`, setModel try/catch, filter slash cmds | Medium — merge with local `shouldApplyModel` |
| **`src/plan-gate.ts`** | allow `&&` `||` `;` read-only chains (#36) | Low (pure, local still on old gate) |
| **`src/slash-filter.ts`** | hide `/always-approve` | Low |
| **`src/session.ts`** | small session fields for images / attach | Low–medium |
| **`scripts/install.*` `uninstall.*`** | multi-IDE CLI targeting | Low |
| **`scripts/release.*` `live-tests.cjs`** | live-by-default, smoke lane | Medium (fork release IDs) |
| **`package.json` scripts/deps only** | `test:integration`, `@vscode/test-electron` | **Do not** take version/publisher/name |
| **`.github/workflows/ci.yml`** | integration job + xvfb | Low |
| Tests under `test/*` matching above | update/add | Medium |

### 2.3 Docs (apply content, keep brand)

`CHANGELOG.md` (record synced SHA), `CLAUDE.md` module map, `README.md` (vision feature), `docs/architecture.md`, `TESTS.md` — rewrite in **our** voice/IDs after code lands.

## 3. Execution waves (recommended)

Apply as **3 sequential waves** on `main` (or a throwaway branch if preferred; project convention is direct-to-main). Each wave: apply → resolve → `npm test` + `tsc` green before next.

### Wave A — 1.4.31 stability + install tooling ✅ DONE  
**Goal:** crash-proof model startup; multi-IDE install scripts.

1. `src/acp.ts`: wrap `setModel` in try/catch on new/load **in addition to** existing `shouldApplyModel`. ✅
2. `src/sidebar.ts` (minimal): toast when configured model not in list (upstream #33/#34 UX). ✅
3. `scripts/install.{sh,ps1}` + `uninstall.{sh,ps1}`: `CODE_CLI` / `-Cli` targeting (kept `brucelee.grok-coder` id). ✅
4. Related tests (`test/acp.test.ts` set_model failure swallow). ✅

**Gate:** `npm test && npm run compile`

### Wave B — 1.5.0 product features ✅ DONE  
**Goal:** vision + compact + plan-gate chains + composer polish.

1. Pure first: plan-gate chains, chips vision helpers, prompt-builder + slash match. ✅  
2. `src/acp.ts`: `PromptContentBlock` + multi-part `prompt()` (kept Wave A try/catch). ✅  
3. `src/session.ts`: `imageCounter`. ✅  
4. `src/sidebar.ts`: paste/drop/stage images, selection chip, compact re-prime, notifyStatus preserved. ✅  
5. `media/*` + `test/image-attach.dom.test.ts` + harness/DOM tests. ✅  
6. Research probes: `research/vision-*`, `research/compact-*`. ✅  

**Gate:** `npm test` **765** green + `npm run compile`  
**Manual/live (when convenient):** paste screenshot; `/compact`; plan-mode `cd x && git status`

### Wave C — 1.5.1 protocol + always-approve + gates ✅ DONE  
**Goal:** correctness infra + config.toml truth.

1. `src/protocol.ts`, `src/grok-config.ts` + unit tests ✅  
2. `HostMsg`/`WebviewMsg` on `sidebar` post/emit + `Session.buffer` ✅  
3. Filter `/always-approve` at ACP command ingestion ✅  
4. config.toml always-approve → Auto accept UI + one-shot notice ✅  
5. `test:integration` scripts/deps + CI job + `brucelee.grok-coder` smoke id ✅  
6. `release.*` default `test:live` + vsix name `grok-coder-*`; live-tests smoke/plan rewrite ✅  
7. CHANGELOG Unreleased + CLAUDE module map ✅  

**Gate:** `npm test` **788** green + `npm run compile`

## 4. Apply technique

```bash
# Example wave (paths trimmed per wave):
git diff v1.4.30..v1.5.1 -- \
  src/plan-gate.ts test/plan-gate.test.ts \
  | git apply --3way
```

If `--3way` leaves markers:

- **Brand / publisher / telemetry SDK / welcome byline** → keep ours  
- **`src/direct/`** → never apply upstream  
- **`sidebar.ts` status bar hooks** → keep ours, re-apply after conflict  
- **Logic** → prefer upstream for the feature under merge, re-test

Prefer **path-filtered diffs per wave** over one giant apply of all 50 files.

## 5. Invariants to not break

1. **Plan gate** still client-enforced; chains only if *every* segment is read-only.  
2. **Primer** still silent / non-blocking; compact re-sends primer after (upstream 1.5.0).  
3. **Prompt builder:** confirmed slash commands **lead** the text block (compact bug).  
4. **Vision:** images as ACP image blocks; SVG remains path chip.  
5. **Status bar:** still reads live focused model via `notifyStatus` after session/model/focus.  
6. **Direct module** continues to activate from `extension.ts` unchanged.  
7. **Version bump** only when you ask to release — iterate at `0.3.1` (or current) until then.

## 6. Risk register

| Risk | Mitigation |
|---|---|
| `sidebar.ts` conflict explosion | Wave A minimal; Wave B feature-by-feature; keep statusEmitter islands |
| Protocol typing breaks post() call sites | Land `protocol.ts` early in Wave B/C; fix compile errors as checklist |
| Local `shouldApplyModel` vs upstream try/catch | Keep both: skip if not in list; catch if setModel still throws |
| Integration test flaky on CI | Add job; if xvfb flakes, fix — don't drop (upstream policy) |
| Live suite burns credits | Only at end / pre-release |

## 7. Definition of done

- [ ] All Wave A–C code merged  
- [ ] `npm test` green (floor grows with new tests; currently 691+)  
- [ ] `tsc -p . --noEmit` clean  
- [ ] CHANGELOG notes synced-to upstream SHA `d128de8` / tag `v1.5.1`  
- [ ] CLAUDE.md module map lists `protocol`, `grok-config`, vision  
- [ ] Manual smoke: paste image, `/compact`, plan chain command, always-approve UI if `config.toml` set  
- [ ] `npm run test:live` before any tag/release  
- [ ] No accidental publisher/version publish  

## 8. Suggested next command (after you approve implementation)

Start **Wave A only** (safest, smallest):

```bash
# will be done by agent when you say "开始 Wave A"
git diff v1.4.30..v1.5.1 -- src/acp.ts scripts/install.sh scripts/install.ps1 \
  scripts/uninstall.sh scripts/uninstall.ps1
# then 3-way apply + hand-merge + tests
```

---

_Record: upstream remote added 2026-07-10; plan authored for sync to v1.5.1 without applying product patches yet._
