import cluster from "cluster";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameType } from "../core/game/Game";
import { GameConfig, GameID, GameInfo, ID } from "../core/Schemas";
import { generateID } from "../core/Util";
import { authRouter } from "./auth/AuthRouter";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";

const config = getServerConfigFromServer();
const playlist = new MapPlaylist();
const readyWorkers = new Set<number>();

const RANKED_QUEUE_COOLDOWN_MS = 3 * 60_000;
let lastRankedScheduledAt = 0;

const app = express();
const server = http.createServer(app);

const log = logger.child({ comp: "m" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.json());
app.use(
  express.static(path.join(__dirname, "../../static"), {
    maxAge: "1y", // Set max-age to 1 year for all static assets
    setHeaders: (res, path) => {
      // You can conditionally set different cache times based on file types
      if (path.endsWith(".html")) {
        // Set HTML files to no-cache to ensure Express doesn't send 304s
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        );
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        // Prevent conditional requests
        res.setHeader("ETag", "");
      } else if (path.match(/\.(js|css|svg)$/)) {
        // JS, CSS, SVG get long cache with immutable
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (path.match(/\.(bin|dat|exe|dll|so|dylib)$/)) {
        // Binary files also get long cache with immutable
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      // Other file types use the default maxAge setting
    },
  }),
);
app.set("trust proxy", 3);
app.use(
  rateLimit({
    windowMs: 1000, // 1 second
    max: 20, // 20 requests per IP per second
  }),
);

let publicLobbiesJsonStr = "";

const publicLobbyIDs: Map<GameID, GameType> = new Map();

// Start the master process
export async function startMaster() {
  if (!cluster.isPrimary) {
    throw new Error(
      "startMaster() should only be called in the primary process",
    );
  }

  log.info(`Primary ${process.pid} is running`);
  log.info(`Setting up ${config.numWorkers()} workers...`);

  // Fork workers
  for (let i = 0; i < config.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
    });

    log.info(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  cluster.on("message", (worker, message) => {
    if (message.type === "WORKER_READY") {
      const workerId = message.workerId;
      readyWorkers.add(workerId);
      log.info(
        `Worker ${workerId} is ready. (${readyWorkers.size}/${config.numWorkers()} ready)`,
      );
      // Start scheduling when all workers are ready
      if (readyWorkers.size === config.numWorkers()) {
        log.info("All workers ready, starting game scheduling");

        const ensureQueues = () =>
          fetchLobbies()
            .then((counts) => {
              if (counts[GameType.Public] === 0) {
                scheduleLobby(playlist.gameConfig()).catch((error) => {
                  log.error("Error scheduling public lobby:", error);
                });
              }

              if (counts[GameType.Ranked] === 0) {
                const now = Date.now();
                if (now - lastRankedScheduledAt >= RANKED_QUEUE_COOLDOWN_MS) {
                  lastRankedScheduledAt = now;
                  scheduleLobby(playlist.rankedGameConfig()).catch((error) => {
                    lastRankedScheduledAt = 0;
                    log.error("Error scheduling ranked lobby:", error);
                  });
                }
              }
            })
            .catch((error) => {
              log.error("Error fetching public lobbies:", error);
            });

        setInterval(ensureQueues, 100);
        ensureQueues();
      }
    }
  });

  // Handle worker crashes
  cluster.on("exit", (worker, code, signal) => {
    const workerId = (worker as any).process?.env?.WORKER_ID;
    if (!workerId) {
      log.error(`worker crashed could not find id`);
      return;
    }

    log.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );
    log.info(`Restarting worker ${workerId}...`);

    // Restart the worker with the same ID
    const newWorker = cluster.fork({
      WORKER_ID: workerId,
    });

    log.info(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });

  const PORT = Number(process.env.PORT ?? 3000);
  server.listen(PORT, "0.0.0.0", () => {
    log.info(`✅ Master HTTP server listening on port ${PORT}`);
  });
}

app.get("/api/env", async (req, res) => {
  const envConfig = {
    game_env: process.env.GAME_ENV,
  };
  if (!envConfig.game_env) return res.sendStatus(500);
  res.json(envConfig);
});

// Add lobbies endpoint to list public games for this worker
app.get("/api/public_lobbies", async (req, res) => {
  res.send(publicLobbiesJsonStr);
});

app.post("/api/kick_player/:gameID/:clientID", async (req, res) => {
  if (req.headers[config.adminHeader()] !== config.adminToken()) {
    res.status(401).send("Unauthorized");
    return;
  }

  const { gameID, clientID } = req.params;

  if (!ID.safeParse(gameID).success || !ID.safeParse(clientID).success) {
    res.sendStatus(400);
    return;
  }

  try {
    const response = await fetch(
      `http://localhost:${config.workerPort(gameID)}/api/kick_player/${gameID}/${clientID}`,
      {
        method: "POST",
        headers: {
          [config.adminHeader()]: config.adminToken(),
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to kick player: ${response.statusText}`);
    }

    res.status(200).send("Player kicked successfully");
  } catch (error) {
    log.error(`Error kicking player from game ${gameID}:`, error);
    res.status(500).send("Failed to kick player");
  }
});

type LobbyCounts = Record<GameType.Public | GameType.Ranked, number>;

async function fetchLobbies(): Promise<LobbyCounts> {
  const lobbyEntries = Array.from(publicLobbyIDs.entries());
  if (lobbyEntries.length === 0) {
    publicLobbiesJsonStr = JSON.stringify({ lobbies: [] });
    return {
      [GameType.Public]: 0,
      [GameType.Ranked]: 0,
    } satisfies LobbyCounts;
  }

  type LobbyResult = {
    gameID: GameID;
    gameType: GameType;
    info: GameInfo;
  } | null;

  const fetchPromises: Promise<LobbyResult>[] = [];

  for (const [gameID, gameType] of lobbyEntries) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const port = config.workerPort(gameID);
    const promise = fetch(`http://localhost:${port}/api/game/${gameID}`, {
      headers: { [config.adminHeader()]: config.adminToken() },
      signal: controller.signal,
    })
      .then((resp) => resp.json())
      .then((json) => {
        return {
          gameID,
          gameType,
          info: json as GameInfo,
        } satisfies LobbyResult;
      })
      .catch((error) => {
        log.error(`Error fetching game ${gameID}:`, error);
        publicLobbyIDs.delete(gameID);
        return null;
      });

    fetchPromises.push(promise);
  }

  const results = await Promise.all(fetchPromises);

  const lobbyInfos: GameInfo[] = [];
  const lobbyCounts: LobbyCounts = {
    [GameType.Public]: 0,
    [GameType.Ranked]: 0,
  } satisfies LobbyCounts;

  results.forEach((result) => {
    if (!result) {
      return;
    }

    const { gameID, gameType, info } = result;

    if (!info.gameConfig) {
      publicLobbyIDs.delete(gameID);
      return;
    }

    const msUntilStart = (info.msUntilStart ?? Date.now()) - Date.now();
    const numClients = info.clients?.length ?? info.numClients ?? 0;
    const maxPlayers = info.gameConfig.maxPlayers;

    if (msUntilStart <= 250) {
      publicLobbyIDs.delete(gameID);
      return;
    }

    if (maxPlayers !== undefined && numClients >= maxPlayers) {
      publicLobbyIDs.delete(gameID);
      return;
    }

    lobbyInfos.push({
      gameID: info.gameID,
      numClients,
      gameConfig: info.gameConfig,
      msUntilStart,
    });

    if (gameType === GameType.Public) {
      lobbyCounts[GameType.Public] += 1;
    } else if (gameType === GameType.Ranked) {
      lobbyCounts[GameType.Ranked] += 1;
    }
  });

  publicLobbiesJsonStr = JSON.stringify({
    lobbies: lobbyInfos,
  });

  return lobbyCounts;
}

async function scheduleLobby(gameConfig: GameConfig) {
  const gameType = gameConfig.gameType;

  if (gameType !== GameType.Public && gameType !== GameType.Ranked) {
    log.warn("Skipping scheduling unsupported lobby type", { gameType });
    return;
  }

  const gameID = generateID();
  publicLobbyIDs.set(gameID, gameType);

  const workerPort = config.workerPort(gameID);
  const workerPath = config.workerPath(gameID);

  try {
    const response = await fetch(
      `http://localhost:${workerPort}/api/create_game/${gameID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [config.adminHeader()]: config.adminToken(),
        },
        body: JSON.stringify(gameConfig),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to schedule game: ${response.statusText}`);
    }
  } catch (error) {
    log.error(`Failed to schedule game on worker ${workerPath}:`, error);
    publicLobbyIDs.delete(gameID);
    throw error;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SPA fallback route
app.get("*", function (req, res) {
  res.sendFile(path.join(__dirname, "../../static/index.html"));
});
