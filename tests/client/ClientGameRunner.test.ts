import {
  ensureValidTeamSetup,
  TooFewTeamsError,
} from "../../src/client/teamSetupValidation";
import { Config } from "../../src/core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Trios,
} from "../../src/core/game/Game";
import { TerrainMapData } from "../../src/core/game/TerrainMapLoader";
import { GameConfig } from "../../src/core/Schemas";

const terrainData: TerrainMapData = {
  nations: [],
  gameMap: {} as any,
  miniGameMap: {} as any,
};

function makeConfig(overrides: Partial<GameConfig> = {}): Config {
  const baseConfig: GameConfig = {
    gameMap: GameMapType.World,
    difficulty: Difficulty.Easy,
    donateGold: true,
    donateTroops: true,
    gameType: GameType.Public,
    gameMode: GameMode.Team,
    gameMapSize: GameMapSize.Normal,
    disableNPCs: true,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    maxPlayers: 48,
    disabledUnits: [],
    playerTeams: Trios,
    ...overrides,
  };

  return {
    gameConfig: () => baseConfig,
    playerTeams: () => baseConfig.playerTeams ?? 0,
  } as Config;
}

describe("ensureValidTeamSetup", () => {
  it("allows lobbies that can form multiple teams when full", () => {
    const config = makeConfig({ maxPlayers: 48, playerTeams: Trios });

    expect(() =>
      ensureValidTeamSetup(
        config,
        terrainData,
        1,
        config.gameConfig().disableNPCs,
      ),
    ).not.toThrow();
  });

  it("rejects configurations that can only ever form a single team", () => {
    const config = makeConfig({ maxPlayers: 1, playerTeams: Trios });

    expect(() =>
      ensureValidTeamSetup(
        config,
        terrainData,
        1,
        config.gameConfig().disableNPCs,
      ),
    ).toThrow(TooFewTeamsError);
  });
});
