export interface SlashCmd {
  name: string;
  description?: string;
}

/**
 * Given the current composer text and cursor position, return the slash-command query
 * (the chars after `/` on the line that the caret is in) or `null` if no popover is active.
 *
 * The popover activates only when `/` is at the start of the line or after a newline.
 */
export function getSlashQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|\n)\/(\S*)$/);
  return m ? m[1] : null;
}

export function filterCommands(commands: SlashCmd[], query: string): SlashCmd[] {
  const q = query.toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.name.toLowerCase().startsWith(q));
}

/** Replace the partial `/q` token with `/<name> ` and return the new text + caret. */
export function applySlashPick(
  text: string,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const newBefore = before.replace(/(?:^|\n)\/(\S*)$/, (m) =>
    m.startsWith("\n") ? `\n/${name} ` : `/${name} `,
  );
  return { text: newBefore + after, caret: newBefore.length };
}
