import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
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
const FIREBASE_PROJECT_NUMBER = process.env.FIREBASE_PROJECT_NUMBER ?? null;
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS_URL = new URL(
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
);
const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY ?? "AIzaSyARehGFiYvbAqfqCiDyluBdqvw0jDUW5d8";

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

async function verifyFirebaseTokenWithJwks(
  token: string,
): Promise<TokenPayload | null> {
  try {
    const key = await getFirebaseKey(token);
    if (!key) {
      console.warn("Firebase token verification failed: missing signing key");
      return null;
    }

    const audiences = [FIREBASE_PROJECT_ID, FIREBASE_PROJECT_NUMBER].filter(
      (aud): aud is string => Boolean(aud),
    );
    const verifyOptions: Parameters<typeof jwtVerify>[2] = {
      issuer: FIREBASE_ISSUER,
      audience:
        audiences.length === 1
          ? audiences[0]
          : audiences.length > 1
            ? audiences
            : FIREBASE_PROJECT_ID,
    };

    const { payload } = await jwtVerify(token, key, verifyOptions);
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

async function verifyFirebaseTokenViaApi(
  token: string,
): Promise<TokenPayload | null> {
  if (!FIREBASE_API_KEY) {
    return null;
  }

  const payload = JSON.stringify({ idToken: token });
  const url = new URL(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
  );

  return new Promise((resolve) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf-8");
            if ((res.statusCode ?? 0) !== 200) {
              console.warn(
                `Firebase token lookup failed: ${res.statusCode} ${res.statusMessage} ${raw}`,
              );
              resolve(null);
              return;
            }

            const parsed = JSON.parse(raw) as {
              users?: Array<{ localId?: string; email?: string }>;
            };
            const user = parsed.users?.[0];
            if (!user?.localId) {
              console.warn("Firebase token lookup missing user record");
              resolve(null);
              return;
            }

            try {
              const decoded = decodeJwt(token);
              const result = TokenPayloadSchema.safeParse(decoded);
              if (result.success) {
                resolve(result.data);
                return;
              }
              const error = z.prettifyError(result.error);
              console.warn(
                "Fallback Firebase token validation failed strict parse",
                error,
              );
            } catch (error) {
              console.warn(
                "Failed to decode Firebase token during fallback verification",
                error,
              );
            }

            resolve({
              user_id: user.localId,
              email: user.email ?? undefined,
            });
          } catch (error) {
            console.warn("Failed to parse Firebase lookup response", error);
            resolve(null);
          }
        });
      },
    );

    request.on("error", (error) => {
      console.warn("Failed to verify Firebase token via API", error);
      resolve(null);
    });

    request.write(payload);
    request.end();
  });
}

async function verifyFirebaseToken(
  token: string,
): Promise<TokenPayload | null> {
  const claims = await verifyFirebaseTokenWithJwks(token);
  if (claims) {
    return claims;
  }
  const fallback = await verifyFirebaseTokenViaApi(token);
  if (!fallback) {
    console.warn("Firebase token verification failed after API fallback");
  }
  return fallback;
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
