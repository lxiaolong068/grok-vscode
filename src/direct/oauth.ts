/**
 * xAI OAuth 2.0 + PKCE 账号授权登录（SuperGrok / X Premium+ 订阅）。
 *
 * 流程：OIDC discovery (auth.x.ai) → 本机回环回调服务器 → 浏览器授权
 * → code 换 token → SecretStorage 保存 → 后台自动刷新。
 * 参考 Grok Build CLI 与开源实现（pi-grok / hermes-agent）的官方流程。
 */
import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

const ISSUER = 'https://auth.x.ai';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
/** xAI 公共 OAuth 客户端（Grok CLI 同款，可通过设置覆盖） */
const DEFAULT_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PORT = 56121;
const CALLBACK_PATH = '/callback';
const LOGIN_TIMEOUT_MS = 180_000;
/** 提前 5 分钟刷新 */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

const OAUTH_SECRET = 'grokCoder.xaiOAuth';

export interface OAuthCredentials {
  access: string;
  refresh: string;
  /** epoch ms（已减去 skew） */
  expires: number;
  tokenEndpoint: string;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
}

export class XaiOAuthError extends Error {
  constructor(
    message: string,
    /** true 表示需要重新登录 */
    public readonly requiresRelogin = false
  ) {
    super(message);
  }
}

// ---------- 工具函数 ----------

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function clientId(): string {
  return (
    vscode.workspace.getConfiguration('grokCoder').get<string>('oauthClientId') ||
    DEFAULT_CLIENT_ID
  );
}

/** 只信任 https 且 host 为 x.ai / *.x.ai 的端点，防止 discovery 被投毒 */
function validateEndpoint(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new XaiOAuthError(`OIDC discovery 返回非法 ${field}: ${value}`);
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (host !== 'x.ai' && !host.endsWith('.x.ai'))) {
    throw new XaiOAuthError(`拒绝非 xAI 域名的 ${field}: ${value}`);
  }
  return url.toString();
}

async function discover(): Promise<Discovery> {
  const res = await fetch(DISCOVERY_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000)
  });
  if (!res.ok) {
    throw new XaiOAuthError(`xAI OIDC discovery 失败 (${res.status})`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return {
    authorization_endpoint: validateEndpoint(
      String(json.authorization_endpoint ?? ''),
      'authorization_endpoint'
    ),
    token_endpoint: validateEndpoint(String(json.token_endpoint ?? ''), 'token_endpoint')
  };
}

// ---------- 回环回调服务器 ----------

interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
}

