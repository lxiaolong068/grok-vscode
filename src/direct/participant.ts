import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getConfig } from './config';
import { ensureAuth } from './auth';
import { XaiClient, XaiInputItem, XaiRequestOptions, textMessage } from './xaiClient';

const execFileAsync = promisify(execFile);

const BASE_SYSTEM_PROMPT = [
  '你是 Grok Coder，一个务实的资深编程助手，运行在 VS Code 中。',
  '规则：直接给出答案和代码，不要客套；代码块标注语言；回答使用与用户相同的语言；',
  '涉及修改代码时优先给出最小 diff 或完整替换片段，并简短说明原因。'
].join('');

const COMMAND_PROMPTS: Record<string, string> = {
  fix: '任务：修复下面代码中的 bug 或问题。先用一两句话指出问题，然后给出修复后的代码。',
  explain: '任务：解释下面的代码。说明用途、关键逻辑和值得注意的坑，简明扼要。',
  review:
    '任务：审查下面的代码。按严重程度列出问题（bug > 安全 > 性能 > 可读性），每个问题给出具体修改建议，没有问题就明确说没有。',
  docs: '任务：为下面的代码生成文档注释（使用该语言的惯用注释风格，如 JSDoc/docstring），返回带注释的完整代码。',
  search:
    '任务：利用实时搜索工具回答用户的问题（如最新版本、breaking changes、社区讨论）。给出结论并附上来源链接。',
  commit:
    '任务：根据下面的 git diff 生成一条规范的 commit message（Conventional Commits 格式，英文 subject ≤ 72 字符，必要时加 body）。只输出 commit message 本身，放在代码块中。'
};

export function createGrokParticipant(
  context: vscode.ExtensionContext
): vscode.ChatParticipant {
  const handler: vscode.ChatRequestHandler = async (request, chatContext, stream, token) => {
    const auth = await ensureAuth(context.secrets);
    if (!auth) {
      stream.markdown(
        '尚未登录。请运行命令 **Grok Coder: 登录 Grok 账号**（SuperGrok / X Premium+ 订阅），或 **Grok Coder: 设置 xAI API Key**。'
      );
      return {};
    }
    const cfg = getConfig();
    const client = new XaiClient(cfg.baseUrl, auth.token);
    const command = request.command;

    // 会话历史（同参与者）
    const input: XaiInputItem[] = [];
    for (const turn of chatContext.history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        input.push(textMessage('user', turn.prompt));
      } else if (turn instanceof vscode.ChatResponseTurn) {
        const text = turn.response
          .filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
          .map((p) => p.value.value)
          .join('');
        if (text) {
          input.push(textMessage('assistant', text));
        }
      }
    }

    // 本轮用户消息：命令上下文（代码/diff）+ 用户输入
    let userContent: string;
    try {
      userContent = await buildUserContent(request, command, stream);
    } catch (e) {
      stream.markdown(`⚠️ ${(e as Error).message}`);
      return {};
    }
    input.push(textMessage('user', userContent));

    const options: XaiRequestOptions = {
      model: cfg.model,
      instructions: BASE_SYSTEM_PROMPT + (command ? '\n' + COMMAND_PROMPTS[command] : ''),
      input,
      reasoning: { effort: cfg.reasoningEffort }
    };
    if (command === 'search') {
      if (!cfg.enableLiveSearch) {
        stream.markdown('实时搜索已在设置中关闭（`grokCoder.enableLiveSearch`）。');
        return {};
      }
      // xAI 服务端搜索工具（OAuth 订阅或 API Key 均可用）
      options.tools = [{ type: 'web_search' }, { type: 'x_search' }];
      stream.progress('正在实时搜索 Web/X…');
    }

    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());
    try {
      for await (const ev of client.stream(options, abort.signal)) {
        if (token.isCancellationRequested) {
          break;
        }
        if (ev.type === 'text') {
          stream.markdown(ev.text);
        } else if (ev.type === 'citations') {
          stream.markdown('\n\n**来源：**\n' + ev.urls.map((u) => `- ${u}`).join('\n'));
        }
      }
    } catch (e) {
      stream.markdown(`\n\n⚠️ 请求失败：${(e as Error).message}`);
    } finally {
      sub.dispose();
    }
    return { metadata: { command } };
  };

  const participant = vscode.chat.createChatParticipant('grok-coder.grok', handler);
  participant.iconPath = new vscode.ThemeIcon('rocket');
  participant.followupProvider = {
    provideFollowups(result) {
      if ((result.metadata as any)?.command === 'review') {
        return [{ prompt: '按你的建议修复这些问题', label: '让 Grok 修复', command: 'fix' }];
      }
      return [];
    }
  };
  return participant;
}

/** 根据命令组装上下文：选中代码 / 当前文件 / git diff。 */
async function buildUserContent(
  request: vscode.ChatRequest,
  command: string | undefined,
  stream: vscode.ChatResponseStream
): Promise<string> {
  const prompt = request.prompt.trim();

  if (command === 'commit') {
    const diff = await getGitDiff();
    return `${prompt ? prompt + '\n\n' : ''}git diff:\n\`\`\`diff\n${diff}\n\`\`\``;
  }

  if (command === 'search' || !command) {
    const code = getEditorContext();
    return code ? `${prompt}\n\n当前编辑器上下文：\n${code}` : prompt || '你好，介绍一下你能做什么。';
  }

  // fix / explain / review / docs 需要代码上下文
  const code = getEditorContext();
  if (!code) {
    throw new Error('请先在编辑器中选中代码或打开一个文件。');
  }
  stream.progress('正在分析代码…');
  return `${prompt ? prompt + '\n\n' : ''}${code}`;
}

/** 取选中代码；无选中则取当前文件（截断到 50K 字符）。 */
function getEditorContext(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const doc = editor.document;
  const lang = doc.languageId;
  const fileName = vscode.workspace.asRelativePath(doc.uri);
  const selection = editor.selection;
  let code: string;
  let label: string;
  if (!selection.isEmpty) {
    code = doc.getText(selection);
    label = `文件 ${fileName} 中选中的代码（第 ${selection.start.line + 1}-${selection.end.line + 1} 行）`;
  } else {
    code = doc.getText();
    label = `文件 ${fileName} 的完整内容`;
  }
  const MAX = 50_000;
  if (code.length > MAX) {
    code = code.slice(0, MAX) + '\n/* ...内容过长已截断... */';
  }
  return `${label}:\n\`\`\`${lang}\n${code}\n\`\`\``;
}

/** 优先取暂存区 diff，为空则取工作区 diff。 */
async function getGitDiff(): Promise<string> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    throw new Error('没有打开的工作区，无法读取 git diff。');
  }
  const run = async (args: string[]) => {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  };
  try {
    let diff = await run(['diff', '--staged']);
    if (!diff.trim()) {
      diff = await run(['diff']);
    }
    if (!diff.trim()) {
      throw new Error('git diff 为空：没有可提交的改动。');
    }
    const MAX = 80_000;
    return diff.length > MAX ? diff.slice(0, MAX) + '\n... (diff 过长已截断)' : diff;
  } catch (e) {
    if ((e as Error).message.includes('git diff 为空')) {
      throw e;
    }
    throw new Error(`读取 git diff 失败：${(e as Error).message}`);
  }
}
