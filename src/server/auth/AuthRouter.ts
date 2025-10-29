import { createHash, randomUUID } from "crypto";
import express from "express";
import type { JWK } from "jose";
import {
  SignJWT,
  base64url,
  createRemoteJWKSet,
  importJWK,
  jwtVerify,
} from "jose";
import { base64urlToUuid, uuidToBase64url } from "../../core/Base64";
import { getServerConfigFromServer } from "../../core/configuration/ConfigLoader";
import { logger } from "../Logger";

const config = getServerConfigFromServer();
const log = logger.child({ comp: "auth" });

type OAuthState = {
  redirectUri?: string;
};

type GoogleIdToken = {
  email?: string;
  email_verified?: boolean;
  picture?: string;
  name?: string;
  sub: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

const router = express.Router();

const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");
const googleJwks = createRemoteJWKSet(GOOGLE_JWKS_URL);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type SessionEntry = {
  email?: string;
  picture?: string;
  name?: string;
  expiresAt: number;
};

type SessionDetails = Pick<SessionEntry, "email" | "name" | "picture">;

const sessionStore = new Map<string, SessionEntry>();

let signingJwk: JWK | undefined;
let signingKeyPromise: ReturnType<typeof importJWK> | undefined;
let verificationKeyPromise: ReturnType<typeof importJWK> | undefined;

function ensureGoogleConfig(): GoogleConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth configuration missing. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }

  return { clientId, clientSecret };
}

function getSigningJwk(): JWK {
  if (!signingJwk) {
    const raw = process.env.JWT_PRIVATE_KEY ?? process.env.JWT_PRIVATE_JWK;
    if (!raw) {
      throw new Error("JWT private key not configured (JWT_PRIVATE_KEY).");
    }
    try {
      const parsed = JSON.parse(raw) as JWK;
      if (!parsed || typeof parsed !== "object" || parsed.kty !== "OKP") {
        throw new Error("JWT private key must be an EdDSA (OKP) JWK");
      }
      signingJwk = {
        use: "sig",
        alg: "EdDSA",
        ...parsed,
      };
    } catch (error) {
      throw new Error(
        `Unable to parse JWT private key: ${(error as Error).message}`,
      );
    }
  }
  return signingJwk;
}

function getPublicJwk(): JWK {
  const jwk = getSigningJwk();
  const { kty, crv, x, kid } = jwk as JWK & {
    kty: string;
    crv?: string;
    x?: string;
  };
  if (!x) {
    throw new Error("JWT private key is missing public component 'x'");
  }
  return {
    kty,
    crv,
    x,
    kid,
    use: "sig",
    alg: "EdDSA",
  } as JWK;
}

async function getSigningKey() {
  signingKeyPromise ??= importJWK(getSigningJwk(), "EdDSA");
  return signingKeyPromise;
}

async function getVerificationKey() {
  verificationKeyPromise ??= importJWK(getPublicJwk(), "EdDSA");
  return verificationKeyPromise;
}

function encodeState(state: OAuthState): string {
  return base64url.encode(Buffer.from(JSON.stringify(state), "utf8"));
}

function decodeState(stateParam: string | undefined): OAuthState | null {
  if (!stateParam) return null;
  try {
    const json = Buffer.from(base64url.decode(stateParam)).toString("utf8");
    return JSON.parse(json) as OAuthState;
  } catch (error) {
    log.warn("Failed to decode OAuth state", { error });
    return null;
  }
}

function deriveUserUuid(googleSub: string): string {
  const hash = createHash("sha256").update(googleSub).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));

  // Set UUID version (4) and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20),
  ].join("-");
}

function selectHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function coerceHeaderToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const token = value.split(",")[0]?.trim();
  return token ? token : undefined;
}

function getRequestOrigin(req: express.Request): URL {
  const forwardedProtoHeader = selectHeaderValue(
    req.headers["x-forwarded-proto"],
  );
  const protocol =
    coerceHeaderToken(forwardedProtoHeader)?.toLowerCase() ??
    req.protocol ??
    "http";

  const forwardedHostHeader = selectHeaderValue(
    req.headers["x-forwarded-host"],
  );
  const rawHost = forwardedHostHeader ?? selectHeaderValue(req.headers.host);
  const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;

  if (host) {
    try {
      return new URL(`${protocol}://${host}`);
    } catch (error) {
      log.warn("Failed to parse request host, falling back to issuer", {
        error,
        host,
        protocol,
      });
    }
  }

  return new URL(config.jwtIssuer());
}

function buildRedirectUri(req: express.Request): string {
  const origin = getRequestOrigin(req);
  const url = new URL("/login/google", origin);
  return url.toString();
}

