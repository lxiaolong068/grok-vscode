import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import { getConfig } from "./config";
import { ensureAuth } from "./auth";
import { XaiClient, textMessage } from "./xaiClient";

const execFileAsync = promisify(execFile);

const COMMIT_PROMPT =
  "根据下面的 git diff 生成一条规范的 commit message（Conventional Commits 格式，" +
  "英文 subject ≤ 72 字符，必要时加 body）。只输出 commit message 本身，不要任何解释、不要代码块围栏。";

/**
 * SCM 面板一键生成提交信息：读 staged diff（为空则工作区 diff），
 * 调 Grok 生成 Conventional Commits 信息，直接填入 Git 输入框。
 */
export async function generateCommitMessage(secrets: vscode.SecretStorage): Promise<void> {
  const repo = getGitRepo();
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
  const client = new XaiClient(cfg.baseUrl, auth.token);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.SourceControl, title: "Grok 正在生成提交信息…" },
    async () => {
      let message = "";
      try {
        for await (const ev of client.stream({
          model: cfg.model,
          instructions: COMMIT_PROMPT,
          input: [textMessage("user", `git diff:\n${diff}`)],
          reasoning: { effort: "low" }
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

function getGitRepo(): any | undefined {
  const gitExt = vscode.extensions.getExtension("vscode.git")?.exports;
  const api = gitExt?.getAPI?.(1);
  return api?.repositories?.[0];
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

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/, "")
    .trim();
}
