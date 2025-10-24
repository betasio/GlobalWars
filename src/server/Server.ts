import cluster from "cluster";
import * as dotenv from "dotenv";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { Cloudflare, TunnelConfig } from "./Cloudflare";
import { startMaster } from "./Master";
import { startWorker } from "./Worker";

const config = getServerConfigFromServer();

dotenv.config();

// Main entry point of the application
async function main() {
  // Check if this is the primary (master) process
  if (cluster.isPrimary) {
    if (config.env() !== GameEnv.Dev) {
      await setupTunnels();
    }
    console.log("Starting master process...");
    await startMaster();
  } else {
    // This is a worker process
    console.log("Starting worker process...");
    await startWorker();
  }
}

// Start the application
main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

async function setupTunnels() {
  if (!shouldEnableCloudflare()) {
    console.log("Skipping Cloudflare tunnel setup due to environment override");
    return;
  }

  const cloudflare = new Cloudflare(
    config.cloudflareAccountId(),
    config.cloudflareApiToken(),
    config.cloudflareConfigPath(),
    config.cloudflareCredsPath(),
  );

  const platformHint =
    process.env.CF_TUNNEL_PLATFORM ??
    process.env.PLATFORM ??
    process.env.GW_PLATFORM ??
    process.platform;
  const rootPort = parsePort(process.env.CF_TUNNEL_ROOT_PORT, 80);
  const workerPortBase = parsePort(
    process.env.CF_TUNNEL_WORKER_PORT_BASE,
    3001,
  );
  const extraArgs = parseExtraArgs(process.env.CF_TUNNEL_EXTRA_ARGS);
  const runtimeRetries = Number.parseInt(
    process.env.CF_TUNNEL_RUNTIME_RETRIES ?? "15",
    10,
  );
  const setupRetries = Math.max(
    1,
    Number.parseInt(process.env.CF_TUNNEL_SETUP_RETRIES ?? "3", 10),
  );
  const retryDelayMs = Math.max(
    1000,
    Number.parseInt(process.env.CF_TUNNEL_SETUP_DELAY_MS ?? "5000", 10),
  );

  const domainToService = new Map<string, string>().set(
    config.subdomain(),
    `http://localhost:${rootPort}`,
  );

  for (let i = 0; i < config.numWorkers(); i++) {
    domainToService.set(
      `w${i}-${config.subdomain()}`,
      `http://localhost:${workerPortBase + i}`,
    );
  }

  const skipProvision = parseBoolean(process.env.CF_TUNNEL_SKIP_PROVISION);
  let configProvisioned = false;

  for (let attempt = 1; attempt <= setupRetries; attempt++) {
    try {
      console.log(
        `Configuring Cloudflare tunnel (attempt ${attempt}/${setupRetries})`,
      );

      if (!skipProvision && !configProvisioned) {
        const alreadyExists = await cloudflare.configAlreadyExists();
        if (!alreadyExists) {
          await cloudflare.createTunnel({
            subdomain: config.subdomain(),
            domain: config.domain(),
            subdomainToService: domainToService,
          } as TunnelConfig);
          configProvisioned = true;
        } else {
          console.log(
            "Tunnel configuration already exists on disk, skipping provisioning",
          );
          configProvisioned = true;
        }
      } else if (skipProvision && attempt === 1) {
        console.log("CF_TUNNEL_SKIP_PROVISION detected, skipping provisioning");
      }

      await cloudflare.startCloudflared({
        binary: process.env.CF_TUNNEL_BIN,
        logLevel: process.env.CF_TUNNEL_LOGLEVEL,
        protocol: process.env.CF_TUNNEL_PROTOCOL,
        retries: Number.isFinite(runtimeRetries) ? runtimeRetries : undefined,
        extraArgs,
        platform: platformHint,
      });

      console.log("Cloudflare tunnel started successfully");
      return;
    } catch (error) {
      console.error("Cloudflare tunnel setup failed", error);
      if (attempt === setupRetries) {
        throw error;
      }
      console.log(`Retrying Cloudflare setup in ${retryDelayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseExtraArgs(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function shouldEnableCloudflare(): boolean {
  if (parseBoolean(process.env.CF_TUNNEL_DISABLED)) {
    return false;
  }

  if (process.env.CF_TUNNEL_ENABLED) {
    return parseBoolean(process.env.CF_TUNNEL_ENABLED);
  }

  return true;
}
