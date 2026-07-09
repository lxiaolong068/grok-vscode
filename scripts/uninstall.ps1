# Uninstall the Grok VS Code extension on Windows.
# Usage:  pwsh scripts\uninstall.ps1

$ErrorActionPreference = "Stop"

function Find-CodeCli {
    foreach ($name in @("code", "code-insiders")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    $fallback = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
    if (Test-Path $fallback) { return $fallback }
    $fallback = "$env:LOCALAPPDATA\Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd"
    if (Test-Path $fallback) { return $fallback }
    throw "Could not find VS Code CLI. Install VS Code or add 'code' to PATH."
}

$code = Find-CodeCli
Write-Host "Uninstalling brucelee.grok-coder via $code"
& $code --uninstall-extension brucelee.grok-coder
Write-Host ""
Write-Host "Done. Reload VS Code to drop the sidebar."
