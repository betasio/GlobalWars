import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

const ENV = typeof process !== "undefined" ? process.env : undefined;

export const preprodConfig = new (class extends DefaultServerConfig {
  env(): GameEnv {
    return GameEnv.Preprod;
  }
  numWorkers(): number {
    return 2;
  }
  jwtAudience(): string {
    return ENV?.JWT_AUDIENCE ?? "openfront.dev";
  }
  allowedFlares(): string[] | undefined {
    return undefined;
    // TODO: Uncomment this after testing.
    // Allow access without login for now to test
    // the new login flow.
    // return [
    //   // "access:openfront.dev"
    // ];
  }
})();
