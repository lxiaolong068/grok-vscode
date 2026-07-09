/** direct 模块的无依赖文本工具（不 import vscode，便于测试）。 */

/** 去掉 Markdown 代码块围栏(```lang … ```)，返回纯文本。 */
export function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .trim();
}

/** 提取 Markdown 中第一个围栏代码块的内容；无围栏则 undefined。 */
export function extractFirstCodeBlock(markdown: string): string | undefined {
  const m = markdown.match(/```[^\n]*\n([\s\S]*?)```/);
  if (!m) {
    return undefined;
  }
  return m[1].replace(/\n+$/, '');
}
