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
  const accountId = config.cloudflareAccountId();
  const apiToken = config.cloudflareApiToken();
  const configPath = config.cloudflareConfigPath();
  const credsPath = config.cloudflareCredsPath();
  const subdomain = config.subdomain();
  const domain = config.domain();

  if (
    !accountId ||
    !apiToken ||
    !configPath ||
    !credsPath ||
    !subdomain ||
    !domain ||
    process.env.CF_TUNNEL_DISABLED === "true"
  ) {
    console.log(
      "Skipping Cloudflare tunnel setup (missing credentials/config or CF_TUNNEL_DISABLED=true)",
    );
    return;
  }

  const cloudflare = new Cloudflare(accountId, apiToken, configPath, credsPath);

  const domainToService = new Map<string, string>().set(
    subdomain,
    // TODO: change to 3000 when we have a proper tunnel setup.
    `http://localhost:80`,
  );

  for (let i = 0; i < config.numWorkers(); i++) {
    domainToService.set(
      `w${i}-${subdomain}`,
      `http://localhost:${3000 + i + 1}`,
    );
  }

  if (!(await cloudflare.configAlreadyExists())) {
    await cloudflare.createTunnel({
      subdomain,
      domain,
      subdomainToService: domainToService,
    } as TunnelConfig);
  } else {
    console.log("Config already exists, skipping tunnel creation");
  }

  await cloudflare.startCloudflared();
}
