export interface RankTier {
  id: string;
  name: string;
  minRating: number;
  maxRating?: number;
  logo: string;
}

export const RANK_TIERS: RankTier[] = [
  {
    id: "bronze",
    name: "Bronze",
    minRating: 0,
    maxRating: 200,
    logo: "/images/ranks/bronze.svg",
  },
  {
    id: "silver",
    name: "Silver",
    minRating: 201,
    maxRating: 400,
    logo: "/images/ranks/silver.svg",
  },
  {
    id: "gold",
    name: "Gold",
    minRating: 401,
    maxRating: 700,
    logo: "/images/ranks/gold.svg",
  },
  {
    id: "platinum",
    name: "Platinum",
    minRating: 701,
    maxRating: 1000,
    logo: "/images/ranks/platinum.svg",
  },
  {
    id: "diamond",
    name: "Diamond",
    minRating: 1001,
    maxRating: 1500,
    logo: "/images/ranks/diamond.svg",
  },
  {
    id: "champion",
    name: "Champion",
    minRating: 1501,
    logo: "/images/ranks/champion.svg",
  },
];

export function getRankForRating(rating: number): RankTier {
  const safeRating = Number.isFinite(rating) ? rating : 0;
  const matchingTier = RANK_TIERS.find((tier) => {
    const aboveMin = safeRating >= tier.minRating;
    const belowMax =
      tier.maxRating === undefined || safeRating <= tier.maxRating;
    return aboveMin && belowMax;
  });
  return matchingTier ?? RANK_TIERS[0];
}

export interface RankChange {
  previousRating: number;
  newRating: number;
  delta: number;
  previousTier: RankTier;
  newTier: RankTier;
  promoted: boolean;
  demoted: boolean;
}

export function computeRankChange(
  previousRating: number,
  delta: number,
): RankChange {
  const safePrevious = Math.max(0, Math.floor(previousRating));
  const newRating = Math.max(0, safePrevious + delta);
  const previousTier = getRankForRating(safePrevious);
  const newTier = getRankForRating(newRating);

  return {
    previousRating: safePrevious,
    newRating,
    delta,
    previousTier,
    newTier,
    promoted: newTier.minRating > previousTier.minRating,
    demoted:
      newTier.minRating < previousTier.minRating &&
      newRating < previousTier.minRating,
  };
}

export function formatRankBand(tier: RankTier): string {
  if (tier.maxRating === undefined) {
    return `${tier.minRating}+ pts`;
  }
  return `${tier.minRating} - ${tier.maxRating} pts`;
}
