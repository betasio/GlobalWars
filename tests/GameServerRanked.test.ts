import { JWK } from "jose";
import type { Logger } from "winston";
import { GameEnv, ServerConfig } from "../src/core/configuration/Config";
import { GameMapType, GameMode, GameType } from "../src/core/game/Game";
import {
  RANKED_FOG_RULE,
  RANKED_MAP_POOL,
  RANKED_TURN_TIMERS,
  createRankedGameConfig,
} from "../src/core/game/GamePresets";
import { GameConfig } from "../src/core/Schemas";
import type { Client } from "../src/server/Client";
import { GamePhase, GameServer } from "../src/server/GameServer";

jest.mock("jose", () => ({
  base64url: {
    decode: (value: string) => Buffer.from(value, "base64url"),
  },
}));

const stubLogger: Logger = {
  child: () => stubLogger,
  log: () => stubLogger,
  add: () => stubLogger,
  remove: () => stubLogger,
  clear: () => stubLogger,
  close: () => stubLogger,
  emit: () => true,
  on: () => stubLogger,
  once: () => stubLogger,
  off: () => stubLogger,
  end: () => stubLogger,
  level: "info",
  levels: {},
  format: undefined as any,
  transports: [] as any,
  exceptions: undefined as any,
  rejections: undefined as any,
  exitOnError: false,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  profile: () => undefined,
  startTimer: () => ({ done: () => undefined }),
  query: () => Promise.resolve([] as any),
  stream: () => ({ on: () => undefined }) as any,
} as unknown as Logger;

const stubServerConfig: ServerConfig = {
  apiKey: () => "",
  allowedFlares: () => undefined,
  stripePublishableKey: () => "",
  cloudflareConfigPath: () => "",
  cloudflareCredsPath: () => "",
  domain: () => "",
  subdomain: () => "",
  cloudflareAccountId: () => "",
  cloudflareApiToken: () => "",
  jwtAudience: () => "",
  jwtIssuer: () => "",
  jwkPublicKey: async () => ({}) as JWK,
  otelEnabled: () => false,
  otelEndpoint: () => "",
  otelAuthHeader: () => "",
  turnIntervalMs: () => 100,
  gameCreationRate: () => 60_000,
  lobbyMaxPlayers: () => RANKED_MAP_POOL.length,
  numWorkers: () => 1,
  workerIndex: () => 0,
  workerPath: () => "",
  workerPort: () => 0,
  workerPortByIndex: () => 0,
  env: () => GameEnv.Dev,
  adminToken: () => "",
  adminHeader: () => "",
  gitCommit: () => "",
  r2Bucket: () => "",
  r2Endpoint: () => "",
  r2AccessKey: () => "",
  r2SecretKey: () => "",
};

function createRankedServer(overrides: Partial<GameConfig> = {}) {
  const config = createRankedGameConfig({
    ...overrides,
    gameType: GameType.Ranked,
  });
  return new GameServer(
    "test",
    stubLogger,
    Date.now(),
    stubServerConfig,
    config,
  );
}

describe("GameServer ranked mode", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("applies preset fields on creation", () => {
    const server = createRankedServer();

    expect(server.gameConfig.gameType).toBe(GameType.Ranked);
    expect(server.gameConfig.mapPool).toEqual(RANKED_MAP_POOL);
    expect(server.gameConfig.turnTimers).toEqual(RANKED_TURN_TIMERS);
    expect(server.gameConfig.fogRule).toBe(RANKED_FOG_RULE);
    expect(server.gameConfig.disableNPCs).toBe(true);
    expect(server.gameConfig.bots).toBe(0);
    expect(server.gameConfig.infiniteGold).toBe(false);
    expect(server.gameConfig.infiniteTroops).toBe(false);
    expect(server.gameConfig.gameMode).toBe(GameMode.FFA);
  });

  it("reports the ranked queue deadline as msUntilStart", () => {
    jest.useFakeTimers();
    const startTime = new Date("2025-01-01T00:00:00Z");
    jest.setSystemTime(startTime);

    const server = createRankedServer();

    const info = server.gameInfo();
    expect(info.msUntilStart).toBe(
      startTime.getTime() + RANKED_TURN_TIMERS.queueSeconds * 1000,
    );

    const advanceMs = 15_000;
    jest.setSystemTime(startTime.getTime() + advanceMs);
    const updated = server.gameInfo();
    expect(updated.msUntilStart).toBe(
      startTime.getTime() + RANKED_TURN_TIMERS.queueSeconds * 1000,
    );
  });

  it("restricts configuration updates to the ranked preset", () => {
    const server = createRankedServer({ gameMap: GameMapType.World });

    server.updateGameConfig({ gameMap: GameMapType.Africa });
    expect(RANKED_MAP_POOL).toContain(server.gameConfig.gameMap);
    expect(server.gameConfig.gameMap).not.toBe(GameMapType.Africa);

    server.updateGameConfig({ gameMap: GameMapType.Europe });
    expect(server.gameConfig.gameMap).toBe(GameMapType.Europe);

    server.updateGameConfig({
      mapPool: [GameMapType.World, GameMapType.Europe, GameMapType.Africa],
    });
    expect(server.gameConfig.mapPool).toEqual([
      GameMapType.World,
      GameMapType.Europe,
    ]);
  });

  it("transitions through ranked queue and lobby phases", () => {
    jest.useFakeTimers();
    const startTime = new Date("2025-01-01T00:00:00Z");
    jest.setSystemTime(startTime);

    const server = createRankedServer();

    expect(server.phase()).toBe(GamePhase.RankedQueue);

    const placeholderClient = {} as unknown as Client;
    const maxPlayers = server.gameConfig.maxPlayers ?? 0;
    server.activeClients = Array.from(
      { length: maxPlayers },
      () => placeholderClient,
    );
    expect(server.phase()).toBe(GamePhase.Lobby);

    server.activeClients = [];
    jest.setSystemTime(
      startTime.getTime() + RANKED_TURN_TIMERS.queueSeconds * 1000 + 1_000,
    );
    expect(server.phase()).toBe(GamePhase.Lobby);

    (server as unknown as { _hasStarted: boolean })._hasStarted = true;
    expect(server.phase()).toBe(GamePhase.Active);

    (server as unknown as { lastPingUpdate: number }).lastPingUpdate =
      Date.now() - 25_000;
    jest.setSystemTime(Date.now() + 40_000);
    expect(server.phase()).toBe(GamePhase.Finished);
  });
});
