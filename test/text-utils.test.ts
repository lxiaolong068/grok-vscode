import { describe, it, expect } from "vitest";
import { stripFences } from "../src/direct/text-utils";

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
