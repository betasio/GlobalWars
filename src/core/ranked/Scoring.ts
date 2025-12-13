import { GameMode } from "../game/Game";
import { Winner } from "../Schemas";
import { PlayerStats } from "../StatsSchemas";

export interface RankedPlayerContext {
  clientID: string;
  username?: string;
  persistentID?: string | null;
  stats?: PlayerStats;
}

export interface RankedDeltaBreakdown {
  placement: {
    position: number;
    totalPlayers: number;
    score: number;
    isWinner: boolean;
    reason: string;
  };
  performance: {
    conquests: number;
    gold: number;
    score: number;
    reason: string;
  };
  mode: {
    gameMode: GameMode;
    modifier: number;
    reason: string;
  };
  rawDelta: number;
  ratingDelta: number;
  reasons: string[];
}

export interface RankedResult extends RankedDeltaBreakdown {
  clientID: string;
  username?: string;
  persistentID?: string | null;
}

function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "bigint") return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePlacement(position: number, totalPlayers: number): number {
  if (totalPlayers <= 1) return 1;
  const clampedPosition = Math.max(1, Math.min(position, totalPlayers));
  return (totalPlayers - clampedPosition) / (totalPlayers - 1);
}

function calculatePlacement(
  players: RankedPlayerContext[],
  winner: Winner | undefined,
): Map<string, { placement: number; isWinner: boolean }> {
  const winnerIDs = new Set<string>(
    Array.isArray(winner) ? winner.slice(1).map(String) : [],
  );

  const participants = players.map((player) => {
    const killedAt = safeNumber(
      player.stats?.killedAt,
      Number.NEGATIVE_INFINITY,
    );
    const survived =
      winnerIDs.has(player.clientID) || player.stats?.killedAt === undefined;
    const eliminationTurn = survived ? Number.POSITIVE_INFINITY : killedAt;
    return {
      id: player.clientID,
      eliminationTurn,
      survived,
    };
  });

  participants.sort((a, b) => b.eliminationTurn - a.eliminationTurn);

  const placements = new Map<
    string,
    { placement: number; isWinner: boolean }
  >();
  let currentPlacement = 1;
  let previousTurn = participants[0]?.eliminationTurn ?? 0;

  for (let index = 0; index < participants.length; index++) {
    const participant = participants[index];
    if (participant.eliminationTurn !== previousTurn) {
      currentPlacement = index + 1;
      previousTurn = participant.eliminationTurn;
    }
    placements.set(participant.id, {
      placement: currentPlacement,
      isWinner: winnerIDs.has(participant.id),
    });
  }

  return placements;
}

export function computeRankedDeltaForPlayer(
  gameMode: GameMode,
  playerID: string,
  players: RankedPlayerContext[],
  winner: Winner | undefined,
): RankedResult {
  const placements = calculatePlacement(players, winner);
  const playerPlacement = placements.get(playerID);
  const totalPlayers = players.length || 1;

  const player = players.find((p) => p.clientID === playerID) ?? {
    clientID: playerID,
  };

  const conquests = safeNumber(player.stats?.conquests, 0);
  const goldEarned = Array.isArray(player.stats?.gold)
    ? safeNumber(player.stats?.gold?.[0], 0)
    : safeNumber(player.stats?.gold, 0);

  const placementScore = normalizePlacement(
    playerPlacement?.placement ?? totalPlayers,
    totalPlayers,
  );
  const performanceScore =
    Math.min(1, conquests / 12) * 0.6 + Math.min(1, goldEarned / 25000) * 0.4;
  const performanceBonus = 10 * performanceScore;

  const placementBonus =
    18 * placementScore + (playerPlacement?.isWinner ? 7 : 0);
  const baselinePenalty = (1 - placementScore) * 10;

  const modeModifier = gameMode === GameMode.Team ? 0.9 : 1.05;
  const rawDelta = placementBonus + performanceBonus - baselinePenalty;
  const ratingDelta = Math.max(
    -40,
    Math.min(40, Math.round(rawDelta * modeModifier)),
  );

  const reasons = [
    `Placement ${playerPlacement?.placement ?? totalPlayers}/${totalPlayers}`,
    `Performance via ${conquests} conquests and ${Math.round(goldEarned)} gold`,
    `${gameMode} mode modifier ${modeModifier.toFixed(2)}x`,
  ];

  return {
    clientID: player.clientID,
    username: player.username,
    persistentID: player.persistentID,
    placement: {
      position: playerPlacement?.placement ?? totalPlayers,
      totalPlayers,
      score: Math.round(placementBonus - baselinePenalty),
      isWinner: Boolean(playerPlacement?.isWinner),
      reason: reasons[0],
    },
    performance: {
      conquests,
      gold: goldEarned,
      score: Math.round(performanceBonus),
      reason: reasons[1],
    },
    mode: {
      gameMode,
      modifier: modeModifier,
      reason: reasons[2],
    },
    rawDelta,
    ratingDelta,
    reasons,
  };
}

export function computeRankedResultsForGame(
  gameMode: GameMode,
  players: RankedPlayerContext[],
  winner: Winner | undefined,
): RankedResult[] {
  return players.map((player) =>
    computeRankedDeltaForPlayer(gameMode, player.clientID, players, winner),
  );
}
