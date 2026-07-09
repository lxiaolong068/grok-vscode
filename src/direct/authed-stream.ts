/**
 * 带认证降级的流式请求。
 *
 * 首选认证档（grokCli → oauth → apiKey，见 auth.getAuthToken）若被 xAI 以 403 拒绝
 * （常见于「订阅档位未开放直连 API」），自动降级到下一档重试，而不是把错误直接抛给用户。
 * 403 只在建立连接时出现（在第一个流事件到达之前），因此在拿到首个 chunk 前切换是安全的。
 */
import * as vscode from 'vscode';
import { AuthMode, getAuthToken } from './auth';
import { XaiClient, XaiError, XaiRequestOptions, XaiStreamEvent } from './xaiClient';

export async function* streamWithAuthFallback(
  secrets: vscode.SecretStorage,
  baseUrl: string,
  options: XaiRequestOptions,
  abort?: AbortSignal
): AsyncGenerator<XaiStreamEvent> {
  const tried: AuthMode[] = [];
  while (true) {
    const auth = await getAuthToken(secrets, tried);
    if (!auth) {
      if (tried.length > 0) {
        throw new XaiError(
          '所有认证方式都被拒绝（403）：当前订阅档位可能未开放直连 API，请改用 xAI API Key 或升级订阅。',
          403
        );
      }
      throw new XaiError('Grok Coder：未登录。请登录 Grok 账号或设置 xAI API Key。');
    }

    const client = new XaiClient(baseUrl, auth.token);
    const iterator = client.stream(options, abort)[Symbol.asyncIterator]();

    let first: IteratorResult<XaiStreamEvent>;
    try {
      first = await iterator.next();
    } catch (e) {
      // 403 且还有下一档可试 → 记下当前档，降级重试
      if (e instanceof XaiError && e.status === 403) {
        tried.push(auth.mode);
        continue;
      }
      throw e;
    }

    // 首个 chunk 成功 → 连接已建立，把整条流吐完
    if (!first.done) {
      yield first.value;
      while (true) {
        const nx = await iterator.next();
        if (nx.done) {
          break;
        }
        yield nx.value;
      }
    }
    return;
  }
}
