import { createRemoteJWKSet, jwtVerify } from "jose";
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

const firebaseJwks = createRemoteJWKSet(FIREBASE_JWKS_URL);

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
    const { payload } = await jwtVerify(token, firebaseJwks, {
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
