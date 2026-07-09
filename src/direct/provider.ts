import * as vscode from 'vscode';
import { getConfig } from './config';
import { AuthMode, ensureAuth, getAuthToken } from './auth';
import { streamWithAuthFallback } from './authed-stream';
import {
  XaiContentPart,
  XaiInputItem,
  XaiTool,
  supportsReasoningEffort
} from './xaiClient';

const GROK_45_CONTEXT = 500_000;
const DEFAULT_MAX_OUTPUT = 32_768;

/**
 * BYOK Provider：把 grok-4.5 注册进 VS Code 原生 Chat 模型选择器。
 * 认证走 Grok 账号 OAuth（订阅额度），无则回退 API Key。
 */
export class GrokChatProvider implements vscode.LanguageModelChatProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  refresh(): void {
    this.onDidChangeEmitter.fire();
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const auth = options.silent
      ? await getAuthToken(this.secrets)
      : await ensureAuth(this.secrets);
    if (!auth) {
      return [];
    }

    const cfg = getConfig();
    const models: vscode.LanguageModelChatInformation[] = [
      {
        id: 'grok-4.5',
        name: 'Grok 4.5',
        family: 'grok',
        version: '4.5',
        maxInputTokens: GROK_45_CONTEXT - DEFAULT_MAX_OUTPUT,
        maxOutputTokens: DEFAULT_MAX_OUTPUT,
        tooltip: `xAI Grok 4.5 — 500K 上下文（${authSourceLabel(auth.mode)}）`,
        detail: authDetailLabel(auth.mode),
        capabilities: {
          imageInput: true,
          toolCalling: true
        }
      }
    ];

    for (const m of cfg.additionalModels) {
      if (!m?.id) {
        continue;
      }
      const ctx = m.contextWindow ?? 131_072;
      const maxOut = m.maxOutputTokens ?? 8_192;
      models.push({
        id: m.id,
        name: m.name ?? m.id,
        family: 'grok',
        version: '1.0.0',
        maxInputTokens: Math.max(ctx - maxOut, 1),
        maxOutputTokens: maxOut,
        detail: 'xAI',
        capabilities: { imageInput: false, toolCalling: true }
      });
    }
    return models;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const cfg = getConfig();
    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());
    const modelOptions = (options.modelOptions ?? {}) as Record<string, unknown>;
    const { instructions, input } = convertMessages(messages);

    try {
      const events = streamWithAuthFallback(
        this.secrets,
        cfg.baseUrl,
        {
          model: model.id,
          instructions,
          input,
          tools: convertTools(options.tools),
          tool_choice: convertToolMode(options.toolMode, options.tools),
          temperature: numberOrUndefined(modelOptions['temperature']),
          max_output_tokens: numberOrUndefined(modelOptions['max_tokens']),
          reasoning: supportsReasoningEffort(model.id)
            ? { effort: cfg.reasoningEffort }
            : undefined
        },
        abort.signal
      );

      for await (const ev of events) {
        if (token.isCancellationRequested) {
          break;
        }
        if (ev.type === 'text') {
          progress.report(new vscode.LanguageModelTextPart(ev.text));
        } else if (ev.type === 'tool_call') {
          progress.report(
            new vscode.LanguageModelToolCallPart(
              ev.call.callId,
              ev.call.name,
              safeParseJson(ev.call.arguments)
            )
          );
        }
      }
    } finally {
      sub.dispose();
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') {
      return Math.ceil(text.length / 4);
    }
    let total = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        total += Math.ceil(part.value.length / 4);
      } else {
        total += 100; // 工具调用/图像等按固定开销估算
      }
    }
    return total;
  }
}

// ---------- VS Code 消息 → Responses API input 转换 ----------

function convertMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): {
  instructions: string | undefined;
  input: XaiInputItem[];
} {
  const input: XaiInputItem[] = [];
  const systemParts: string[] = [];
  const roleSystem = (vscode.LanguageModelChatMessageRole as any).System;

  for (const msg of messages) {
    const isAssistant = msg.role === vscode.LanguageModelChatMessageRole.Assistant;
    const isSystem = roleSystem !== undefined && msg.role === roleSystem;

    const contentParts: XaiContentPart[] = [];

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        if (!part.value) {
          continue;
        }
        if (isSystem) {
          systemParts.push(part.value);
        } else {
          contentParts.push({
            type: isAssistant ? 'output_text' : 'input_text',
            text: part.value
          });
        }
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        input.push({
          type: 'function_call',
          call_id: part.callId,
          name: part.name,
          arguments: JSON.stringify(part.input ?? {})
        });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        input.push({
          type: 'function_call_output',
          call_id: part.callId,
          output: stringifyToolResult(part.content)
        });
      } else if (isDataPart(part)) {
        contentParts.push({
          type: 'input_image',
          image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`,
          detail: 'auto'
        });
      }
    }

    if (contentParts.length > 0) {
      input.push({ role: isAssistant ? 'assistant' : 'user', content: contentParts });
    }
  }

  return {
    instructions: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    input
  };
}

function stringifyToolResult(content: ReadonlyArray<unknown>): string {
  return content
    .map((p) => (p instanceof vscode.LanguageModelTextPart ? p.value : JSON.stringify(p)))
    .join('\n');
}

function isDataPart(part: unknown): part is { mimeType: string; data: Uint8Array } {
  return (
    typeof part === 'object' &&
    part !== null &&
    typeof (part as any).mimeType === 'string' &&
    (part as any).data instanceof Uint8Array &&
    (part as any).mimeType.startsWith('image/')
  );
}

function convertTools(
  tools: readonly vscode.LanguageModelChatTool[] | undefined
): XaiTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return tools.map((t) => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: (t.inputSchema as object | undefined) ?? { type: 'object', properties: {} }
  }));
}

function convertToolMode(
  mode: vscode.LanguageModelChatToolMode | undefined,
  tools: readonly vscode.LanguageModelChatTool[] | undefined
): 'auto' | 'required' | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return mode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';
}

function safeParseJson(s: string): object {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? v : {};
  } catch {
    return {};
  }
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** 额度来源短标签（tooltip 用）。 */
function authSourceLabel(mode: AuthMode): string {
  switch (mode) {
    case 'grokCli':
      return 'Grok CLI 登录 · 订阅额度';
    case 'oauth':
      return '账号订阅额度';
    default:
      return 'API Key 计费';
  }
}

/** 登录方式明细（detail 用）。 */
function authDetailLabel(mode: AuthMode): string {
  switch (mode) {
    case 'grokCli':
      return 'xAI · 已用 Grok CLI 登录';
    case 'oauth':
      return 'xAI · 已用 Grok 账号登录';
    default:
      return 'xAI · API Key';
  }
}
