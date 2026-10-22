// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
import { describe, expect, it } from "vitest";
import { createTokenProvider } from "../examples/with-auth/token-provider.js";

function fakeKeycloak(tokens: { access_token: string; expires_in: number }[] | { error: string }) {
  let calls = 0;
  const bodies: string[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    const i = calls++;
    if ("error" in tokens) return new Response(JSON.stringify({ error: "invalid_grant", error_description: tokens.error }), { status: 401 });
    return new Response(JSON.stringify(tokens[Math.min(i, tokens.length - 1)]), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, get calls() { return calls; }, bodies };
}

const base = { realmUrl: "http://kc/realms/r", clientId: "c", username: "alice", password: "p" };

describe("token provider", () => {
  it("logs in once and reuses the token until shortly before it expires", async () => {
    const kc = fakeKeycloak([{ access_token: "t1", expires_in: 300 }, { access_token: "t2", expires_in: 300 }]);
    let now = 0;
    const get = createTokenProvider({ ...base, fetch: kc.fetch, now: () => now });
    expect(await get()).toEqual({ authorization: "Bearer t1" });
    now = 200_000; // 200 s later, still 100 s left
    expect(await get()).toEqual({ authorization: "Bearer t1" });
    expect(kc.calls).toBe(1);
    now = 275_000; // inside the 30 s renewal window
    expect(await get()).toEqual({ authorization: "Bearer t2" });
    expect(kc.calls).toBe(2);
  });
  it("sends the password grant for the configured user", async () => {
    const kc = fakeKeycloak([{ access_token: "t", expires_in: 60 }]);
    await createTokenProvider({ ...base, fetch: kc.fetch })();
    expect(kc.bodies[0]).toContain("grant_type=password");
    expect(kc.bodies[0]).toContain("username=alice");
  });
  it("shares one login between concurrent callers", async () => {
    const kc = fakeKeycloak([{ access_token: "t1", expires_in: 300 }]);
    const get = createTokenProvider({ ...base, fetch: kc.fetch });
    const all = await Promise.all([get(), get(), get()]);
    expect(all.every((h) => h.authorization === "Bearer t1")).toBe(true);
    expect(kc.calls).toBe(1);
  });
  it("explains a failed login", async () => {
    const get = createTokenProvider({ ...base, fetch: fakeKeycloak({ error: "Invalid user credentials" }).fetch });
    await expect(get()).rejects.toThrow(/Could not get a token for alice: Invalid user credentials/);
  });
});
