import * as vscode from 'vscode';

const API_KEY_SECRET = 'grokCoder.xaiApiKey';

export function getConfig() {
  const cfg = vscode.workspace.getConfiguration('grokCoder');
  return {
    baseUrl: (cfg.get<string>('baseUrl') ?? 'https://api.x.ai/v1').replace(/\/$/, ''),
    model: cfg.get<string>('model') ?? 'grok-4.5',
    reasoningEffort: cfg.get<'low' | 'medium' | 'high'>('reasoningEffort') ?? 'low',
    enableLiveSearch: cfg.get<boolean>('enableLiveSearch') ?? true,
    additionalModels:
      cfg.get<{ id: string; name?: string; contextWindow?: number; maxOutputTokens?: number }[]>(
        'additionalModels'
      ) ?? []
  };
}

export async function getApiKey(
  secrets: vscode.SecretStorage,
  promptIfMissing: boolean
): Promise<string | undefined> {
  const existing = await secrets.get(API_KEY_SECRET);
  if (existing) {
    return existing;
  }
  if (!promptIfMissing) {
    return undefined;
  }
  return promptForApiKey(secrets);
}

export async function promptForApiKey(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: '输入 xAI API Key',
    prompt: '在 https://console.x.ai 创建 API Key（仅保存在本机 SecretStorage）',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'xai-...'
  });
  if (value && value.trim()) {
    await secrets.store(API_KEY_SECRET, value.trim());
    vscode.window.showInformationMessage('Grok Coder: API Key 已保存。');
    return value.trim();
  }
  return undefined;
}

export async function clearApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(API_KEY_SECRET);
  vscode.window.showInformationMessage('Grok Coder: API Key 已清除。');
}
