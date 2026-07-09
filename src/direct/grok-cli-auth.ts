/**
 * 复用 Grok Build CLI 的登录态。
 *
 * `grok login` 会把 OAuth 凭证写进 `~/.grok/auth.json`，顶层 key 形如
 * `${issuer}::${client_id}`，值里含 `key`（access token / JWT）、`refresh_token`、
 * `expires_at`（ISO 8601）等。direct 模块与 CLI 用的是同一个 OAuth 客户端
 * （client_id 一致），因此这里**只读复用**该 access token，避免让用户在插件里再登录一次。
 *
 * 刻意的约束：只读，从不刷新、从不回写 auth.json。刷新（含 refresh-token 轮换）是
 * CLI 的职责——它持有 `auth.json.lock`。token 过期时这里直接返回 undefined，交由
 * 上层回退，并提示用户在终端跑一次 `grok` 让 CLI 自己刷新。
 */
import { readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { grokHomeDir } from "../cli-locator";

/** xAI 公共 OAuth 客户端 id（与 src/direct/oauth.ts 的 DEFAULT_CLIENT_ID 一致）。 */
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";

/** access token 提前视为过期的余量。 */
const EXPIRY_SKEW_MS = 60_000;

interface GrokCliEntry {
  key?: string; // access token（JWT）
  refresh_token?: string;
  expires_at?: string; // ISO 8601
  oidc_client_id?: string;
  oidc_issuer?: string;
  auth_mode?: string;
}

/**
 * 从解析后的 auth.json 里挑出可用的 access token。纯函数，便于测试。
 * 只认 client_id 与我方一致、且 access token 未过期（带 skew）的条目。
 */
export function extractGrokCliToken(
  parsed: unknown,
  nowMs: number,
  clientId: string = XAI_OAUTH_CLIENT_ID
): string | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  for (const [compositeKey, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const entry = value as GrokCliEntry;
    const matches =
      entry.oidc_client_id === clientId || compositeKey.endsWith(`::${clientId}`);
    if (!matches) {
      continue;
    }
    if (typeof entry.key !== "string" || entry.key.length === 0) {
      continue;
    }
    if (entry.expires_at) {
      const expMs = Date.parse(entry.expires_at);
      if (Number.isFinite(expMs) && expMs - EXPIRY_SKEW_MS <= nowMs) {
        continue; // 已过期：只读不刷，交给 CLI
      }
    }
    return entry.key;
  }
  return undefined;
}

/** 读 `~/.grok/auth.json`，返回 CLI 登录态里未过期的 access token（只读）；无则 undefined。 */
let authFileCache: { mtimeMs: number; parsed: unknown } | undefined;

export function readGrokCliToken(nowMs: number = Date.now()): string | undefined {
  try {
    const file = path.join(grokHomeDir(), "auth.json");
    // 按 mtime 缓存解析结果：CLI 刷新 auth.json 会改 mtime，缓存随即失效；
    // 避免流式对话每轮取 token 都 read + JSON.parse。过期判断仍每次用 nowMs 做（便宜）。
    const mtimeMs = statSync(file).mtimeMs;
    if (!authFileCache || authFileCache.mtimeMs !== mtimeMs) {
      authFileCache = { mtimeMs, parsed: JSON.parse(readFileSync(file, "utf8")) };
    }
    return extractGrokCliToken(authFileCache.parsed, nowMs);
  } catch {
    authFileCache = undefined;
    return undefined;
  }
}
