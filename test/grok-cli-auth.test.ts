import { describe, it, expect } from "vitest";
import { extractGrokCliToken, XAI_OAUTH_CLIENT_ID } from "../src/direct/grok-cli-auth";

// auth.json 的真实结构：顶层 key = `${issuer}::${client_id}`，值含 key/refresh_token/expires_at 等。
const CID = XAI_OAUTH_CLIENT_ID;
const NOW = 1_700_000_000_000; // 固定 now，避免依赖 Date.now()
const future = new Date(NOW + 3_600_000).toISOString();
const past = new Date(NOW - 1_000).toISOString();

function authFile(overrides: Record<string, unknown> = {}) {
  return {
    [`https://auth.x.ai::${CID}`]: {
      key: "access-token-abc",
      refresh_token: "refresh-xyz",
      expires_at: future,
      oidc_client_id: CID,
      oidc_issuer: "https://auth.x.ai",
      auth_mode: "sso",
      ...overrides
    }
  };
}

describe("extractGrokCliToken", () => {
  it("returns the access token for a matching, unexpired entry", () => {
    expect(extractGrokCliToken(authFile(), NOW)).toBe("access-token-abc");
  });

  it("matches by composite key suffix even without oidc_client_id", () => {
    const parsed = {
      [`https://auth.x.ai::${CID}`]: { key: "tok", expires_at: future }
    };
    expect(extractGrokCliToken(parsed, NOW)).toBe("tok");
  });

  it("skips expired tokens (leaves refresh to the CLI)", () => {
    expect(extractGrokCliToken(authFile({ expires_at: past }), NOW)).toBeUndefined();
  });

  it("treats a token within the skew window as expired", () => {
    const almost = new Date(NOW + 30_000).toISOString(); // < 60s skew
    expect(extractGrokCliToken(authFile({ expires_at: almost }), NOW)).toBeUndefined();
  });

  it("ignores entries signed by a different client id", () => {
    const parsed = {
      "https://auth.x.ai::other-client": {
        key: "nope",
        expires_at: future,
        oidc_client_id: "other-client"
      }
    };
    expect(extractGrokCliToken(parsed, NOW)).toBeUndefined();
  });

  it("accepts an entry with no expires_at (treated as valid)", () => {
    expect(extractGrokCliToken(authFile({ expires_at: undefined }), NOW)).toBe(
      "access-token-abc"
    );
  });

  it("returns undefined for empty/garbage input", () => {
    expect(extractGrokCliToken(null, NOW)).toBeUndefined();
    expect(extractGrokCliToken({}, NOW)).toBeUndefined();
    expect(extractGrokCliToken("not-an-object", NOW)).toBeUndefined();
  });

  it("skips a matching entry that has no key field", () => {
    expect(extractGrokCliToken(authFile({ key: undefined }), NOW)).toBeUndefined();
  });
});
