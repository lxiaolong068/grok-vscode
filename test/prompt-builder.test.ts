import { describe, it, expect } from "vitest";
import { buildPrompt, CONTEXT_TAG_OPEN, CONTEXT_TAG_CLOSE } from "../src/prompt-builder";
import { makeImplicitChip, makeExplicitChip } from "../src/chips";

const deps = {
  readFile: (p: string) => {
    if (p === "/a.ts") return "line1\nline2\nline3\nline4\nline5";
    if (p === "/b.ts") return "X\nY";
    throw new Error("ENOENT " + p);
  },
  extName: (p: string) => {
    const i = p.lastIndexOf(".");
    return i >= 0 ? p.slice(i) : "";
  },
};

// The file-path context is wrapped in the <vscode-context> envelope.
const ctx = (inner: string) => `${CONTEXT_TAG_OPEN}\n${inner}\n${CONTEXT_TAG_CLOSE}`;

describe("buildPrompt", () => {
  it("returns just the text when no chips", () => {
    expect(buildPrompt("hello", [], deps)).toBe("hello");
  });

  it("wraps an explicitly attached file in the context envelope", () => {
    const out = buildPrompt("explain this", [makeExplicitChip("/a.ts", "src/a.ts")], deps);
    expect(out).toBe(ctx("Attached file: src/a.ts") + "\n\nexplain this");
  });

  it("lists multiple attached files under 'Attached files:'", () => {
    const a = makeExplicitChip("/a.ts", "src/a.ts");
    const b = makeExplicitChip("/pic.png", "/Users/me/Downloads/pic.png");
    const out = buildPrompt("animate it", [a, b], deps);
    expect(out).toBe(
      ctx("Attached files:\n- src/a.ts\n- /Users/me/Downloads/pic.png") + "\n\nanimate it",
    );
  });

  it("lists the active-editor file separately as ambient 'Currently open' context", () => {
    const out = buildPrompt("explain this", [makeImplicitChip("/a.ts", "src/a.ts")], deps);
    expect(out).toBe(ctx("Currently open in the editor (for context): src/a.ts") + "\n\nexplain this");
  });

  it("lists multiple open-editor files under the 'Currently open' header", () => {
    const a = makeImplicitChip("/a.ts", "src/a.ts");
    const b = makeImplicitChip("/b.ts", "src/b.ts");
    const out = buildPrompt("q", [a, b], deps);
    expect(out).toBe(
      ctx("Currently open in the editor (for context):\n- src/a.ts\n- src/b.ts") + "\n\nq",
    );
  });

  it("keeps attached files and open-editor files in separate sections", () => {
    const attached = makeExplicitChip("/a.ts", "a.ts");
    const open = makeImplicitChip("/b.ts", "b.ts");
    const out = buildPrompt("compare", [attached, open], deps);
    expect(out).toBe(
      ctx("Attached file: a.ts\n\nCurrently open in the editor (for context): b.ts") + "\n\ncompare",
    );
  });

  it("renders a selection chip as fenced code (outside the envelope)", () => {
    const chip = makeExplicitChip("/a.ts", "src/a.ts", 2, 4);
    const out = buildPrompt("what is this", [chip], deps);
    expect(out).toBe(
      "`src/a.ts` (lines 2-4):\n```ts\nline2\nline3\nline4\n```\n\nwhat is this",
    );
  });

  it("skips hidden chips", () => {
    const visible = makeExplicitChip("/a.ts", "a.ts");
    const hidden = { ...makeExplicitChip("/b.ts", "b.ts"), hidden: true };
    expect(buildPrompt("q", [visible, hidden], deps)).toBe(ctx("Attached file: a.ts") + "\n\nq");
  });

  it("falls back to a plain attached path when readFile throws", () => {
    const chip = makeExplicitChip("/missing.ts", "missing.ts", 1, 5);
    expect(buildPrompt("q", [chip], deps)).toBe(ctx("Attached file: missing.ts") + "\n\nq");
  });

  it("combines an attachment with a selection snippet", () => {
    const a = makeExplicitChip("/a.ts", "a.ts");
    const b = makeExplicitChip("/b.ts", "b.ts", 1, 2);
    const out = buildPrompt("compare", [a, b], deps);
    expect(out).toBe(
      ctx("Attached file: a.ts") + "\n\n`b.ts` (lines 1-2):\n```ts\nX\nY\n```\n\ncompare",
    );
  });

  it("uses empty fence language when no extension", () => {
    const chip = makeExplicitChip("/Makefile", "Makefile", 1, 1);
    const out = buildPrompt("", [chip], {
      readFile: () => "all:\n\techo",
      extName: () => "",
    });
    expect(out).toContain("```\nall:");
  });
});
