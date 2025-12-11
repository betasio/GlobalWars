import { z } from "zod/v4";
import { Cosmetics, CosmeticsSchema } from "./CosmeticSchemas";

const LegacyCosmeticsSchema = z.object({
  patterns: z.record(
    z.string(),
    z.object({
      name: z.string(),
      role_group: z.string().optional(),
    }),
  ),
  flag: z
    .object({
      layers: z
        .record(
          z.string(),
          z.object({ name: z.string(), role_group: z.string().optional() }),
        )
        .optional(),
      color: z
        .record(
          z.string(),
          z.object({
            color: z.string(),
            name: z.string(),
            role_group: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  role_groups: z.record(z.string(), z.array(z.string())).optional(),
});

function sanitizePatternName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (normalized.length === 0) return "pattern";
  return normalized.slice(0, 32);
}

/**
 * Parses cosmetics data, accepting both the new schema and the legacy format
 * bundled under resources/cosmetics/cosmetics.json. If legacy data is detected
 * it is normalized into the modern schema so both the client and server can
 * consume it without validation errors.
 */
export function parseCosmetics(data: unknown): Cosmetics {
  const modern = CosmeticsSchema.safeParse(data);
  if (modern.success) {
    return modern.data;
  }

  const legacy = LegacyCosmeticsSchema.safeParse(data);
  if (!legacy.success) {
    throw new Error(`Invalid cosmetics data: ${legacy.error.message}`);
  }

  const flag = legacy.data.flag
    ? {
        layers: Object.fromEntries(
          Object.entries(legacy.data.flag.layers ?? {}).map(([key, value]) => [
            key,
            {
              name: value.name,
              flares: [],
            },
          ]),
        ),
        color: Object.fromEntries(
          Object.entries(legacy.data.flag.color ?? {}).map(([key, value]) => [
            key,
            {
              color: value.color,
              name: value.name,
              flares: [],
            },
          ]),
        ),
      }
    : undefined;

  const patterns = Object.fromEntries(
    Object.entries(legacy.data.patterns).map(([patternCode, patternInfo]) => [
      patternCode,
      {
        name: sanitizePatternName(patternInfo.name),
        pattern: patternCode,
        colorPalettes: [],
        affiliateCode: null,
        product: null,
      },
    ]),
  );

  const normalized: Cosmetics = {
    patterns,
    flag,
  };

  const normalizedResult = CosmeticsSchema.safeParse(normalized);
  if (!normalizedResult.success) {
    throw new Error(
      `Unable to normalize cosmetics data: ${normalizedResult.error.message}`,
    );
  }

  return normalizedResult.data;
}
