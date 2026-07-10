import { describe, it, expect } from "vitest";
import { shortModel } from "../src/direct/status-label";

describe("shortModel (status bar label)", () => {
  it("uses friendly names for known models", () => {
    expect(shortModel("grok-4.5")).toBe("Grok 4.5");
    expect(shortModel("grok-composer-2.5-fast")).toBe("Composer 2.5");
    expect(shortModel("grok-build")).toBe("Grok Build");
  });

  it("strips the grok- prefix for unknown ids", () => {
    expect(shortModel("grok-mystery-model")).toBe("mystery-model");
    expect(shortModel("plain-id")).toBe("plain-id");
  });
});