function startCallbackServer(): Promise<{
  server: http.Server;
  redirectUri: string;
  waitForCallback: () => Promise<CallbackResult>;
}> {
  let settle: (v: CallbackResult) => void;
  const callbackPromise = new Promise<CallbackResult>((resolve) => (settle = resolve));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${CALLBACK_HOST}`);
    if (url.pathname !== CALLBACK_PATH) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const result: CallbackResult = {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      error: url.searchParams.get('error') ?? undefined
    };
    res.statusCode = result.error ? 400 : 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      result.error
        ? '<html><body><h2>xAI 授权失败，可关闭此页。</h2></body></html>'
        : '<html><body><h2>xAI 授权成功，请回到 VS Code。</h2></body></html>'
    );
    settle(result);
  });

  const listen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, CALLBACK_HOST, () => {
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    });

  return (async () => {
    let port: number;
    try {
      port = await listen(CALLBACK_PORT);
    } catch {
      port = await listen(0); // 端口被占用则随机
    }
    server.on('error', (e) => settle({ error: String(e) }));
    return {
      server,
      redirectUri: `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`,
      waitForCallback: () =>
        Promise.race([
          callbackPromise,
          new Promise<CallbackResult>((resolve) =>
            setTimeout(() => resolve({ error: '授权超时（180 秒），请重试。' }), LOGIN_TIMEOUT_MS)
          )
        ])
    };
  })();
}

// ---------- 登录 / 刷新 / 存取 ----------

export async function login(secrets: vscode.SecretStorage): Promise<OAuthCredentials> {
  const discovery = await discover();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const nonce = b64url(crypto.randomBytes(16));

  const callback = await startCallbackServer();
  try {
    const authUrl = new URL(discovery.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId());
    authUrl.searchParams.set('redirect_uri', callback.redirectUri);
    authUrl.searchParams.set('scope', SCOPE);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('plan', 'generic');
    authUrl.searchParams.set('referrer', 'grok-coder-vscode');

    await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '等待浏览器中完成 xAI 授权…',
        cancellable: true
      },
      async (_progress, cancelToken) =>
        Promise.race([
          callback.waitForCallback(),
          new Promise<CallbackResult>((resolve) =>
            cancelToken.onCancellationRequested(() => resolve({ error: '已取消登录。' }))
          )
        ])
    );

    if (result.error) {
      throw new XaiOAuthError(`xAI 授权失败：${result.error}`);
    }
    if (result.state !== state) {
      throw new XaiOAuthError('OAuth state 不匹配（疑似 CSRF），已中止。');
    }
    if (!result.code) {
      throw new XaiOAuthError('回调中没有授权码。');
    }

    // code 换 token
    const res = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId(),
        code: result.code,
        redirect_uri: callback.redirectUri,
        code_verifier: verifier
      })
    });
    if (!res.ok) {
      throw new XaiOAuthError(`token 交换失败 (${res.status}): ${await res.text()}`);
    }
    const payload = (await res.json()) as Record<string, unknown>;
    const creds = toCredentials(payload, discovery.token_endpoint, undefined);
    await secrets.store(OAUTH_SECRET, JSON.stringify(creds));
    return creds;
  } finally {
    callback.server.close();
  }
}

export async function logout(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(OAUTH_SECRET);
}

export async function getStoredCredentials(
  secrets: vscode.SecretStorage
): Promise<OAuthCredentials | undefined> {
  const raw = await secrets.get(OAUTH_SECRET);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as OAuthCredentials;
  } catch {
    return undefined;
  }
}

/** 取有效 access token，过期则自动刷新。返回 undefined 表示未登录。 */
export async function getValidAccessToken(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  let creds = await getStoredCredentials(secrets);
  if (!creds) {
    return undefined;
  }
  if (Date.now() >= creds.expires) {
    creds = await refreshCredentials(secrets, creds);
  }
  return creds.access;
}

let refreshInFlight: Promise<OAuthCredentials> | undefined;

/**
 * 并发去重：provider 与 participant 可能同时发现 token 过期并各自触发刷新，
 * 用同一个 refresh_token 并发刷新会在 refresh-token 轮换下互相作废。
 * 用模块级 in-flight promise 保证同一时刻只有一次刷新在飞。
 */
function refreshCredentials(
  secrets: vscode.SecretStorage,
  creds: OAuthCredentials
): Promise<OAuthCredentials> {
  if (!refreshInFlight) {
    refreshInFlight = doRefreshCredentials(secrets, creds).finally(() => {
      refreshInFlight = undefined;
    });
  }
  return refreshInFlight;
}

async function doRefreshCredentials(
  secrets: vscode.SecretStorage,
  creds: OAuthCredentials
): Promise<OAuthCredentials> {
  const tokenEndpoint = validateEndpoint(creds.tokenEndpoint, 'token_endpoint');
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId(),
      refresh_token: creds.refresh
    })
  });
  if (!res.ok) {
    const fatal = [400, 401, 403].includes(res.status);
    if (fatal) {
      await secrets.delete(OAUTH_SECRET);
    }
    throw new XaiOAuthError(
      `xAI token 刷新失败 (${res.status})${fatal ? '，请重新登录' : ''}`,
      fatal
    );
  }
  const payload = (await res.json()) as Record<string, unknown>;
  const next = toCredentials(payload, tokenEndpoint, creds.refresh);
  await secrets.store(OAUTH_SECRET, JSON.stringify(next));
  return next;
}

function toCredentials(
  payload: Record<string, unknown>,
  tokenEndpoint: string,
  fallbackRefresh: string | undefined
): OAuthCredentials {
  const access = String(payload.access_token ?? '');
  const refresh = String(payload.refresh_token ?? fallbackRefresh ?? '');
  if (!access || !refresh) {
    throw new XaiOAuthError('token 响应缺少 access_token / refresh_token。');
  }
  const expiresIn =
    typeof payload.expires_in === 'number' ? payload.expires_in : Number(payload.expires_in ?? 3600);
  return {
    access,
    refresh,
    expires: Date.now() + expiresIn * 1000 - REFRESH_SKEW_MS,
    tokenEndpoint
  };
}
