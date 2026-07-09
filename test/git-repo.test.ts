import { describe, it, expect } from "vitest";
import { pickRepoRootForPath, isPathInside } from "../src/direct/git-repo";

describe("isPathInside", () => {
  it("自身或子路径 → true", () => {
    expect(isPathInside("/a/b", "/a/b")).toBe(true);
    expect(isPathInside("/a/b/c.ts", "/a/b")).toBe(true);
  });

  it("相似前缀但非目录边界 / 无关路径 → false", () => {
    expect(isPathInside("/a/bc/x", "/a/b")).toBe(false);
    expect(isPathInside("/x/y", "/a/b")).toBe(false);
  });

  it("Windows 反斜杠路径", () => {
    expect(isPathInside("C:\\repo\\src\\a.ts", "C:\\repo")).toBe(true);
    expect(isPathInside("C:\\other\\a.ts", "C:\\repo")).toBe(false);
  });
});

describe("pickRepoRootForPath", () => {
  const roots = ["/work/app", "/work/app/packages/api", "/work/lib"];

  it("选最内层仓库（最长匹配前缀，适配嵌套）", () => {
    expect(pickRepoRootForPath(roots, "/work/app/packages/api/src/x.ts")).toBe(
      "/work/app/packages/api"
    );
  });

  it("外层文件选外层仓库", () => {
    expect(pickRepoRootForPath(roots, "/work/app/src/x.ts")).toBe("/work/app");
  });

  it("无活动文件 → undefined（回退 QuickPick）", () => {
    expect(pickRepoRootForPath(roots, undefined)).toBeUndefined();
  });

  it("不属于任何仓库 → undefined", () => {
    expect(pickRepoRootForPath(roots, "/tmp/z.ts")).toBeUndefined();
  });
});
