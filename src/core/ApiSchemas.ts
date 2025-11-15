import { z } from "zod";
import { BigIntStringSchema, PlayerStatsSchema } from "./StatsSchemas";
import { Difficulty, GameMapType, GameMode, GameType } from "./game/Game";

export const RefreshResponseSchema = z.object({
  token: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const TokenPayloadSchema = z.object({
  user_id: z.string().optional(),
  email: z.string().optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  iss: z.string().optional(),
  aud: z.string().optional(),
  sub: z.string().optional(),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const DiscordUserSchema = z.object({
  id: z.string(),
  avatar: z.string().nullable(),
  username: z.string(),
  global_name: z.string().nullable(),
  discriminator: z.string(),
});
export type DiscordUser = z.infer<typeof DiscordUserSchema>;

export const UserMeResponseSchema = z.object({
  user: z.object({
    discord: DiscordUserSchema.optional(),
    email: z.string().optional(),
  }),
  player: z.object({
    publicId: z.string(),
    roles: z.string().array().optional(),
    flares: z.string().array().optional(),
  }),
});
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;

export const PlayerStatsLeafSchema = z.object({
  wins: BigIntStringSchema,
  losses: BigIntStringSchema,
  total: BigIntStringSchema,
  stats: PlayerStatsSchema,
});
export type PlayerStatsLeaf = z.infer<typeof PlayerStatsLeafSchema>;

export const PlayerStatsTreeSchema = z.partialRecord(
  z.enum(GameType),
  z.partialRecord(
    z.enum(GameMode),
    z.partialRecord(z.enum(Difficulty), PlayerStatsLeafSchema),
  ),
);
export type PlayerStatsTree = z.infer<typeof PlayerStatsTreeSchema>;

export const PlayerGameSchema = z.object({
  gameId: z.string(),
  start: z.iso.datetime(),
  mode: z.enum(GameMode),
  type: z.enum(GameType),
  map: z.enum(GameMapType),
  difficulty: z.enum(Difficulty),
  clientId: z.string().optional(),
});
export type PlayerGame = z.infer<typeof PlayerGameSchema>;

export const PlayerProfileSchema = z.object({
  createdAt: z.iso.datetime(),
  user: DiscordUserSchema.optional(),
  games: PlayerGameSchema.array(),
  stats: PlayerStatsTreeSchema,
});
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;
