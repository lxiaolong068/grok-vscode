/** Compact status-bar label. Known IDs get a short friendly name; others strip the `grok-` prefix. */
export function shortModel(id: string): string {
  if (id === "grok-4.5") return "Grok 4.5";
  if (id === "grok-composer-2.5-fast") return "Composer 2.5";
  if (id === "grok-build") return "Grok Build";
  return id.replace(/^grok-/, "").slice(0, 20) || id;
}