function appendTokenToHash(urlString: string, token: string): string {
  let target: URL;
  try {
    target = new URL(urlString);
  } catch (error) {
    log.warn("Invalid redirect URI provided, falling back to issuer", {
      error,
      urlString,
    });
    target = new URL(config.jwtIssuer());
  }
  const params = new URLSearchParams(
    target.hash ? target.hash.replace(/^#/, "") : "",
  );
  params.set("token", token);
  const hashString = params.toString();
  target.hash = hashString ? `#${hashString}` : "";
  return target.toString();
}

function sanitizeRedirectUri(
  candidate: string | undefined,
  req: express.Request,
): string | undefined {
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    const audience = config.jwtAudience();
    const requestHost = getRequestOrigin(req).hostname;

    if (!audience) {
      return url.toString();
    }

    if (audience === "localhost") {
      if (url.hostname === "localhost") {
        return url.toString();
      }
      return undefined;
    }

    if (url.hostname === audience || url.hostname.endsWith(`.${audience}`)) {
      return url.toString();
    }

    if (
      url.hostname === requestHost ||
      url.hostname.endsWith(`.${requestHost}`)
    ) {
      return url.toString();
    }
  } catch (error) {
    log.warn("Discarding invalid redirect URI", { error, candidate });
  }
  return undefined;
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  google: GoogleConfig,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: google.clientId,
    client_secret: google.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const json = (await response.json()) as GoogleTokenResponse;

  if (!response.ok) {
    log.warn("Google token endpoint returned non-200", {
      status: response.status,
      body: json,
    });
  }

  return json;
}

async function issueJwt(subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer(config.jwtIssuer())
    .setAudience(config.jwtAudience())
    .setSubject(subject)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime("24h")
    .sign(await getSigningKey());
}

