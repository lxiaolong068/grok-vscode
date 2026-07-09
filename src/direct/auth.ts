import * as vscode from 'vscode';
import * as oauth from './oauth';
import { getApiKey } from './config';
import { readGrokCliToken } from './grok-cli-auth';

export type AuthMode = 'grokCli' | 'oauth' | 'apiKey';

export interface AuthToken {
  token: string;
  mode: AuthMode;
}

/**
 * 认证优先级：
 *  1) Grok Build CLI 登录态（`~/.grok/auth.json`）——首选，与 CLI 共用同一次登录，零二次授权；
 *  2) direct 自己的 Grok 账号 OAuth（SecretStorage 缓存，可自刷新）；
 *  3) xAI API Key（按量计费回退）。
 * xAI 后端对部分订阅档位的 OAuth API 有 403 门槛，因此保留 API Key 回退。
 */
export async function getAuthToken(
  secrets: vscode.SecretStorage,
  exclude: AuthMode[] = []
): Promise<AuthToken | undefined> {
  // 1) 复用 CLI 登录态（只读 auth.json，不刷新、不回写——刷新是 CLI 的职责）
  if (!exclude.includes('grokCli')) {
    const cliToken = readGrokCliToken();
    if (cliToken) {
      return { token: cliToken, mode: 'grokCli' };
    }
  }
  // 2) direct 自己的 OAuth 缓存
  if (!exclude.includes('oauth')) {
    try {
      const access = await oauth.getValidAccessToken(secrets);
      if (access) {
        return { token: access, mode: 'oauth' };
      }
    } catch (e) {
      if (e instanceof oauth.XaiOAuthError && e.requiresRelogin) {
        void vscode.window.showWarningMessage(
          'Grok Coder: 登录已过期，请重新运行 "Grok Coder: 登录 Grok 账号"。'
        );
      } else {
        console.warn('Grok Coder OAuth 刷新失败：', e);
      }
    }
  }
  // 3) API Key 回退
  if (!exclude.includes('apiKey')) {
    const apiKey = await getApiKey(secrets, false);
    if (apiKey) {
      return { token: apiKey, mode: 'apiKey' };
    }
  }
  return undefined;
}

export async function isLoggedIn(secrets: vscode.SecretStorage): Promise<boolean> {
  if (readGrokCliToken()) {
    return true;
  }
  return (await oauth.getStoredCredentials(secrets)) !== undefined;
}

/** 未登录时引导用户选择登录方式，返回可用 token。 */
export async function ensureAuth(
  secrets: vscode.SecretStorage
): Promise<AuthToken | undefined> {
  const existing = await getAuthToken(secrets);
  if (existing) {
    return existing;
  }
  const choice = await vscode.window.showInformationMessage(
    'Grok Coder 需要登录。若你已用 Grok Build CLI 登录，请在终端运行一次 `grok`（会自动刷新登录态），插件会自动复用；或在此用 Grok 账号授权（SuperGrok / X Premium+ 订阅）/ xAI API Key。',
    '登录 Grok 账号',
    '使用 API Key'
  );
  if (choice === '登录 Grok 账号') {
    await vscode.commands.executeCommand('grokCoder.login');
  } else if (choice === '使用 API Key') {
    await vscode.commands.executeCommand('grokCoder.setApiKey');
  } else {
    return undefined;
  }
  return getAuthToken(secrets);
}
