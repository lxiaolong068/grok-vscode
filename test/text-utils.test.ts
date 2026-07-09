import { describe, it, expect } from "vitest";
import { stripFences, extractFirstCodeBlock } from "../src/direct/text-utils";

describe("stripFences", () => {
  it("去掉带语言标注的围栏", () => {
    expect(stripFences("```bash\nfix: bug\n```")).toBe("fix: bug");
  });

  it("去掉无语言标注的围栏", () => {
    expect(stripFences("```\nfeat: x\n```")).toBe("feat: x");
  });

  it("无围栏原样返回（去首尾空白）", () => {
    expect(stripFences("  chore: y  ")).toBe("chore: y");
  });

  it("多行内容保留内部换行", () => {
    expect(stripFences("```\nfeat: a\n\nbody line\n```")).toBe("feat: a\n\nbody line");
  });
});

describe("extractFirstCodeBlock", () => {
  it("提取带语言标注的第一个代码块", () => {
    expect(extractFirstCodeBlock("修好了：\n```ts\nconst a = 1;\n```")).toBe("const a = 1;");
  });

  it("提取无语言标注的代码块", () => {
    expect(extractFirstCodeBlock("```\nplain\n```")).toBe("plain");
  });

  it("多个代码块只取第一个", () => {
    const md = "先看这个：\n```js\nfirst();\n```\n再看：\n```js\nsecond();\n```";
    expect(extractFirstCodeBlock(md)).toBe("first();");
  });

  it("保留代码块内部换行、去尾部多余换行", () => {
    expect(extractFirstCodeBlock("```py\na = 1\n\nb = 2\n```")).toBe("a = 1\n\nb = 2");
  });

  it("无代码块 → undefined", () => {
    expect(extractFirstCodeBlock("就是一段普通文本，没有围栏。")).toBeUndefined();
  });
});