function buildCookie(token: string, redirectUrl: string): string {
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  const audience = config.jwtAudience();
  const redirect = new URL(redirectUrl);
  const secure = redirect.protocol === "https:";

  const parts = [
    `token=${token}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    "HttpOnly",
  ];

  if (secure) {
    parts.push("Secure");
  }

  if (audience && audience !== "localhost") {
    parts.push(`Domain=${audience}`);
  }

  return parts.join("; ");
}

function buildLogoutCookie(): string {
  const issuer = new URL(config.jwtIssuer());
  const audience = config.jwtAudience();
  const secure = issuer.protocol === "https:";
  const parts = ["token=", "Path=/", "Max-Age=0", "SameSite=Lax", "HttpOnly"];
  if (secure) {
    parts.push("Secure");
  }
  if (audience && audience !== "localhost") {
    parts.push(`Domain=${audience}`);
  }
  return parts.join("; ");
}

function storeUser(uuid: string, details: SessionDetails) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessionStore.set(uuid, {
    email: details.email,
    name: details.name,
    picture: details.picture,
    expiresAt,
  });
}

function getStoredUser(uuid: string): SessionEntry | undefined {
  const entry = sessionStore.get(uuid);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    sessionStore.delete(uuid);
    return undefined;
  }
  return entry;
}

function touchUser(uuid: string): SessionEntry | undefined {
  const entry = getStoredUser(uuid);
  if (!entry) {
    return undefined;
  }
  storeUser(uuid, {
    email: entry.email,
    name: entry.name,
    picture: entry.picture,
  });
  return sessionStore.get(uuid);
}

async function validateAppToken(
  token: string,
): Promise<{ uuid: string } | null> {
  try {
    const { payload } = await jwtVerify(token, await getVerificationKey(), {
      issuer: config.jwtIssuer(),
      audience: config.jwtAudience(),
    });
    const subject = typeof payload.sub === "string" ? payload.sub : null;
    if (!subject) {
      return null;
    }
    const uuid = base64urlToUuid(subject);
    if (!uuid) {
      return null;
    }
    return { uuid };
  } catch (error) {
    log.warn("Failed to validate application token", { error });
    return null;
  }
}

function getBearerToken(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const [scheme, value] = auth.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value;
}

router.get("/.well-known/jwks.json", (req, res) => {
  try {
    const jwk = getPublicJwk();
    res.json({ keys: [jwk] });
  } catch (error) {
    log.error("Failed to provide JWKS", { error });
    res.status(500).json({ error: "jwks_unavailable" });
  }
});

router.get("/login/google", async (req, res) => {
  try {
    const google = ensureGoogleConfig();
    const redirectUri = buildRedirectUri(req);
    const code =
      typeof req.query.code === "string" ? req.query.code : undefined;
    const rawRedirect =
      typeof req.query.redirect_uri === "string"
        ? req.query.redirect_uri
        : undefined;
    const sanitizedRedirect = sanitizeRedirectUri(rawRedirect, req);
    const stateParam =
      typeof req.query.state === "string" ? req.query.state : undefined;
    const state = decodeState(stateParam) ?? {};

    if (sanitizedRedirect) {
      state.redirectUri = sanitizedRedirect;
    }

    const oauthError =
      typeof req.query.error === "string" ? req.query.error : undefined;
    const oauthErrorDescription =
      typeof req.query.error_description === "string"
        ? req.query.error_description
        : undefined;

    if (oauthError) {
      log.warn("Google returned an OAuth error", {
        oauthError,
        oauthErrorDescription,
      });
      res.status(400).json({
        error: oauthError,
        error_description: oauthErrorDescription,
      });
      return;
    }

    if (!code) {
      if (!state.redirectUri) {
        res.status(400).json({ error: "missing_redirect_uri" });
        return;
      }

      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", google.clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "openid email profile");
      authUrl.searchParams.set("state", encodeState(state));
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("access_type", "offline");

      res.redirect(authUrl.toString());
      return;
    }

    const tokenResponse = await exchangeCode(code, redirectUri, google);
    if (tokenResponse.error) {
      log.warn("Google token exchange returned an error", tokenResponse);
      res.status(401).json({ error: tokenResponse.error });
      return;
    }
    if (!tokenResponse.id_token) {
      log.warn("Google token exchange failed", tokenResponse);
      res.status(401).json({ error: "google_oauth_failed" });
      return;
    }

    let claims: GoogleIdToken;
    try {
      const verification = await jwtVerify(tokenResponse.id_token, googleJwks, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: google.clientId,
      });
      claims = verification.payload as GoogleIdToken;
    } catch (error) {
      log.warn("Failed to verify Google ID token", { error });
      res.status(401).json({ error: "invalid_google_token" });
      return;
    }
    if (!claims?.sub) {
      res.status(401).json({ error: "invalid_google_token" });
      return;
    }
    if (!claims.email || claims.email_verified === false) {
      res.status(403).json({ error: "email_not_verified" });
      return;
    }

    const uuid = deriveUserUuid(claims.sub);
    const subject = uuidToBase64url(uuid);
    const jwt = await issueJwt(subject);

    storeUser(uuid, {
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
    });

    const targetRedirect =
      state.redirectUri ?? getRequestOrigin(req).toString();
    const finalRedirect = appendTokenToHash(targetRedirect, jwt);
    res.setHeader("Set-Cookie", buildCookie(jwt, finalRedirect));
    res.redirect(finalRedirect);
  } catch (error) {
    log.error("Google login failed", { error });
    res.status(500).json({ error: "google_login_failed" });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const validation = await validateAppToken(token);
    if (!validation) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    const profile = touchUser(validation.uuid);
    if (!profile) {
      res.status(401).json({ error: "session_not_found" });
      return;
    }

    const subject = uuidToBase64url(validation.uuid);
    const refreshedToken = await issueJwt(subject);
    res.setHeader(
      "Set-Cookie",
      buildCookie(refreshedToken, config.jwtIssuer()),
    );
    res.json({ token: refreshedToken });
  } catch (error) {
    log.error("Failed to refresh token", { error });
    res.status(500).json({ error: "refresh_failed" });
  }
});

async function handleLogout(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) {
    return;
  }
  const validation = await validateAppToken(token);
  if (!validation) {
    return;
  }
  sessionStore.delete(validation.uuid);
}

router.post("/logout", async (req, res) => {
  try {
    await handleLogout(req);
    res.setHeader("Set-Cookie", buildLogoutCookie());
    res.status(204).end();
  } catch (error) {
    log.error("Failed to logout", { error });
    res.status(500).json({ error: "logout_failed" });
  }
});

router.post("/revoke", async (req, res) => {
  try {
    await handleLogout(req);
    res.setHeader("Set-Cookie", buildLogoutCookie());
    res.status(204).end();
  } catch (error) {
    log.error("Failed to revoke sessions", { error });
    res.status(500).json({ error: "revoke_failed" });
  }
});

router.get("/users/@me", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const validation = await validateAppToken(token);
    if (!validation) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    const { uuid } = validation;
    const profile = getStoredUser(uuid);

    if (!profile) {
      res.status(401).json({ error: "session_not_found" });
      return;
    }

    res.json({
      user: {
        email: profile.email,
      },
      player: {
        publicId: uuid,
        roles: [],
        flares: [],
      },
    });
  } catch (error) {
    log.warn("Failed to fetch /users/@me", { error });
    res.status(401).json({ error: "unauthorized" });
  }
});

export const authRouter = router;
