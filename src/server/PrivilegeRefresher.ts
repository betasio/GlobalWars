import { base64url } from "jose";
import { Logger } from "winston";
import { parseCosmetics } from "../core/CosmeticsNormalizer";
import {
  FailOpenPrivilegeChecker,
  PrivilegeChecker,
  PrivilegeCheckerImpl,
} from "./Privilege";

// Refreshes the privilege checker every 5 minutes.
// WARNING: This fails open if cosmetics.json is not available.
export class PrivilegeRefresher {
  private privilegeChecker: PrivilegeChecker | null = null;
  private failOpenPrivilegeChecker: PrivilegeChecker =
    new FailOpenPrivilegeChecker();

  private log: Logger;

  constructor(
    private endpoint: string,
    parentLog: Logger,
    private refreshInterval: number = 1000 * 60 * 3,
  ) {
    this.log = parentLog.child({ comp: "privilege-refresher" });
  }

  public async start() {
    this.log.info(
      `Starting privilege refresher with interval ${this.refreshInterval}`,
    );
    // Add some jitter to the initial load and the interval.
    setTimeout(() => this.loadPrivilegeChecker(), Math.random() * 1000);
    setInterval(
      () => this.loadPrivilegeChecker(),
      this.refreshInterval + Math.random() * 1000,
    );
  }

  public get(): PrivilegeChecker {
    return this.privilegeChecker ?? this.failOpenPrivilegeChecker;
  }

  private async loadPrivilegeChecker(): Promise<void> {
    this.log.info(`Loading privilege checker from ${this.endpoint}`);
    try {
      if (!this.endpoint) {
        this.log.warn(
          "Cosmetics endpoint not configured; continuing with fail-open checker",
        );
        return;
      }

      const response = await fetch(this.endpoint);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const cosmeticsData = await response.json();
      const parsed = parseCosmetics(cosmeticsData);

      this.privilegeChecker = new PrivilegeCheckerImpl(
        parsed,
        base64url.decode,
      );
      this.log.info(`Privilege checker loaded successfully`);
    } catch (error) {
      this.log.error(`Failed to fetch cosmetics from ${this.endpoint}:`, error);
      this.log.warn("Continuing with fail-open privilege checker");
    }
  }
}
