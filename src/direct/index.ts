/**
 * Grok Coder 直连模块入口 —— 上游 (grok-build-vscode) 之外的差异化功能：
 *  1. BYOK Provider：grok-4.5 进入 VS Code 原生 Chat 模型选择器
 *  2. @grok 聊天参与者（/fix /explain /review /docs /search /commit）
 *  3. SCM 一键生成提交信息
 *  4. 状态栏指示器
 * 认证独立于 Grok Build CLI：Grok 账号 OAuth（订阅）或 xAI API Key。
 */
import * as vscode from "vscode";
import { GrokChatProvider } from "./provider";
import { createGrokParticipant } from "./participant";
import { clearApiKey, promptForApiKey } from "./config";
import * as oauth from "./oauth";
import { isLoggedIn } from "./auth";
import { generateCommitMessage } from "./commit";
import { createStatusBar, StatusSource } from "./statusbar";

export function activateDirect(
  context: vscode.ExtensionContext,
  statusSource?: StatusSource
): void {
  const provider = new GrokChatProvider(context.secrets);

  // BYOK provider 与 @grok 参与者依赖 Copilot Chat 体系的 vscode.lm / vscode.chat；
  // Cursor 等环境没有这些 API —— 探测存在性 + 各自 try/catch，某块缺席只禁用该块，
  // 绝不拖垮上游侧边栏（SCM 提交、状态栏、直连命令在所有环境都可用）。
  if (typeof (vscode as any).lm?.registerLanguageModelChatProvider === "function") {
    try {
      context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider("xai-grok", provider)
      );
    } catch (e) {
      console.warn("Grok Coder: 跳过 Chat 模型 provider 注册（当前环境不支持）:", e);
    }
  }
  if (typeof (vscode as any).chat?.createChatParticipant === "function") {
    try {
      context.subscriptions.push(createGrokParticipant(context));
    } catch (e) {
      console.warn("Grok Coder: 跳过 @grok 聊天参与者注册（当前环境不支持）:", e);
    }
  }

  context.subscriptions.push(
    createStatusBar(context, statusSource),

    vscode.commands.registerCommand("grokCoder.login", async () => {
      try {
        await oauth.login(context.secrets);
        vscode.window.showInformationMessage(
          "Grok Coder：已用 Grok 账号登录（SuperGrok / X Premium+ 订阅额度）。"
        );
        provider.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`Grok Coder 登录失败：${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand("grokCoder.logout", async () => {
      await oauth.logout(context.secrets);
      vscode.window.showInformationMessage("Grok Coder：已退出 Grok 账号。");
      provider.refresh();
    }),
    vscode.commands.registerCommand("grokCoder.setApiKey", async () => {
      await promptForApiKey(context.secrets);
      provider.refresh();
    }),
    vscode.commands.registerCommand("grokCoder.clearApiKey", async () => {
      await clearApiKey(context.secrets);
      provider.refresh();
    }),
    vscode.commands.registerCommand("grokCoder.generateCommitMessage", () =>
      generateCommitMessage(context.secrets)
    ),
    vscode.commands.registerCommand(
      "grokCoder.applyFix",
      async (arg: { uri: string; range: [number, number, number, number]; code: string }) => {
        const [sl, sc, el, ec] = arg.range;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(vscode.Uri.parse(arg.uri), new vscode.Range(sl, sc, el, ec), arg.code);
        const ok = await vscode.workspace.applyEdit(edit);
        vscode.window.setStatusBarMessage(
          ok ? "Grok Coder：已应用修复 ✓" : "Grok Coder：应用修复失败",
          3000
        );
      }
    ),
    vscode.commands.registerCommand("grokCoder.manage", async () => {
      const loggedIn = await isLoggedIn(context.secrets);
      const items: (vscode.QuickPickItem & { id: string })[] = [
        {
          label: loggedIn ? "$(sync) 重新登录 Grok 账号" : "$(account) 登录 Grok 账号",
          description: "SuperGrok / X Premium+ 订阅授权，无需 API Key",
          id: "login"
        }
      ];
      if (loggedIn) {
        items.push({ label: "$(sign-out) 退出 Grok 账号", id: "logout" });
      }
      items.push(
        { label: "$(key) 设置 / 更新 API Key（回退方案）", id: "setKey" },
        { label: "$(trash) 清除 API Key", id: "clearKey" },
        { label: "$(link-external) 打开 xAI 控制台", id: "console" }
      );
      const action = await vscode.window.showQuickPick(items, {
        title: "Grok Coder：账号与密钥管理（直连 API）"
      });
      switch (action?.id) {
        case "login":
          return vscode.commands.executeCommand("grokCoder.login");
        case "logout":
          return vscode.commands.executeCommand("grokCoder.logout");
        case "setKey":
          return vscode.commands.executeCommand("grokCoder.setApiKey");
        case "clearKey":
          return vscode.commands.executeCommand("grokCoder.clearApiKey");
        case "console":
          return vscode.env.openExternal(vscode.Uri.parse("https://console.x.ai"));
      }
    })
  );
}
