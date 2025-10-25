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
        ? "from-purple-700/90 via-purple-500/80 to-purple-400/70"
        : "from-blue-700/90 via-sky-600/80 to-sky-500/70";
    const highlightGradient =
      variant === "ranked"
        ? "from-amber-500/90 via-amber-400/85 to-amber-300/75"
        : "from-emerald-500/90 via-emerald-400/85 to-emerald-300/75";

    const buttonClass = `relative isolate flex min-h-[11.5rem] w-full flex-col overflow-hidden rounded-2xl text-white shadow-xl transition duration-200 hover:scale-[1.01] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 ${
      selected
        ? `bg-gradient-to-br ${highlightGradient}`
        : `bg-gradient-to-br ${baseGradient}`
    } ${this.isButtonDebounced ? "opacity-70 cursor-not-allowed" : ""}`;

    const title =
      variant === "ranked"
        ? `${translateText("public_lobby.join")} · Ranked`
        : translateText("public_lobby.join");

    const content =
      variant === "ranked"
        ? this.renderRankedDetails(lobby)
        : this.renderStandardDetails(lobby);

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
              class="absolute inset-0 -z-20 h-full w-full object-cover"
            />`
          : html`<div
              class="absolute inset-0 -z-20 h-full w-full bg-slate-900/60"
            ></div>`}
        <div
          class="absolute inset-0 -z-10 bg-gradient-to-br from-black/55 via-black/35 to-black/10"
        ></div>
        <div
          class="relative flex h-full flex-col justify-between gap-5 px-5 py-4 md:px-6 md:py-6"
        >
          <div class="flex flex-col gap-3 text-left">
            <div class="text-lg font-semibold leading-tight md:text-2xl">
              ${title}
            </div>
            ${content}
          </div>

          <div
            class="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-white/90 md:text-base"
          >
            <div
              class="inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1.5 backdrop-blur-sm"
              aria-label="${translateText(
                "host_modal.players",
              )}: ${lobby.numClients}"
              title="${translateText(
                "host_modal.players",
              )}: ${lobby.numClients}"
            >
              <span class="text-lg leading-tight">👥</span>
              <span
                >${lobby.numClients} /
                ${lobby.gameConfig.maxPlayers ?? "∞"}</span
              >
            </div>
            <div
              class="inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1.5 backdrop-blur-sm"
              aria-label="${translateText(
                "game_starting_modal.title",
              )}: ${timeDisplay}"
              title="${translateText(
                "game_starting_modal.title",
              )}: ${timeDisplay}"
            >
              <span class="text-lg leading-tight">⏱</span>
              <span>${timeDisplay}</span>
            </div>
          </div>
        </div>
      </button>
    `;
  }

  private renderStandardDetails(lobby: GameInfo) {
    const config = lobby.gameConfig!;
    const teamCount =
      config.gameMode === GameMode.Team ? (config.playerTeams ?? 0) : null;

    return html`
      <div
        class="flex flex-wrap items-center gap-2 text-sm font-medium text-white/85 md:text-base"
      >
        <span
          class="rounded-full bg-white/20 px-3 py-[2px] text-xs font-semibold uppercase tracking-wide text-white/80"
        >
          ${config.gameMode === GameMode.Team
            ? typeof teamCount === "string"
              ? translateText(`public_lobby.teams_${teamCount}`)
              : translateText("public_lobby.teams", {
                  num: teamCount ?? 0,
                })
            : translateText("game_mode.ffa")}
        </span>
        <span class="text-sm md:text-base">
          ${translateText(
            `map.${config.gameMap.toLowerCase().replace(/\s+/g, "")}`,
          )}
        </span>
      </div>
    `;
  }

  private renderRankedDetails(lobby: GameInfo) {
    const config = lobby.gameConfig!;
    const turnTimers = config.turnTimers ?? RANKED_TURN_TIMERS;
    const fogRule = config.fogRule ?? RANKED_FOG_RULE;

    return html`
      <div
        class="flex flex-col gap-2 text-sm font-medium text-white/85 md:text-base"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="rounded-full bg-white/20 px-3 py-[2px] text-xs font-semibold uppercase tracking-wide text-white/80"
          >
            Ranked Queue
          </span>
          <span>
            ${translateText(
              `map.${config.gameMap.toLowerCase().replace(/\s+/g, "")}`,
            )}
          </span>
        </div>
        <div class="text-xs font-medium text-white/80 md:text-sm">
          Queue ${turnTimers.queueSeconds}s · Turn ${turnTimers.turnSeconds}s ·
          Fog ${fogRule}
        </div>
        ${config.mapPool
          ? html`<div class="flex flex-wrap gap-2 text-xs">
              ${config.mapPool.map((map) => {
                const key = `map.${map.toLowerCase().replace(/\s+/g, "")}`;
                return html`<span
                  class="rounded-full bg-white/15 px-3 py-[2px]"
                >
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
