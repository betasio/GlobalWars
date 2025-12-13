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
    maxRating: 499,
    logo: "/images/ranks/bronze.svg",
  },
  {
    id: "silver",
    name: "Silver",
    minRating: 500,
    maxRating: 999,
    logo: "/images/ranks/silver.svg",
  },
  {
    id: "gold",
    name: "Gold",
    minRating: 1000,
    maxRating: 1499,
    logo: "/images/ranks/gold.svg",
  },
  {
    id: "platinum",
    name: "Platinum",
    minRating: 1500,
    maxRating: 1999,
    logo: "/images/ranks/platinum.svg",
  },
  {
    id: "diamond",
    name: "Diamond",
    minRating: 2000,
    maxRating: 2499,
    logo: "/images/ranks/diamond.svg",
  },
  {
    id: "champion",
    name: "Champion",
    minRating: 2500,
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
