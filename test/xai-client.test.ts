import { describe, it, expect } from "vitest";
import {
  supportsReasoningEffort,
  parseSseData,
  sanitizeInput,
  isAuthFallbackError,
  promptCacheKey,
  XaiError,
  XaiInputItem
} from "../src/direct/xaiClient";

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

describe("parseSseData", () => {
  it("文本增量 → text", () => {
    expect(parseSseData(JSON.stringify({ type: "response.output_text.delta", delta: "hi" }))).toEqual({
      kind: "text",
      text: "hi"
    });
  });

  it("空 delta → null", () => {
    expect(parseSseData(JSON.stringify({ type: "response.output_text.delta", delta: "" }))).toBeNull();
  });

  it("function_call 完成 → tool_call（含 call_id/name/arguments）", () => {
    const data = JSON.stringify({
      type: "response.output_item.done",
      item: { type: "function_call", call_id: "c1", name: "read_file", arguments: '{"path":"a"}' }
    });
    expect(parseSseData(data)).toEqual({
      kind: "tool_call",
      call: { callId: "c1", name: "read_file", arguments: '{"path":"a"}' }
    });
  });

  it("function_call 缺 arguments → 默认 {}", () => {
    const data = JSON.stringify({
      type: "response.output_item.done",
      item: { type: "function_call", id: "c2", name: "noop" }
    });
    const r = parseSseData(data);
    expect(r).toMatchObject({ kind: "tool_call", call: { callId: "c2", name: "noop", arguments: "{}" } });
  });

  it("function_call 无 name → null", () => {
    const data = JSON.stringify({
      type: "response.output_item.done",
      item: { type: "function_call", call_id: "c3" }
    });
    expect(parseSseData(data)).toBeNull();
  });

  it("引用 annotation → citation", () => {
    const data = JSON.stringify({
      type: "response.output_text.annotation.added",
      annotation: { url: "https://x.ai" }
    });
    expect(parseSseData(data)).toEqual({ kind: "citation", url: "https://x.ai" });
  });

  it("error / response.failed → error（取嵌套 message）", () => {
    expect(parseSseData(JSON.stringify({ type: "error", message: "boom" }))).toEqual({
      kind: "error",
      message: "boom"
    });
    expect(
      parseSseData(JSON.stringify({ type: "response.failed", response: { error: { message: "nope" } } }))
    ).toEqual({ kind: "error", message: "nope" });
  });

  it("[DONE] / 空 / 坏 JSON / 未知 type → null", () => {
    expect(parseSseData("[DONE]")).toBeNull();
    expect(parseSseData("")).toBeNull();
    expect(parseSseData("{not json")).toBeNull();
    expect(parseSseData(JSON.stringify({ type: "response.created" }))).toBeNull();
  });
});

describe("sanitizeInput", () => {
  it("剔除空文本内容项，整条内容为空则移除该消息", () => {
    const input: XaiInputItem[] = [
      { role: "user", content: [{ type: "input_text", text: "" }] },
      { role: "user", content: [{ type: "input_text", text: "hi" }] }
    ];
    expect(sanitizeInput(input)).toEqual([{ role: "user", content: [{ type: "input_text", text: "hi" }] }]);
  });

  it("保留图像内容项（无 text 字段也不被剔除）", () => {
    const input: XaiInputItem[] = [
      { role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }] }
    ];
    expect(sanitizeInput(input)).toHaveLength(1);
  });

  it("保留非 role 项（function_call / function_call_output）", () => {
    const input: XaiInputItem[] = [
      { type: "function_call", call_id: "c1", name: "f", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "ok" }
    ];
    expect(sanitizeInput(input)).toHaveLength(2);
  });
});

describe("promptCacheKey", () => {
  const u = (text: string): XaiInputItem => ({ role: "user", content: [{ type: "input_text", text }] });
  const a = (text: string): XaiInputItem => ({ role: "assistant", content: [{ type: "output_text", text }] });

  it("同 instructions + 同首条用户消息 → 同 key", () => {
    expect(promptCacheKey("sys", [u("hello")])).toBe(promptCacheKey("sys", [u("hello")]));
  });

  it("跨轮稳定：追加后续消息、首条不变 → 同 key", () => {
    const round1 = promptCacheKey("sys", [u("hello")]);
    const round2 = promptCacheKey("sys", [u("hello"), a("hi there"), u("follow up")]);
    expect(round2).toBe(round1);
  });

  it("不同首条用户消息 → 不同 key", () => {
    expect(promptCacheKey("sys", [u("hello")])).not.toBe(promptCacheKey("sys", [u("goodbye")]));
  });

  it("不同 instructions → 不同 key", () => {
    expect(promptCacheKey("sysA", [u("hello")])).not.toBe(promptCacheKey("sysB", [u("hello")]));
  });

  it("固定前缀，且不受空 instructions 影响而崩溃", () => {
    expect(promptCacheKey(undefined, [u("x")])).toMatch(/^grok-coder-/);
    expect(promptCacheKey(undefined, [])).toMatch(/^grok-coder-/);
  });
});

describe("isAuthFallbackError", () => {
  it("XaiError 403 → true", () => {
    expect(isAuthFallbackError(new XaiError("forbidden", 403))).toBe(true);
  });

  it("XaiError 其它状态 / 无状态 → false", () => {
    expect(isAuthFallbackError(new XaiError("server", 500))).toBe(false);
    expect(isAuthFallbackError(new XaiError("no status"))).toBe(false);
  });

  it("普通 Error / 非错误值 → false", () => {
    expect(isAuthFallbackError(new Error("403"))).toBe(false);
    expect(isAuthFallbackError("403")).toBe(false);
    expect(isAuthFallbackError(undefined)).toBe(false);
  });
});
