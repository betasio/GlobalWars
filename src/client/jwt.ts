import { decodeJwt } from "jose";
import { z } from "zod";
import {
  PlayerProfile,
  PlayerProfileSchema,
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";

function getAudience() {
  const { hostname } = new URL(window.location.href);
  const domainname = hostname.split(".").slice(-2).join(".");
  return domainname;
}

export function getApiBase() {
  const domainname = getAudience();

  if (domainname === "localhost") {
    const apiDomain = process?.env?.API_DOMAIN;
    if (apiDomain) {
      return `https://${apiDomain}`;
    }
    return localStorage.getItem("apiHost") ?? "http://localhost:8787";
  }

  return `https://api.${domainname}`;
}

function getToken(): string | null {
  // Check window hash
  const { hash } = window.location;
  if (hash.startsWith("#")) {
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get("token");
    if (token) {
      localStorage.setItem("token", token);
      params.delete("token");
      params.toString();
    }
    // Clean the URL
    history.replaceState(
      null,
      "",
      window.location.pathname +
        window.location.search +
        (params.size > 0 ? "#" + params.toString() : ""),
    );
  }

  // Check cookie
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith("token="))
    ?.trim()
    .substring(6);
  if (cookie !== undefined) {
    return cookie;
  }

  // Check local storage
  return localStorage.getItem("token");
}

async function clearToken() {
  localStorage.removeItem("token");
  __isLoggedIn = undefined;
  const config = await getServerConfigFromClient();
  const audience = config.jwtAudience();
  const isSecure = window.location.protocol === "https:";
  const secure = isSecure ? "; Secure" : "";
  document.cookie = `token=logged_out; Path=/; Max-Age=0; Domain=${audience}${secure}`;
}

async function storeToken(token: string) {
  localStorage.setItem("token", token);
  __isLoggedIn = undefined;
  const config = await getServerConfigFromClient();
  const audience = config.jwtAudience();
  const isSecure = window.location.protocol === "https:";
  const secure = isSecure ? "; Secure" : "";
  const maxAge = 30 * 24 * 60 * 60;
  document.cookie = `token=${token}; Path=/; Max-Age=${maxAge}; Domain=${audience}${secure}`;
}

let guestSessionPromise: Promise<void> | null = null;

export async function ensureGuestSession(): Promise<void> {
  if (getToken()) {
    return;
  }
  if (guestSessionPromise) {
    return guestSessionPromise;
  }
  guestSessionPromise = (async () => {
    const response = await fetch(`${getApiBase()}/login/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      guestSessionPromise = null;
      throw new Error("Failed to provision guest session");
    }
    const body = await response.json();
    const parsed = z
      .object({ token: z.string(), profile: UserMeResponseSchema })
      .safeParse(body);
    if (!parsed.success) {
      guestSessionPromise = null;
      throw new Error("Invalid guest session payload");
    }
    await storeToken(parsed.data.token);
    guestSessionPromise = null;
  })();
  return guestSessionPromise;
}

export async function loginWithGoogle(
  credential: string,
): Promise<UserMeResponse | null> {
  const response = await fetch(`${getApiBase()}/login/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) {
    console.error("Google login failed", await response.text());
    return null;
  }
  const body = await response.json();
  const parsed = z
    .object({ token: z.string(), profile: UserMeResponseSchema })
    .safeParse(body);
  if (!parsed.success) {
    console.error("Invalid Google login payload", parsed.error);
    return null;
  }
  await storeToken(parsed.data.token);
  return parsed.data.profile;
}

export async function tokenLogin(_token: string): Promise<string | null> {
  console.warn("Token login flow is not supported in this build.");
  return null;
}

export function getAuthHeader(): string {
  const token = getToken();
  if (!token) return "";
  return `Bearer ${token}`;
}

export async function logOut(allSessions: boolean = false) {
  const token = getToken();
  if (token === null) return;
  await clearToken();

  const response = await fetch(
    getApiBase() + (allSessions ? "/revoke" : "/logout"),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.ok === false) {
    console.error("Logout failed", response);
    return false;
  }
  return true;
}

export type IsLoggedInResponse =
  | { token: string; claims: TokenPayload }
  | false;
let __isLoggedIn: IsLoggedInResponse | undefined = undefined;
export function isLoggedIn(): IsLoggedInResponse {
  __isLoggedIn ??= _isLoggedIn();

  return __isLoggedIn;
}

export function getSessionClaims(): TokenPayload | null {
  const result = isLoggedIn();
  if (result === false) return null;
  return result.claims;
}

export function isGuestSession(): boolean {
  const claims = getSessionClaims();
  return !claims || claims.isGuest;
}
function _isLoggedIn(): IsLoggedInResponse {
  try {
    const token = getToken();
    if (!token) {
      // console.log("No token found");
      return false;
    }

    // Verify the JWT (requires browser support)
    // const jwks = createRemoteJWKSet(
    //   new URL(getApiBase() + "/.well-known/jwks.json"),
    // );
    // const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    //   issuer: getApiBase(),
    //   audience: getAudience(),
    // });

    // Decode the JWT
    const payload = decodeJwt(token);
    const { iss, aud, exp } = payload;

    if (iss !== getApiBase()) {
      // JWT was not issued by the correct server
      console.error(
        'unexpected "iss" claim value',
        // JSON.stringify(payload, null, 2),
      );
      logOut();
      return false;
    }
    const myAud = getAudience();
    if (myAud !== "localhost" && aud !== myAud) {
      // JWT was not issued for this website
      console.error(
        'unexpected "aud" claim value',
        // JSON.stringify(payload, null, 2),
      );
      logOut();
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    if (exp !== undefined && now >= exp) {
      // JWT expired
      console.error(
        'after "exp" claim value',
        // JSON.stringify(payload, null, 2),
      );
      logOut();
      return false;
    }
    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      // Invalid response
      console.error("Invalid payload", error);
      return false;
    }

    const claims = result.data;
    return { token, claims };
  } catch (e) {
    console.log(e);
    return false;
  }
}

export async function getUserMe(): Promise<UserMeResponse | false> {
  try {
    const token = getToken();
    if (!token) return false;

    // Get the user object
    const response = await fetch(getApiBase() + "/users/@me", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (response.status === 401) {
      clearToken();
      return false;
    }
    if (response.status !== 200) return false;
    const body = await response.json();
    const result = UserMeResponseSchema.safeParse(body);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid response", error);
      return false;
    }
    return result.data;
  } catch (e) {
    __isLoggedIn = false;
    return false;
  }
}

export async function fetchPlayerById(
  playerId: string,
): Promise<PlayerProfile | false> {
  try {
    const base = getApiBase();
    const token = getToken();
    if (!token) return false;
    const url = `${base}/player/${encodeURIComponent(playerId)}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchPlayerById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = PlayerProfileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchPlayerById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchPlayerById: request failed", err);
    return false;
  }
}
