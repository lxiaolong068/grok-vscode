import { describe, it, expect } from "vitest";
import { supportsReasoningEffort } from "../src/direct/xaiClient";

describe("supportsReasoningEffort", () => {
  it("推理模型返回 true", () => {
    expect(supportsReasoningEffort("grok-4.5")).toBe(true);
    expect(supportsReasoningEffort("grok-4")).toBe(true);
    expect(supportsReasoningEffort("grok-build")).toBe(true);
  });

  it("grok-code-fast 系（非推理）返回 false", () => {
    expect(supportsReasoningEffort("grok-code-fast-1")).toBe(false);
    expect(supportsReasoningEffort("grok-code-fast")).toBe(false);
    expect(supportsReasoningEffort("grok-code")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(supportsReasoningEffort("Grok-Code-Fast-1")).toBe(false);
    expect(supportsReasoningEffort("GROK-4.5")).toBe(true);
  });
});
