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
  @state() private lobbies: GameInfo[] = [];
  @state() public isLobbyHighlighted: boolean = false;
  @state() private isButtonDebounced: boolean = false;
  @state() private mapImages: Map<GameID, string> = new Map();
  private lobbiesInterval: number | null = null;
  private currLobby: GameInfo | null = null;
  private debounceDelay: number = 750;
  private lobbyIDToStart = new Map<GameID, number>();

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
  }

  private async fetchAndUpdateLobbies(): Promise<void> {
    try {
      this.lobbies = await this.fetchLobbies();
      this.lobbies.forEach((l) => {
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
  }

  render() {
    if (this.lobbies.length === 0) return html``;

    const standardLobby = this.lobbies.find(
      (l) => l.gameConfig && l.gameConfig.gameType !== GameType.Ranked,
    );
    const rankedLobby = this.lobbies.find(
      (l) => l.gameConfig && l.gameConfig.gameType === GameType.Ranked,
    );

    if (!standardLobby && !rankedLobby) {
      return html``;
    }

    return html`
      <div class="flex flex-col gap-4">
        ${standardLobby
          ? this.renderLobbyButton(standardLobby, "public")
          : null}
        ${rankedLobby ? this.renderLobbyButton(rankedLobby, "ranked") : null}
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
  }

  private lobbyClicked(lobby: GameInfo) {
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

    if (this.currLobby.gameID === lobby.gameID) {
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
}
