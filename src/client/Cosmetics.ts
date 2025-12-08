import { UserMeResponse } from "../core/ApiSchemas";
import {
  ColorPalette,
  Cosmetics,
  CosmeticsSchema,
  Pattern,
} from "../core/CosmeticSchemas";
import { getApiBase, getAuthHeader } from "./jwt";
import { getPersistentID } from "./Main";

export async function handlePurchase(
  pattern: Pattern,
  colorPalette: ColorPalette | null,
) {
  if (pattern.product === null) {
    alert("This pattern is not available for purchase.");
    return;
  }

  const response = await fetch(
    `${getApiBase()}/stripe/create-checkout-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: getAuthHeader(),
        "X-Persistent-Id": getPersistentID(),
      },
      body: JSON.stringify({
        priceId: pattern.product.priceId,
        hostname: window.location.origin,
        colorPaletteName: colorPalette?.name,
      }),
    },
  );

  if (!response.ok) {
    console.error(
      `Error purchasing pattern:${response.status} ${response.statusText}`,
    );
    if (response.status === 401) {
      alert("You are not logged in. Please log in to purchase a pattern.");
    } else {
      alert("Something went wrong. Please try again later.");
    }
    return;
  }

  const { url } = await response.json();

  // Redirect to Stripe checkout
  window.location.href = url;
}

export async function fetchCosmetics(): Promise<Cosmetics | null> {
  try {
    const response = await fetch(
      `${window.location.origin}/cosmetics/cosmetics.json`,
    );
    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      return null;
    }
    const raw = await response.json();

    // Normalize legacy cosmetics data into the current schema shape so the
    // client can still render patterns provided as bare metadata entries.
    const patterns: Record<string, Pattern> = {};
    for (const [patternData, meta] of Object.entries(raw.patterns ?? {})) {
      const rawName =
        typeof meta === "object" && meta !== null && "name" in meta
          ? (meta as { name?: unknown }).name
          : null;
      const safeName =
        typeof rawName === "string"
          ? rawName
              .replace(/[^a-z0-9_]/gi, "_")
              .toLowerCase()
              .slice(0, 32)
          : "pattern";

      patterns[patternData] = {
        name: safeName,
        pattern: patternData,
        colorPalettes: [],
        affiliateCode: null,
        product: null,
      } as Pattern;
    }

    const normalized = CosmeticsSchema.safeParse({
      colorPalettes: raw.colorPalettes,
      patterns,
      flag: raw.flag,
    });

    if (!normalized.success) {
      console.error(`Invalid cosmetics: ${normalized.error.message}`);
      return null;
    }

    return normalized.data;
  } catch (error) {
    console.error("Error getting cosmetics:", error);
    return null;
  }
}

export function patternRelationship(
  pattern: Pattern,
  colorPalette: { name: string; isArchived?: boolean } | null,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
  if (flares.includes("pattern:*")) {
    return "owned";
  }

  if (colorPalette === null) {
    // For backwards compatibility only show non-colored patterns if they are owned.
    if (flares.includes(`pattern:${pattern.name}`)) {
      return "owned";
    }
    return "blocked";
  }

  const requiredFlare = `pattern:${pattern.name}:${colorPalette.name}`;

  if (flares.includes(requiredFlare)) {
    return "owned";
  }

  if (pattern.product === null) {
    // We don't own it and it's not for sale, so don't show it.
    return "blocked";
  }

  if (colorPalette?.isArchived) {
    // We don't own the color palette, and it's archived, so don't show it.
    return "blocked";
  }

  if (affiliateCode !== pattern.affiliateCode) {
    // Pattern is for sale, but it's not the right store to show it on.
    return "blocked";
  }

  // Patterns is for sale, and it's the right store to show it on.
  return "purchasable";
}
