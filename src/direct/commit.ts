import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import { getConfig } from "./config";
import { ensureAuth } from "./auth";
import { textMessage, supportsReasoningEffort } from "./xaiClient";
import { streamWithAuthFallback } from "./authed-stream";
import { stripFences } from "./text-utils";
import { pickRepoRootForPath } from "./git-repo";

const execFileAsync = promisify(execFile);

// vscode.git 扩展 API 的最小类型声明（只覆盖本模块用到的表面；完整定义见官方 git.d.ts）
interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: { value: string };
}
interface GitApi {
  readonly repositories: GitRepository[];
}
interface GitExtension {
  getAPI(version: 1): GitApi;
}

const COMMIT_PROMPT =
  "根据下面的 git diff 生成一条规范的 commit message（Conventional Commits 格式，" +
  "英文 subject ≤ 72 字符，必要时加 body）。只输出 commit message 本身，不要任何解释、不要代码块围栏。";

/**
 * SCM 面板一键生成提交信息：读 staged diff（为空则工作区 diff），
 * 调 Grok 生成 Conventional Commits 信息，直接填入 Git 输入框。
 */
export async function generateCommitMessage(secrets: vscode.SecretStorage): Promise<void> {
  const repo = await pickGitRepo();
  if (!repo) {
    vscode.window.showWarningMessage("Grok Coder：未找到 Git 仓库。");
    return;
  }
  const auth = await ensureAuth(secrets);
  if (!auth) {
    return;
  }

  const cwd: string = repo.rootUri.fsPath;
  let diff: string;
  try {
    diff = await getDiff(cwd);
  } catch (e) {
    vscode.window.showWarningMessage(`Grok Coder：${(e as Error).message}`);
    return;
  }

  const cfg = getConfig();

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.SourceControl, title: "Grok 正在生成提交信息…" },
    async () => {
      let message = "";
      try {
        for await (const ev of streamWithAuthFallback(secrets, cfg.baseUrl, {
          model: cfg.model,
          instructions: COMMIT_PROMPT,
          input: [textMessage("user", `git diff:\n${diff}`)],
          reasoning: supportsReasoningEffort(cfg.model) ? { effort: "low" } : undefined
        })) {
          if (ev.type === "text") {
            message += ev.text;
            repo.inputBox.value = message.trim(); // 流式回填，即写即见
          }
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Grok Coder 生成失败：${(e as Error).message}`);
        return;
      }
      repo.inputBox.value = stripFences(message);
    }
  );
}

function getGitApi(): GitApi | undefined {
  const gitExt = vscode.extensions.getExtension<GitExtension>("vscode.git");
  return gitExt?.exports?.getAPI?.(1);
}

/**
 * 选目标仓库：单仓直接用；多仓优先活动编辑器所属仓库（最内层），否则弹 QuickPick 让用户选。
 * 修复此前无条件取 repositories[0] 在多仓工作区可能生成错仓库提交信息的问题。
 */
async function pickGitRepo(): Promise<GitRepository | undefined> {
  const repos = getGitApi()?.repositories ?? [];
  if (repos.length <= 1) {
    return repos[0];
  }
  const activeFsPath = vscode.window.activeTextEditor?.document.uri.fsPath;
  const owningRoot = pickRepoRootForPath(
    repos.map((r) => r.rootUri.fsPath),
    activeFsPath
  );
  const owning = owningRoot ? repos.find((r) => r.rootUri.fsPath === owningRoot) : undefined;
  if (owning) {
    return owning;
  }
  const pick = await vscode.window.showQuickPick(
    repos.map((r) => ({
      label: vscode.workspace.asRelativePath(r.rootUri, false) || r.rootUri.fsPath,
      repo: r
    })),
    { title: "Grok Coder：选择要生成提交信息的 Git 仓库" }
  );
  return pick?.repo;
}

async function getDiff(cwd: string): Promise<string> {
  const run = async (args: string[]) => {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  };
  let diff = await run(["diff", "--staged"]);
  if (!diff.trim()) {
    diff = await run(["diff"]);
  }
  if (!diff.trim()) {
    throw new Error("git diff 为空：没有可提交的改动。");
  }
  const MAX = 80_000;
  return diff.length > MAX ? diff.slice(0, MAX) + "\n... (diff 过长已截断)" : diff;
}

