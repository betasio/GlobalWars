import { RANK_TIERS } from "../../core/Ranks";
import { RankedLeaderboards } from "../firebaseAuth";

const midpointForTier = (min: number, max?: number) => {
  if (typeof max !== "number") {
    return min + 100;
  }
  return Math.round(min + (max - min) / 2);
};

export const RANKED_LEADERBOARD_SEED: RankedLeaderboards = {
  players: RANK_TIERS.map((tier, index) => {
    const rankPoints = midpointForTier(tier.minRating, tier.maxRating);
    return {
      uid: `seed-player-${tier.id}`,
      username: `${tier.name} Player`,
      clanName: index % 2 === 0 ? `Clan ${index + 1}` : null,
      clanNickname: index % 2 === 0 ? `C${index + 1}` : null,
      rankPoints,
      totalRankPoints: rankPoints,
      rating: rankPoints,
      wins: Math.max(1, index + 1),
      losses: Math.floor(index / 2),
      games: Math.max(1, (index + 1) * 2),
      tier,
      position: index + 1,
    };
  }),
  clans: RANK_TIERS.map((tier, index) => {
    const rankPoints = midpointForTier(tier.minRating, tier.maxRating) * 3;
    return {
      id: `seed-clan-${tier.id}`,
      name: `${tier.name} Alliance`,
      nickname: `${tier.name.slice(0, 3).toUpperCase()}`,
      memberCount: 10 + index,
      rankPoints,
      totalRankPoints: rankPoints,
      rating: rankPoints,
      wins: Math.max(2, (index + 1) * 2),
      losses: index,
      games: Math.max(2, (index + 1) * 3),
      tier,
      position: index + 1,
    };
  }),
  fetchedAt: new Date(0),
};
