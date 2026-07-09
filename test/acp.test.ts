import { describe, it, expect, vi } from "vitest";
import { AcpClient, buildGrokAgentArgs } from "../src/acp";

// Unit tests for AcpClient internals that don't need a real subprocess. We
// stand up the client with a fake writable proc and drive `request`/`onLine`
// directly.
function clientWithFakeProc(): { client: AcpClient; written: string[] } {
  const client = new AcpClient({ cliPath: "x", cwd: "/", log: () => {} });
  const written: string[] = [];
  (client as any).proc = {
    killed: false,
    stdin: { writable: true, write: (s: string) => written.push(s) },
  };
  return { client, written };
}

describe("AcpClient.request timer lifecycle", () => {
  it("clears the per-request timeout when the response arrives (no leaked timer)", async () => {
    vi.useFakeTimers();
    try {
      const { client } = clientWithFakeProc();
      const before = vi.getTimerCount();

      const p = (client as any).request("session/set_mode", { modeId: "plan" }); // id = 1
      expect(vi.getTimerCount()).toBe(before + 1); // timeout armed

      (client as any).onLine(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
      await p;

      expect(vi.getTimerCount()).toBe(before); // timeout cleared on response
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AcpClient default model startup", () => {
  it("skips a stale default model that is not in the CLI's available model list", async () => {
    const { client, written } = clientWithFakeProc();

    const p = client.newSession("grok-build");
    expect(JSON.parse(written[0])).toMatchObject({
      id: 1,
      method: "session/new",
    });

    (client as any).onLine(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        sessionId: "s1",
        models: {
          currentModelId: "grok-4.5",
          availableModels: [{ modelId: "grok-4.5", name: "Grok 4.5" }],
        },
      },
    }));

    await p;
    expect(written).toHaveLength(1);
    expect(client.currentModelId).toBe("grok-4.5");
  });
});

// #3/#4 (thanks @shugav for the crash report): the startup crash was the bogus
// `max` value, not reasoningEffort itself — grok accepts none|minimal|low|medium|
// high|xhigh, and the flag must precede the `stdio` subcommand.
describe("buildGrokAgentArgs", () => {
  it("starts ACP sessions with the stdio subcommand when no effort is set", () => {
    expect(buildGrokAgentArgs()).toEqual(["agent", "stdio"]);
  });

  it("forwards a valid effort as --reasoning-effort before the stdio subcommand", () => {
    expect(buildGrokAgentArgs("high")).toEqual(["agent", "--reasoning-effort", "high", "stdio"]);
    expect(buildGrokAgentArgs("none")).toEqual(["agent", "--reasoning-effort", "none", "stdio"]);
    expect(buildGrokAgentArgs("xhigh")).toEqual(["agent", "--reasoning-effort", "xhigh", "stdio"]);
  });
});
