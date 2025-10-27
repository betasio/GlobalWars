import { createSecretKey, randomUUID } from "crypto";
import { OAuth2Client } from "google-auth-library";
import { SignJWT, jwtVerify } from "jose";
import {
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
} from "../../core/ApiSchemas";
import { uuidToBase64url } from "../../core/Base64";
import { ServerConfig } from "../../core/configuration/Config";
import { UsernameSchema } from "../../core/Schemas";

export type SessionProvider = "guest" | "google";

export interface SessionDetails {
  persistentId: string;
  username: string;
  provider: SessionProvider;
  email?: string;
  roles?: string[];
  flares?: string[];
  ttlSeconds: number;
}

export interface SessionResult {
  token: string;
  claims: TokenPayload;
}

export function sanitizeUsername(
  candidate: string | undefined,
  fallback: string,
) {
  if (!candidate) return fallback;
  const trimmed = candidate.trim().slice(0, 24);
  const parsed = UsernameSchema.safeParse(trimmed);
  if (parsed.success) {
    return parsed.data;
  }
  return fallback;
}

export function generateGuestName(): string {
  const id = randomUUID().split("-")[0].toUpperCase();
  return `Guest-${id}`;
}

function getSecret(config: ServerConfig) {
  return createSecretKey(Buffer.from(config.authJwtSecret(), "utf8"));
}

export async function issueSessionToken(
  config: ServerConfig,
  details: SessionDetails,
): Promise<SessionResult> {
  const secret = getSecret(config);
  const now = Math.floor(Date.now() / 1000);
  const jti = randomUUID();
  const jwt = await new SignJWT({
    username: details.username,
    provider: details.provider,
    isGuest: details.provider === "guest",
    roles: details.roles ?? [],
    flares: details.flares ?? [],
    email: details.email,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setJti(jti)
    .setIssuer(config.jwtIssuer())
    .setAudience(config.jwtAudience())
    .setIssuedAt(now)
    .setExpirationTime(`${details.ttlSeconds}s`)
    .setSubject(uuidToBase64url(details.persistentId))
    .sign(secret);

  const { payload } = await jwtVerify(jwt, secret, {
    algorithms: ["HS256"],
    issuer: config.jwtIssuer(),
    audience: config.jwtAudience(),
  });
  const result = TokenPayloadSchema.safeParse(payload);
  if (!result.success) {
    throw new Error("Failed to parse signed session payload");
  }
  return { token: jwt, claims: result.data };
}

export function claimsToUserResponse(claims: TokenPayload): UserMeResponse {
  return {
    user: {
      email: claims.email,
    },
    player: {
      publicId: claims.sub,
      username: claims.username,
      roles: claims.roles ?? [],
      flares: claims.flares ?? [],
    },
  };
}

let googleClient: OAuth2Client | null = null;

export function getGoogleClient(config: ServerConfig): OAuth2Client {
  if (googleClient) return googleClient;
  const clientId = config.googleClientId();
  if (!clientId) {
    throw new Error(
      "GOOGLE_CLIENT_ID is required to enable Google authentication",
    );
  }
  googleClient = new OAuth2Client(clientId);
  return googleClient;
}

export interface GoogleCredentialResult {
  sub: string;
  email?: string;
  name?: string;
}

export async function verifyGoogleCredential(
  config: ServerConfig,
  credential: string,
): Promise<GoogleCredentialResult> {
  const client = getGoogleClient(config);
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: config.googleClientId(),
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new Error("Google credential missing subject");
  }
  return {
    sub: payload.sub,
    email: payload.email ?? undefined,
    name: payload.name ?? undefined,
  };
}
