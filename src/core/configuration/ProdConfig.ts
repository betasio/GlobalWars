import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

const ENV = typeof process !== "undefined" ? process.env : undefined;

export const prodConfig = new (class extends DefaultServerConfig {
  numWorkers(): number {
    return 20;
  }
  env(): GameEnv {
    return GameEnv.Prod;
  }
  jwtAudience(): string {
    return ENV?.JWT_AUDIENCE ?? "openfront.io";
  }
})();
