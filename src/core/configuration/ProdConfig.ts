import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const prodConfig = new (class extends DefaultServerConfig {
  enableMatchmaking(): boolean {
    // Production instances should run the full matchmaking loop.
    // This keeps public lobbies alive and serves websocket traffic
    // on the /wX worker routes.
    return true;
  }
  numWorkers(): number {
    return 3;
  }
  env(): GameEnv {
    return GameEnv.Prod;
  }
  jwtAudience(): string {
    return "globalwars.co.uk";
  }
})();
