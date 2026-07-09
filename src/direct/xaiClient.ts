/**
 * 轻量 xAI Responses API 客户端（/v1/responses，SSE 流式）。
 *
 * 说明：账号 OAuth 授权只对 Responses API 生效（Grok Build CLI 同款接口），
 * API Key 同样支持，因此统一走 /responses。
 * xAI 与 OpenAI Responses 的已知差异（本客户端已适配）：
 *  - input 数组中不允许 system/developer 角色 → 用顶层 instructions
 *  - 不允许空字符串内容项
 *  - 图像必须是 input_image + data URI / https URL
 */

export type XaiContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' };

export type XaiInputItem =
  | { role: 'user' | 'assistant'; content: XaiContentPart[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export type XaiTool =
  | { type: 'function'; name: string; description?: string; parameters?: object }
  | { type: 'web_search' }
  | { type: 'x_search' };

export interface XaiRequestOptions {
  model: string;
  /** 系统提示（xAI 不接受 input 中的 system 角色） */
  instructions?: string;
  input: XaiInputItem[];
  tools?: XaiTool[];
  tool_choice?: 'auto' | 'required' | 'none';
  temperature?: number;
  max_output_tokens?: number;
  reasoning?: { effort: 'low' | 'medium' | 'high' };
}

export interface XaiToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export type XaiStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: XaiToolCall }
  | { type: 'citations'; urls: string[] };

export class XaiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
  }
}

export class XaiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly bearerToken: string
  ) {}

  /** 流式请求，产出文本增量、完整工具调用与引用来源。 */
  async *stream(
    options: XaiRequestOptions,
    abort?: AbortSignal
  ): AsyncGenerator<XaiStreamEvent> {
    const body: Record<string, unknown> = {
      ...options,
      input: sanitizeInput(options.input),
      stream: true,
      store: false
    };

    const res = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.bearerToken}`
      },
      body: JSON.stringify(body),
      signal: abort
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      if (res.status === 403) {
        throw new XaiError(
          '403：你的订阅档位可能未开放 OAuth API 访问（xAI 侧限制）。可改用 API Key，或升级订阅。',
          403
        );
      }
      throw new XaiError(`xAI API 请求失败 (${res.status}): ${truncate(text, 400)}`, res.status);
    }

    const citations = new Set<string>();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) {
            continue;
          }
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') {
            continue;
          }
          let ev: any;
          try {
            ev = JSON.parse(data);
          } catch {
            continue;
          }

          switch (ev.type) {
            case 'response.output_text.delta':
              if (typeof ev.delta === 'string' && ev.delta) {
                yield { type: 'text', text: ev.delta };
              }
              break;
            case 'response.output_item.done': {
              const item = ev.item;
              if (item?.type === 'function_call' && item.name) {
                yield {
                  type: 'tool_call',
                  call: {
                    callId: item.call_id ?? item.id ?? `call_${Date.now()}`,
                    name: item.name,
                    arguments: item.arguments ?? '{}'
                  }
                };
              }
              break;
            }
            case 'response.output_text.annotation.added': {
              const url = ev.annotation?.url;
              if (typeof url === 'string') {
                citations.add(url);
              }
              break;
            }
            case 'response.failed':
            case 'error': {
              const msg =
                ev.response?.error?.message ?? ev.message ?? ev.error?.message ?? '未知错误';
              throw new XaiError(`xAI 返回错误：${msg}`);
            }
            default:
              break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (citations.size > 0) {
      yield { type: 'citations', urls: [...citations] };
    }
  }
}

/** 去掉空内容项，规避 xAI 的校验错误。 */
function sanitizeInput(input: XaiInputItem[]): XaiInputItem[] {
  return input.filter((item) => {
    if ('role' in item) {
      item.content = item.content.filter(
        (p) => p.type === 'input_image' || p.text.length > 0
      );
      return item.content.length > 0;
    }
    return true;
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 便捷函数：把纯文本对话组装为 input。 */
export function textMessage(role: 'user' | 'assistant', text: string): XaiInputItem {
  return {
    role,
    content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }]
  };
}

/**
 * 该模型是否支持 `reasoning.effort`。非推理模型（如 grok-code-fast 系）带上
 * reasoning 会被 xAI 以 400 拒绝，因此配置了这类模型时需省略该字段。纯函数，便于测试。
 */
export function supportsReasoningEffort(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.includes('code-fast') || id.startsWith('grok-code')) {
    return false;
  }
  return true;
}
