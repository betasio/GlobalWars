import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import https from "node:https";
import { z } from "zod";
import {
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
} from "../core/ApiSchemas";
import { ServerConfig } from "../core/configuration/Config";
import { PersistentIdSchema } from "../core/Schemas";

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ?? "globalwars-75bcf";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS_URL = new URL(
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
);

type ImportedKey = Awaited<ReturnType<typeof importJWK>>;

const firebaseKeyCache = new Map<string, ImportedKey>();
let jwksRefresh: Promise<void> | null = null;

async function downloadFirebaseJwks(): Promise<void> {
  if (jwksRefresh) {
    await jwksRefresh;
    return;
  }

  jwksRefresh = new Promise<void>((resolve) => {
    https
      .get(FIREBASE_JWKS_URL, (res) => {
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          console.warn(
            `Failed to download Firebase JWKS: ${res.statusCode} ${res.statusMessage}`,
          );
          resolve();
          res.resume();
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", async () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf-8");
            const parsed = JSON.parse(raw) as {
              keys?: Array<Record<string, unknown>>;
            };
            if (!Array.isArray(parsed.keys)) {
              console.warn("Firebase JWKS payload missing keys array");
              return resolve();
            }

            await Promise.all(
              parsed.keys.map(async (jwk) => {
                const kid = typeof jwk.kid === "string" ? jwk.kid : undefined;
                if (!kid) {
                  return;
                }
                try {
                  const alg = typeof jwk.alg === "string" ? jwk.alg : undefined;
                  const key = await importJWK(
                    jwk as Parameters<typeof importJWK>[0],
                    alg ?? "RS256",
                  );
                  firebaseKeyCache.set(kid, key);
                } catch (error) {
                  console.warn("Failed to import Firebase JWK", error);
                }
              }),
            );
          } catch (error) {
            console.warn("Failed to parse Firebase JWKS", error);
          } finally {
            resolve();
          }
        });
      })
      .on("error", (error) => {
        console.warn("Failed to request Firebase JWKS", error);
        resolve();
      });
  });

  await jwksRefresh;
  jwksRefresh = null;
}

async function getFirebaseKey(token: string): Promise<ImportedKey | null> {
  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch (error) {
    console.warn("Failed to decode token header", error);
    return null;
  }

  const kid = header.kid;
  if (!kid) {
    console.warn("Firebase token missing kid");
    return null;
  }

  if (!firebaseKeyCache.has(kid)) {
    await downloadFirebaseJwks();
  }

  const cached = firebaseKeyCache.get(kid);
  if (cached) {
    return cached;
  }

  // If the key was not found, refresh once more in case of rotation.
  await downloadFirebaseJwks();
  return firebaseKeyCache.get(kid) ?? null;
}

type TokenVerificationResult =
  | {
      persistentId: string;
      claims: TokenPayload | null;
    }
  | false;

async function verifyFirebaseToken(
  token: string,
): Promise<TokenPayload | null> {
  try {
    const key = await getFirebaseKey(token);
    if (!key) {
      console.warn("Firebase token verification failed: missing signing key");
      return null;
    }

    const { payload } = await jwtVerify(token, key, {
      issuer: FIREBASE_ISSUER,
      audience: FIREBASE_PROJECT_ID,
    });
    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.warn("Error parsing Firebase token payload", error);
      return null;
    }
    return result.data;
  } catch (error) {
    console.warn("Firebase token verification failed", error);
    return null;
  }
}

export async function verifyClientToken(
  token: string,
  _config: ServerConfig,
): Promise<TokenVerificationResult> {
  if (PersistentIdSchema.safeParse(token).success) {
    return { persistentId: token, claims: null };
  }

  const claims = await verifyFirebaseToken(token);
  if (!claims) {
    return false;
  }

  const persistentId = claims.user_id ?? claims.sub;
  if (!persistentId) {
    return false;
  }

  return { persistentId, claims };
}

export async function getUserMe(
  token: string,
  _config: ServerConfig,
): Promise<UserMeResponse | false> {
  const claims = await verifyFirebaseToken(token);
  if (!claims) {
    return false;
  }

  const publicId = claims.user_id ?? claims.sub;
  if (!publicId) {
    return false;
  }

  return {
    user: {
      email: claims.email ?? undefined,
    },
    player: {
      publicId,
      roles: [],
      flares: [],
    },
  };
}
