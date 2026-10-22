// Gets an access token for a demo user from Keycloak and keeps it until shortly before it expires.
// DEVELOPMENT ONLY: it uses the password grant with the demo realm's "grandstack-smoke" client. A real deployment
// would use a client-credentials grant or a user-delegated flow instead (see docs/adding-auth.md).
export interface TokenProviderOptions {
  /** Keycloak realm URL, for example http://localhost:8081/realms/grandstack */
  realmUrl: string;
  clientId: string;
  username: string;
  password: string;
  scope?: string;
  /** Renew this many seconds before the token expires. */
  skewSeconds?: number;
  /** For tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

export type TokenProvider = () => Promise<{ authorization: string }>;

export function createTokenProvider(options: TokenProviderOptions): TokenProvider {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const skewMs = (options.skewSeconds ?? 30) * 1000;
  let token: { value: string; expiresAt: number } | undefined;
  let inFlight: Promise<string> | undefined;

  async function login(): Promise<string> {
    const response = await doFetch(`${options.realmUrl}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", client_id: options.clientId, username: options.username, password: options.password, scope: options.scope ?? "openid" }),
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !body.access_token) {
      throw new Error(`Could not get a token for ${options.username}: ${body.error_description ?? `HTTP ${response.status}`}`);
    }
    token = { value: body.access_token, expiresAt: now() + (body.expires_in ?? 60) * 1000 };
    return token.value;
  }

  return async () => {
    if (!token || now() >= token.expiresAt - skewMs) {
      inFlight ??= login().finally(() => { inFlight = undefined; }); // concurrent calls share one login
      return { authorization: `Bearer ${await inFlight}` };
    }
    return { authorization: `Bearer ${token.value}` };
  };
}
