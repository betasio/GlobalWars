import { createSecretKey } from "crypto";
import { jwtVerify } from "jose";
import { z } from "zod";
import { TokenPayload, TokenPayloadSchema } from "../core/ApiSchemas";
import { ServerConfig } from "../core/configuration/Config";
import { PersistentIdSchema } from "../core/Schemas";

type TokenVerificationResult =
  | {
      persistentId: string;
      claims: TokenPayload | null;
    }
  | false;

export async function verifyClientToken(
  token: string,
  config: ServerConfig,
): Promise<TokenVerificationResult> {
  if (PersistentIdSchema.safeParse(token).success) {
    return { persistentId: token, claims: null };
  }
  try {
    const issuer = config.jwtIssuer();
    const audience = config.jwtAudience();
    const secret = createSecretKey(Buffer.from(config.authJwtSecret(), "utf8"));
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer,
      audience,
    });
    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.warn("Error parsing token payload", error);
      return false;
    }
    const claims = result.data;
    const persistentId = claims.sub;
    return { persistentId, claims };
  } catch (e) {
    return false;
  }
}
