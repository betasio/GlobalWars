import { decodeJwt } from "jose";
import { z } from "zod";
import {
  PlayerProfile,
  PlayerProfileSchema,
  RefreshResponseSchema,
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import {
  cachedSC,
  getServerConfigFromClient,
} from "../core/configuration/ConfigLoader";

function isIpv4(hostname: string): boolean {
  if (!/^\d+(?:\.\d+){3}$/.test(hostname)) {
    return false;
  }

  return hostname.split(".").every((segment) => {
    const value = Number(segment);
    return value >= 0 && value <= 255;
  });
}

function isIpv6(hostname: string): boolean {
  return hostname.includes(":");
}

function getEffectiveDomain(hostname: string): string {
  if (isIpv4(hostname) || isIpv6(hostname)) {
    return hostname;
  }

  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return hostname;
  }

  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  const isSecondLevelCcTld = last.length === 2 && secondLast.length <= 3;
  const keepCount = isSecondLevelCcTld ? 3 : 2;

  if (parts.length <= keepCount) {
    return hostname;
  }

  return parts.slice(-keepCount).join(".");
}

function getAudience() {
  const { hostname } = new URL(window.location.href);
  return getEffectiveDomain(hostname);
}

let resolvedApiBase: string | null = null;

export function getApiBase() {
  const storedHost = localStorage.getItem("apiHost");
  if (storedHost) {
    resolvedApiBase = storedHost;
    return resolvedApiBase;
  }

  if (resolvedApiBase) {
    return resolvedApiBase;
  }

  const { hostname, protocol } = new URL(window.location.href);
  const scheme = protocol === "https:" ? "https" : "http";
  const audience = getEffectiveDomain(hostname);

  if (cachedSC) {
    const issuer = cachedSC.jwtIssuer();
    const cachedAudience = cachedSC.jwtAudience();
    const isLocalCachedAudience = cachedAudience === "localhost";
    const isLocalLocation =
      audience === "localhost" || isIpv4(audience) || isIpv6(audience);

    if (!isLocalCachedAudience || isLocalLocation) {
      resolvedApiBase = issuer;
      return resolvedApiBase;
    }
    // Fall through to derive the API base from the current location when the
    // server configuration only contains localhost details but the site is
    // being served from a public hostname.
  }

  if (audience === "localhost") {
    const apiDomain = process?.env?.API_DOMAIN;
    if (apiDomain) {
      resolvedApiBase = apiDomain.startsWith("http")
        ? apiDomain
        : `https://${apiDomain}`;
      return resolvedApiBase;
    }
    resolvedApiBase = "http://localhost:8787";
    return resolvedApiBase;
  }

  if (isIpv4(audience) || isIpv6(audience)) {
    const apiDomain = process?.env?.API_DOMAIN;
    if (apiDomain) {
      resolvedApiBase = apiDomain.startsWith("http")
        ? apiDomain
        : `${scheme}://${apiDomain}`;
      return resolvedApiBase;
    }
    const apiPort = process?.env?.API_PORT;
    const portSegment = apiPort
      ? `:${apiPort}`
      : scheme === "https"
        ? ""
        : ":8787";
    resolvedApiBase = `${scheme}://${audience}${portSegment}`;
    return resolvedApiBase;
  }

  const origin = window.location.origin;
  resolvedApiBase = origin.startsWith("http")
    ? origin
    : `${scheme}://${hostname}`;
  return resolvedApiBase;
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
  __isLoggedIn = false;
  const config = await getServerConfigFromClient();
  const audience = config.jwtAudience();
  const isSecure = window.location.protocol === "https:";
  const secure = isSecure ? "; Secure" : "";
  document.cookie = `token=logged_out; Path=/; Max-Age=0; Domain=${audience}${secure}`;
}

export function discordLogin() {
  window.location.href = `${getApiBase()}/login/discord?redirect_uri=${window.location.href}`;
}

export function googleLogin() {
  const redirectUri = encodeURIComponent(window.location.href);
  window.location.href = `${getApiBase()}/login/google?redirect_uri=${redirectUri}`;
}

export async function tokenLogin(token: string): Promise<string | null> {
  const response = await fetch(
    `${getApiBase()}/login/token?login-token=${token}`,
  );
  if (response.status !== 200) {
    console.error("Token login failed", response);
    return null;
  }
  const json = await response.json();
  const { jwt, email } = json;
  const payload = decodeJwt(jwt);
  const result = TokenPayloadSchema.safeParse(payload);
  if (!result.success) {
    console.error("Invalid token", result.error, result.error.message);
    return null;
  }
  clearToken();
  localStorage.setItem("token", jwt);
  return email;
}

export function getAuthHeader(): string {
  const token = getToken();
  if (!token) return "";
  return `Bearer ${token}`;
}

export async function logOut(allSessions: boolean = false) {
  const token = getToken();
  if (token === null) return;
  clearToken();

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
    const { iss, aud, exp, iat } = payload;

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
    const refreshAge: number = 3 * 24 * 3600; // 3 days
    if (iat !== undefined && now >= iat + refreshAge) {
      console.log("Refreshing access token...");
      postRefresh().then((success) => {
        if (success) {
          console.log("Refreshed access token successfully.");
        } else {
          console.error("Failed to refresh access token.");
          // TODO: Update the UI to show logged out state
        }
      });
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

export async function postRefresh(): Promise<boolean> {
  try {
    const token = getToken();
    if (!token) return false;

    // Refresh the JWT
    const response = await fetch(getApiBase() + "/refresh", {
      method: "POST",
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
    const result = RefreshResponseSchema.safeParse(body);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid response", error);
      return false;
    }
    localStorage.setItem("token", result.data.token);
    return true;
  } catch (e) {
    __isLoggedIn = false;
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
