import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderDuration, translateText } from "../client/Utils";
import { GameMapType, GameMode, GameType } from "../core/game/Game";
import { RANKED_FOG_RULE, RANKED_TURN_TIMERS } from "../core/game/GamePresets";
import { GameID, GameInfo } from "../core/Schemas";
import { generateID } from "../core/Util";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

@customElement("public-lobby")
export class PublicLobby extends LitElement {
  private static readonly RANKED_FIRST_DELAY_MS = 45_000;
  private static readonly RANKED_ROTATION_INTERVAL_MS = 150_000;
  private static readonly RANKED_DISPLAY_DURATION_MS = 60_000;

  @state() private lobbies: GameInfo[] = [];
  @state() public isLobbyHighlighted: boolean = false;
  @state() private isButtonDebounced: boolean = false;
  @state() private mapImages: Map<GameID, string> = new Map();
  @state() private showRankedRotation: boolean = false;
  private lobbiesInterval: number | null = null;
  private currLobby: GameInfo | null = null;
  private debounceDelay: number = 750;
  private lobbyIDToStart = new Map<GameID, number>();
  private hasRankedLobby = false;
  private rankedRotationTimer: number | null = null;
  private rankedHideTimer: number | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchAndUpdateLobbies();
    this.lobbiesInterval = window.setInterval(
      () => this.fetchAndUpdateLobbies(),
      1000,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.lobbiesInterval !== null) {
      clearInterval(this.lobbiesInterval);
      this.lobbiesInterval = null;
    }
    this.clearRankedRotationTimers();
  }

  private async fetchAndUpdateLobbies(): Promise<void> {
    try {
      const lobbies = await this.fetchLobbies();
      this.lobbies = lobbies;

      const seenLobbyIDs = new Set(lobbies.map((l) => l.gameID));
      Array.from(this.lobbyIDToStart.keys()).forEach((id) => {
        if (!seenLobbyIDs.has(id)) {
          this.lobbyIDToStart.delete(id);
          this.mapImages.delete(id);
        }
      });

      if (this.currLobby) {
        const updatedLobby = lobbies.find(
          (l) => l.gameID === this.currLobby?.gameID,
        );

        if (updatedLobby) {
          this.currLobby = updatedLobby;
        } else {
          this.leaveLobby();
        }
      }

      const hadRanked = this.hasRankedLobby;
      this.hasRankedLobby = lobbies.some(
        (l) => l.gameConfig?.gameType === GameType.Ranked,
      );

      if (!this.hasRankedLobby) {
        this.showRankedRotation = false;
        this.clearRankedRotationTimers();
      } else if (!hadRanked) {
        this.startRankedRotationCycle(this.currLobby === null);
      }

      lobbies.forEach((l) => {
        // Store the start time on first fetch because endpoint is cached, causing
        // the time to appear irregular.
        if (!this.lobbyIDToStart.has(l.gameID)) {
          const msUntilStart = l.msUntilStart ?? 0;
          this.lobbyIDToStart.set(l.gameID, msUntilStart + Date.now());
        }

        // Load map image if not already loaded
        if (l.gameConfig && !this.mapImages.has(l.gameID)) {
          this.loadMapImage(l.gameID, l.gameConfig.gameMap);
        }
      });
    } catch (error) {
      console.error("Error fetching lobbies:", error);
    }
  }

  private async loadMapImage(gameID: GameID, gameMap: string) {
    try {
      // Convert string to GameMapType enum value
      const mapType = gameMap as GameMapType;
      const data = terrainMapFileLoader.getMapData(mapType);
      this.mapImages.set(gameID, await data.webpPath());
      this.requestUpdate();
    } catch (error) {
      console.error("Failed to load map image:", error);
    }
  }

  async fetchLobbies(): Promise<GameInfo[]> {
    try {
      const response = await fetch(`/api/public_lobbies`);
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return data.lobbies;
    } catch (error) {
      console.error("Error fetching lobbies:", error);
      throw error;
    }
  }

  public stop() {
    if (this.lobbiesInterval !== null) {
      this.isLobbyHighlighted = false;
      clearInterval(this.lobbiesInterval);
      this.lobbiesInterval = null;
    }
    this.showRankedRotation = false;
    this.clearRankedRotationTimers();
  }

  render() {
    const selectedLobby =
      this.currLobby && this.currLobby.gameConfig ? this.currLobby : null;

    if (selectedLobby) {
      const variant =
        selectedLobby.gameConfig!.gameType === GameType.Ranked
          ? "ranked"
          : "public";

      return html`
        <div class="flex flex-col gap-4">
          ${this.renderLobbyButton(selectedLobby, variant)}
        </div>
      `;
    }

    if (this.lobbies.length === 0) {
      return html``;
    }

    const standardLobby =
      this.lobbies.find(
        (l) => l.gameConfig && l.gameConfig.gameType !== GameType.Ranked,
      ) ?? null;
    const rankedLobby =
      this.lobbies.find(
        (l) => l.gameConfig && l.gameConfig.gameType === GameType.Ranked,
      ) ?? null;

    if (!standardLobby && !rankedLobby) {
      return html``;
    }

    const shouldShowRanked = this.showRankedRotation && rankedLobby !== null;
    const lobbyToRender =
      (shouldShowRanked ? rankedLobby : standardLobby) ??
      rankedLobby ??
      standardLobby;

    if (!lobbyToRender) {
      return html``;
    }

    const variant =
      lobbyToRender.gameConfig?.gameType === GameType.Ranked
        ? "ranked"
        : "public";

    return html`
      <div class="flex flex-col gap-4">
        ${this.renderLobbyButton(lobbyToRender, variant)}
      </div>
    `;
  }

  private renderLobbyButton(lobby: GameInfo, variant: "public" | "ranked") {
    if (!lobby.gameConfig) {
      return null;
    }

    const start = this.lobbyIDToStart.get(lobby.gameID) ?? 0;
    const timeRemaining = Math.max(0, Math.floor((start - Date.now()) / 1000));
    const timeDisplay = renderDuration(timeRemaining);
    const mapImageSrc = this.mapImages.get(lobby.gameID);
    const selected = this.currLobby?.gameID === lobby.gameID;

    const baseGradient =
      variant === "ranked"
        ? "bg-gradient-to-r from-purple-600 to-purple-500"
        : "bg-gradient-to-r from-blue-600 to-blue-500";
    const highlightGradient =
      variant === "ranked"
        ? "bg-gradient-to-r from-amber-500 to-amber-400"
        : "bg-gradient-to-r from-green-600 to-green-500";

    const labelColor =
      variant === "ranked"
        ? selected
          ? "text-amber-600"
          : "text-purple-600"
        : selected
          ? "text-green-600"
          : "text-blue-600";

    const buttonClass = `${
      selected ? highlightGradient : baseGradient
    } isolate grid h-40 grid-cols-[100%] grid-rows-[100%] place-content-stretch w-full overflow-hidden text-white font-medium rounded-xl transition-opacity duration-200 hover:opacity-90 ${
      this.isButtonDebounced ? "opacity-70 cursor-not-allowed" : ""
    }`;

    const title =
      variant === "ranked"
        ? `${translateText("public_lobby.join")} · Ranked`
        : translateText("public_lobby.join");

    const content =
      variant === "ranked"
        ? this.renderRankedDetails(lobby)
        : this.renderStandardDetails(lobby, labelColor);

    return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        ?disabled=${this.isButtonDebounced}
        class="${buttonClass}"
      >
        ${mapImageSrc
          ? html`<img
              src="${mapImageSrc}"
              alt="${lobby.gameConfig.gameMap}"
              class="place-self-start col-span-full row-span-full h-full -z-10"
              style="mask-image: linear-gradient(to left, transparent, #fff)"
            />`
          : html`<div
              class="place-self-start col-span-full row-span-full h-full -z-10 bg-gray-300"
            ></div>`}
        <div
          class="flex flex-col justify-between h-full col-span-full row-span-full p-4 md:p-6 text-right z-0"
        >
          <div>
            <div class="text-lg md:text-2xl font-semibold">${title}</div>
            ${content}
          </div>

          <div>
            <div class="text-md font-medium text-white/80">
              ${lobby.numClients} / ${lobby.gameConfig.maxPlayers ?? "∞"}
            </div>
            <div class="text-md font-medium text-white/80">${timeDisplay}</div>
          </div>
        </div>
      </button>
    `;
  }

  private renderStandardDetails(lobby: GameInfo, labelColor: string) {
    const config = lobby.gameConfig!;
    const teamCount =
      config.gameMode === GameMode.Team ? (config.playerTeams ?? 0) : null;

    return html`
      <div class="text-md font-medium text-blue-100">
        <span class="text-sm ${labelColor} bg-white rounded-sm px-1">
          ${config.gameMode === GameMode.Team
            ? typeof teamCount === "string"
              ? translateText(`public_lobby.teams_${teamCount}`)
              : translateText("public_lobby.teams", {
                  num: teamCount ?? 0,
                })
            : translateText("game_mode.ffa")}
        </span>
        <span
          >${translateText(
            `map.${config.gameMap.toLowerCase().replace(/\s+/g, "")}`,
          )}</span
        >
      </div>
    `;
  }

  private renderRankedDetails(lobby: GameInfo) {
    const config = lobby.gameConfig!;
    const turnTimers = config.turnTimers ?? RANKED_TURN_TIMERS;
    const fogRule = config.fogRule ?? RANKED_FOG_RULE;

    return html`
      <div class="flex flex-col gap-1 text-sm font-medium text-white/80">
        <div>
          <span class="bg-white/20 rounded-sm px-1">
            ${translateText(
              `map.${config.gameMap.toLowerCase().replace(/\s+/g, "")}`,
            )}
          </span>
        </div>
        <div>
          Queue ${turnTimers.queueSeconds}s · Turn ${turnTimers.turnSeconds}s ·
          Fog ${fogRule}
        </div>
        ${config.mapPool
          ? html`<div class="flex flex-wrap gap-1 justify-end text-xs">
              ${config.mapPool.map((map) => {
                const key = `map.${map.toLowerCase().replace(/\s+/g, "")}`;
                return html`<span class="bg-white/15 rounded px-2 py-[2px]">
                  ${translateText(key)}
                </span>`;
              })}
            </div>`
          : null}
      </div>
    `;
  }

  leaveLobby() {
    this.isLobbyHighlighted = false;
    this.currLobby = null;
    if (this.hasRankedLobby) {
      this.startRankedRotationCycle(false);
    }
  }

  private lobbyClicked(lobby: GameInfo) {
    if (this.currLobby?.gameID === lobby.gameID) {
      this.dispatchEvent(
        new CustomEvent("leave-lobby", {
          detail: { lobby: this.currLobby },
          bubbles: true,
          composed: true,
        }),
      );
      this.leaveLobby();
      return;
    }

    if (this.isButtonDebounced) {
      return;
    }

    // Set debounce state
    this.isButtonDebounced = true;

    // Reset debounce after delay
    setTimeout(() => {
      this.isButtonDebounced = false;
    }, this.debounceDelay);

    if (this.currLobby === null) {
      this.joinLobbyInternal(lobby);
      return;
    }

    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.currLobby },
        bubbles: true,
        composed: true,
      }),
    );
    this.joinLobbyInternal(lobby);
  }

  private joinLobbyInternal(lobby: GameInfo) {
    this.isLobbyHighlighted = true;
    this.currLobby = lobby;
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobby.gameID,
          clientID: generateID(),
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private clearRankedRotationTimers() {
    if (this.rankedRotationTimer !== null) {
      clearTimeout(this.rankedRotationTimer);
      this.rankedRotationTimer = null;
    }

    if (this.rankedHideTimer !== null) {
      clearTimeout(this.rankedHideTimer);
      this.rankedHideTimer = null;
    }
  }

  private startRankedRotationCycle(showImmediately: boolean) {
    this.clearRankedRotationTimers();

    if (!this.hasRankedLobby) {
      this.showRankedRotation = false;
      return;
    }

    const scheduleNextDisplay = (delay: number) => {
      this.rankedRotationTimer = window.setTimeout(() => {
        if (!this.hasRankedLobby) {
          this.showRankedRotation = false;
          return;
        }

        const selectedType = this.currLobby?.gameConfig?.gameType;

        if (selectedType && selectedType !== GameType.Ranked) {
          this.showRankedRotation = false;
          scheduleNextDisplay(PublicLobby.RANKED_ROTATION_INTERVAL_MS);
          return;
        }

        if (!this.currLobby) {
          this.showRankedRotation = true;
        } else {
          this.showRankedRotation =
            this.currLobby.gameConfig?.gameType === GameType.Ranked;
        }

        if (!this.showRankedRotation) {
          scheduleNextDisplay(PublicLobby.RANKED_ROTATION_INTERVAL_MS);
          return;
        }

        this.rankedHideTimer = window.setTimeout(() => {
          if (
            this.currLobby &&
            this.currLobby.gameConfig?.gameType === GameType.Ranked
          ) {
            scheduleNextDisplay(PublicLobby.RANKED_ROTATION_INTERVAL_MS);
            return;
          }

          this.showRankedRotation = false;

          if (this.hasRankedLobby) {
            scheduleNextDisplay(PublicLobby.RANKED_ROTATION_INTERVAL_MS);
          }
        }, PublicLobby.RANKED_DISPLAY_DURATION_MS);
      }, delay);
    };

    scheduleNextDisplay(
      showImmediately ? 0 : PublicLobby.RANKED_FIRST_DELAY_MS,
    );
  }
}
