import fs from "fs";
import path from "path";
import {
  computeRankChange,
  getRankForRating,
  RANK_TIERS,
} from "../../src/core/Ranks";

describe("Ranks", () => {
  test("getRankForRating clamps to valid tiers", () => {
    expect(getRankForRating(-50).id).toBe("bronze");
    expect(getRankForRating(0).id).toBe("bronze");
    expect(getRankForRating(750).id).toBe("silver");
    expect(getRankForRating(2600).id).toBe("champion");
  });

  test("computeRankChange detects promotions and demotions across tier boundaries", () => {
    const promotion = computeRankChange(1490, 20);
    expect(promotion.previousTier.id).toBe("gold");
    expect(promotion.newTier.id).toBe("platinum");
    expect(promotion.promoted).toBe(true);
    expect(promotion.demoted).toBe(false);

    const demotion = computeRankChange(1500, -200);
    expect(demotion.previousTier.id).toBe("platinum");
    expect(demotion.newTier.id).toBe("gold");
    expect(demotion.promoted).toBe(false);
    expect(demotion.demoted).toBe(true);

    const sameTier = computeRankChange(1600, -50);
    expect(sameTier.previousTier.id).toBe("platinum");
    expect(sameTier.newTier.id).toBe("platinum");
    expect(sameTier.promoted).toBe(false);
    expect(sameTier.demoted).toBe(false);
  });

  test("rank tier assets are available for demos/storybooks", () => {
    const resourcesDir = path.join(__dirname, "..", "..", "resources");

    for (const tier of RANK_TIERS) {
      const logoPath = path.join(resourcesDir, tier.logo.replace(/^\//, ""));
      expect(fs.existsSync(logoPath)).toBe(true);
    }
  });
});
