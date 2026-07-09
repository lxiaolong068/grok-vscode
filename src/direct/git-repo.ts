/**
 * 多仓库工作区的选仓辅助（纯函数，不 import vscode，便于测试）。
 */

/** child 是否在 parent 目录内（含自身），兼容 / 与 \\ 分隔符，避免 `/a/bc` 误配 `/a/b`。 */
export function isPathInside(child: string, parent: string): boolean {
  if (child === parent) {
    return true;
  }
  const sep = parent.includes('\\') ? '\\' : '/';
  const base = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(base);
}

/**
 * 在多个仓库根中选出活动文件所属的最内层仓库根（最长匹配前缀，适配嵌套仓库/子模块）。
 * 无活动文件或无匹配返回 undefined（调用方回退到 QuickPick）。
 */
export function pickRepoRootForPath(
  rootFsPaths: string[],
  activeFsPath: string | undefined
): string | undefined {
  if (!activeFsPath) {
    return undefined;
  }
  return rootFsPaths
    .filter((root) => isPathInside(activeFsPath, root))
    .sort((a, b) => b.length - a.length)[0];
}
