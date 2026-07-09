import * as vscode from "vscode";

/**
 * 状态栏指示器（上游 roadmap 未实现项）：显示 Grok Build 当前默认模型与推理强度，
 * 点击弹出快捷菜单（打开侧边栏 / 选模型 / 管理直连账号）。
 */
export function createStatusBar(context: vscode.ExtensionContext): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  item.command = "grokCoder.statusBarMenu";

  const update = () => {
    const cfg = vscode.workspace.getConfiguration("grok");
    const enabled = vscode.workspace
      .getConfiguration("grokCoder")
      .get<boolean>("statusBar.enabled", true);
    if (!enabled) {
      item.hide();
      return;
    }
    const model = cfg.get<string>("defaultModel") || "grok-build";
    const effort = cfg.get<string>("defaultEffort") || "default";
    item.text = `$(rocket) ${shortModel(model)} · ${effort}`;
    item.tooltip = new vscode.MarkdownString(
      `**Grok Coder**\n\n模型：\`${model}\`\n\n推理强度：\`${effort}\`\n\n点击打开快捷菜单`
    );
    item.show();
  };

  const menuCommand = vscode.commands.registerCommand("grokCoder.statusBarMenu", async () => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(layout-sidebar-left) 打开 Grok 侧边栏", id: "open" },
        { label: "$(chip) 选择模型", id: "model" },
        { label: "$(gear) 打开 Grok 设置", id: "settings" },
        { label: "$(account) 管理直连账号 / API Key", id: "manage" }
      ],
      { title: "Grok Coder" }
    );
    switch (pick?.id) {
      case "open":
        return vscode.commands.executeCommand("grok.open");
      case "model":
        return vscode.commands.executeCommand("grok.pickModel");
      case "settings":
        return vscode.commands.executeCommand("workbench.action.openSettings", "grok");
      case "manage":
        return vscode.commands.executeCommand("grokCoder.manage");
    }
  });

  const cfgListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("grok") || e.affectsConfiguration("grokCoder")) {
      update();
    }
  });

  update();
  context.subscriptions.push(item, menuCommand, cfgListener);
  return item;
}

function shortModel(id: string): string {
  return id.replace(/^grok-/, "").slice(0, 20) || id;
}
