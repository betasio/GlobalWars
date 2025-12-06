import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const preprodConfig = new (class extends DefaultServerConfig {
  env(): GameEnv {
    return GameEnv.Preprod;
  }
  numWorkers(): number {
    return 2;
  }
  jwtAudience(): string {
    return "globalwars.dev";
  }
  allowedFlares(): string[] | undefined {
    return undefined;
    // TODO: Uncomment this after testing.
    // Allow access without login for now to test
    // the new login flow.
    // return [
    //   // "access:globalwars.dev"
    // ];
  }
})();
