import type { Config } from "../core/configuration/Config";
import { Duos, GameMode, Quads, Trios } from "../core/game/Game";
import type { TerrainMapData } from "../core/game/TerrainMapLoader";
import type { TeamCountConfig } from "../core/Schemas";

export class TooFewTeamsError extends Error {
  constructor(public readonly teamCount: number) {
    super(`Too few teams: ${teamCount}`);
    this.name = "TooFewTeamsError";
  }
}

export function ensureValidTeamSetup(
  config: Config,
  terrainData: TerrainMapData,
  humanCount: number,
  disableNPCs: boolean,
): void {
  if (config.gameConfig().gameMode !== GameMode.Team) {
    return;
  }

  const npcCount = disableNPCs ? 0 : terrainData.nations.length;
  const actualPlayers = humanCount + npcCount;
  const configuredHumanCapacity = config.gameConfig().maxPlayers ?? humanCount;
  const configuredTotalPlayers = configuredHumanCapacity + npcCount;
  const totalPlayers = Math.max(actualPlayers, configuredTotalPlayers);
  const teamCount = resolveTeamCount(config.playerTeams(), totalPlayers);

  if (teamCount < 2) {
    throw new TooFewTeamsError(teamCount);
  }
}

function resolveTeamCount(
  teamConfig: TeamCountConfig,
  totalPlayers: number,
): number {
  if (typeof teamConfig === "number") {
    return teamConfig;
  }

  switch (teamConfig) {
    case Duos:
      return Math.ceil(totalPlayers / 2);
    case Trios:
      return Math.ceil(totalPlayers / 3);
    case Quads:
      return Math.ceil(totalPlayers / 4);
    default:
      throw new Error(`Unknown TeamCountConfig ${teamConfig}`);
  }
}
