import type { GameConfig, TurnTimerConfig } from "../Schemas";
import {
  Difficulty,
  FogRule,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "./Game";

export const RANKED_MAP_POOL: readonly GameMapType[] = [
  GameMapType.World,
  GameMapType.Europe,
  GameMapType.Asia,
  GameMapType.NorthAmerica,
  GameMapType.SouthAmerica,
  GameMapType.Pangaea,
];

export const RANKED_TURN_TIMERS: TurnTimerConfig = {
  queueSeconds: 60,
  lobbySeconds: 30,
  turnSeconds: 45,
};

export const RANKED_FOG_RULE = FogRule.Persistent;

export const RANKED_MAX_PLAYERS = 40;

export function pickRankedMap(
  pool: readonly GameMapType[] = RANKED_MAP_POOL,
): GameMapType {
  if (pool.length === 0) {
    throw new Error("Ranked map pool cannot be empty");
  }
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

export function createRankedGameConfig(
  overrides: Partial<GameConfig> = {},
): GameConfig {
  const pool =
    overrides.mapPool && overrides.mapPool.length > 0
      ? overrides.mapPool
      : [...RANKED_MAP_POOL];
  const chosenMap =
    overrides.gameMap && pool.includes(overrides.gameMap)
      ? overrides.gameMap
      : pickRankedMap(pool);

  return {
    donateGold: false,
    donateTroops: false,
    gameMap: chosenMap,
    maxPlayers: overrides.maxPlayers ?? RANKED_MAX_PLAYERS,
    gameType: GameType.Ranked,
    gameMapSize: overrides.gameMapSize ?? GameMapSize.Normal,
    difficulty: overrides.difficulty ?? Difficulty.Medium,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    disableNPCs: true,
    gameMode: GameMode.FFA,
    playerTeams: undefined,
    bots: 0,
    disabledUnits: overrides.disabledUnits ?? [],
    mapPool: [...pool],
    turnTimers: { ...RANKED_TURN_TIMERS },
    fogRule: RANKED_FOG_RULE,
  } satisfies GameConfig;
}
