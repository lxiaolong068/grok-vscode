# Subagents over ACP

> **Status: research-only / deferred.** The card code exists and is unit-tested
> (`isSubagentToolCall`/`subagentLabel` in `webview-helpers.js`, `addSubagentCard`
> in `chat.js`, the live-suite guard), but grok 0.2.x does **not** emit a
> `spawn_subagent` ACP tool — it backgrounds a process and reads it via
> `get_command_or_subagent_output` — so the card rarely fires. It was dropped from
> the README/UI as a shipped feature in v1.4.3; treat this doc as the investigation
> log, not a description of a live surface.

Bundled-docs theory confirmed against **grok 0.2.33** (CLI docs at
`~/.grok/docs/user-guide/16-subagents.md`, cross-checked with `grok --help`:
`--agents <JSON>`, `--best-of-n`). **Live wire shape captured against the
native-Windows build `grok` 0.2.3** (`research/win-subagent-probe.cjs` + the
`subagent` live test in `scripts/live-tests.cjs`) — and it does **not** match the
docs. See [§ Ground truth](#ground-truth-native-windows-02x) below.

## Summary

Subagents are **independent child sessions that run in parallel**, each with its
own context window; the parent delegates work and gets a summary back. They're
**enabled by default**. The bundled docs say the main agent delegates by calling a
**`spawn_subagent`** tool with a **`subagent_type`** parameter selecting the
child's role — but that tool is **not what the native-Windows 0.2.x build actually
emits over ACP** (next section). We keep `spawn_subagent` detection as
forward-compat for builds that do emit it.

## Ground truth (native-Windows 0.2.x)

The live `grok` 0.2.3 build has **no `spawn_subagent` / `subagent_type` tool over
ACP**. A delegation is a pair of ordinary tool calls:

1. **`run_terminal_command`** with `rawInput.variant: "Bash"`,
   `is_background: true`, content text `"Spawn background subagent to
   investigate…"`, and a `[bg]`-prefixed title (`"Background task t1 started"`).
   *This is the delegation* — the child runs as a backgrounded shell task.
2. **`get_command_or_subagent_output`** with `rawInput.variant: "TaskOutput"`,
   `task_id: "t1"`, title `"Get task output: t1"` — the parent **polls** the
   background task's output. *This is a reader, not a delegation.*

The trap: the poller's name contains the substring **"subagent"**, so a naive
`/subagent/` match false-fires a card on the output reader. The classifier
explicitly excludes it (see below). The live suite's `subagent` test asserts the
poller is **NOT** carded (`misfired.length === 0`) and that a real delegation is
detected via the background spawn + poll pair.

## `spawn_subagent` (forward-compat / other builds)

| Field | Notes |
|---|---|
| tool name | `spawn_subagent` |
| `subagent_type` | child role — built-ins below; project/user agents can add or shadow types |
| (other rawInput) | the task prompt for the child |

### Built-in `subagent_type` values

| Type | Description |
|---|---|
| `general-purpose` | Default. Full-capability agent for any task. |
| `explore` | Research agent — searches/reads/greps/runs shell, **no file edits**. |
| `plan` | Planning agent — explores and produces a structured plan, **no edits**. |

### Agents vs Personas (context, not needed for the card)

- **Agents** configure a whole session (model, tools, prompt, skills). Defined as
  `.md` files in `.grok/agents/` or `~/.grok/agents/`, or via `--agents <JSON>`.
- **Personas** are behavioral overlays applied to a subagent during resolution
  (tone/format/focus). Defined in `config.toml` `[subagents.personas]` or
  `.grok/personas/*.toml`. A persona can declare `default_isolation = "worktree"`
  — this is where grok's **git-worktree** isolation ties in.

Disable subagents with `GROK_SUBAGENTS=0` or `[subagents] enabled = false`.

## How the extension handles it

- `isSubagentToolCall(call)` / `subagentLabel(call)` (pure, in
  `media/webview-helpers.js`):
  - match the forward-compat `spawn_subagent` shape (by name and by
    `rawInput.subagent_type`), plus broad fallbacks for relabeled titles / renames;
  - **also card the native-build delegation** — a backgrounded `run_terminal_command`
    (`rawInput.is_background:true`, or a `[bg]`-prefixed title). This is grok 0.2.x's
    actual subagent mechanism, so without it the card never fires on the native build.
    A *foreground* command (`is_background:false`/absent) is left in the tool group;
  - **explicitly exclude the `get_command_or_subagent_output` poller** — an
    early-return on names ending in `output` or starting with `getcommand`, so the
    "subagent"-in-the-name reader never cards (its `is_background` is unset anyway);
  - degrade gracefully (no match → existing tool-group behavior). The label is the
    `subagent_type` (e.g. "general-purpose"), else the backgrounded command
    (truncated), else a generic "Subagent" / "background task".
- `media/chat.js` renders a distinct **Subagent: \<type\>** card
  (`addSubagentCard`); `media/chat.css` `.subagent-card`.

## Still open

The **nested inspector** is still TODO: correlate each child's tool calls under
its parent card. On native-Windows the correlation key is the background
`task_id` (`"t1"`) shared between the spawn `run_terminal_command` and the
`get_command_or_subagent_output` polls — so a future inspector can group the
poll output under the spawn card by `task_id`. Today's card is a flat labeled
marker; the live suite's `subagent` test guards the two invariants we rely on
(real delegation detected, poller not carded).
