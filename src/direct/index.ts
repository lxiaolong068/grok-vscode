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
import { createStatusBar } from "./statusbar";

export function activateDirect(context: vscode.ExtensionContext): void {
  const provider = new GrokChatProvider(context.secrets);
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider("xai-grok", provider),
    createGrokParticipant(context),
    createStatusBar(context),

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
