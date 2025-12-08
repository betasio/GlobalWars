import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { GameMapType, GameMode, HumansVsNations } from "../core/game/Game";
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
  private lobbiesFetchInFlight: Promise<GameInfo[]> | null = null;

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
    if (this.lobbiesFetchInFlight) {
      return this.lobbiesFetchInFlight;
    }

    this.lobbiesFetchInFlight = (async () => {
      try {
        const response = await fetch(`/api/public_lobbies`);
        if (!response.ok)
          throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        return data.lobbies as GameInfo[];
      } catch (error) {
        console.error("Error fetching lobbies:", error);
        throw error;
      } finally {
        this.lobbiesFetchInFlight = null;
      }
    })();

    return this.lobbiesFetchInFlight;
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

    const lobby = this.lobbies[0];
    if (!lobby?.gameConfig) {
      return;
    }
    const start = this.lobbyIDToStart.get(lobby.gameID) ?? 0;
    const timeRemaining = Math.max(0, Math.floor((start - Date.now()) / 1000));

    // Display a simple seconds countdown
    const timeDisplay = `${timeRemaining}s`;

    const maxPlayers = lobby.gameConfig.maxPlayers ?? 0;
    const playerCount = lobby.numClients ?? 0;

    const teamCount =
      lobby.gameConfig.gameMode === GameMode.Team
        ? (lobby.gameConfig.playerTeams ?? 0)
        : null;

    const mapImageSrc = this.mapImages.get(lobby.gameID);

    return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        ?disabled=${this.isButtonDebounced}
        class="relative isolate w-full overflow-hidden rounded-2xl border ${this
          .isLobbyHighlighted
          ? "border-green-400/70"
          : "border-cyan-300/60"} bg-slate-900/70 backdrop-blur-xl text-white shadow-xl transition duration-200 hover:scale-[1.01] min-h-[14rem] md:min-h-[16rem] ${this
          .isButtonDebounced
          ? "opacity-70 cursor-not-allowed"
          : ""}"
      >
        ${mapImageSrc
          ? html`<img
              src="${mapImageSrc}"
              alt="${lobby.gameConfig.gameMap}"
              class="absolute inset-0 h-full w-full object-cover"
            />`
          : html`<div
              class="absolute inset-0 h-full w-full bg-gray-300"
            ></div>`}
        <div
          class="absolute inset-0 bg-gradient-to-r from-slate-900/85 via-slate-900/65 to-slate-900/35"
        ></div>

        <div
          class="relative z-10 flex h-full flex-col justify-between gap-6 p-5 md:p-7"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="rounded-full bg-white/15 px-3 py-1 text-xs uppercase tracking-[0.08em]"
              >
                ${translateText("public_lobby.join")}
              </span>
              <span
                class="rounded-full px-3 py-1 text-xs font-semibold ${this
                  .isLobbyHighlighted
                  ? "bg-green-400/20 text-green-100"
                  : "bg-cyan-300/20 text-cyan-100"}"
              >
                ${lobby.gameConfig.gameMode === GameMode.Team
                  ? typeof teamCount === "string"
                    ? teamCount === HumansVsNations
                      ? translateText("public_lobby.teams_hvn")
                      : translateText(`public_lobby.teams_${teamCount}`)
                    : translateText("public_lobby.teams", {
                        num: teamCount ?? 0,
                      })
                  : translateText("game_mode.ffa")}
              </span>
              <span
                class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold"
              >
                ${translateText(
                  `map.${lobby.gameConfig.gameMap.toLowerCase().replace(/\s+/g, "")}`,
                )}
              </span>
            </div>

            <div
              class="flex flex-col items-end text-right text-sm font-medium text-slate-100"
            >
              <span class="text-lg font-semibold leading-tight"
                >${playerCount} / ${maxPlayers}</span
              >
              <span class="text-xs text-slate-200/80"
                >${translateText("host_modal.players")}</span
              >
            </div>
          </div>

          <div
            class="grid grid-cols-1 gap-4 md:grid-cols-[1.2fr,1fr] md:items-end"
          >
            <div class="space-y-2 text-left">
              <div
                class="text-2xl font-semibold leading-tight text-white drop-shadow-md"
              >
                ${translateText("public_lobby.join")}
                ${translateText("game_mode.ffa")}
              </div>
              <p class="text-sm text-slate-100/80">
                ${translateText("public_lobby.waiting")}
              </p>
            </div>

            <div
              class="flex items-center justify-end gap-3 text-right text-sm font-semibold text-slate-100"
            >
              <span
                class="flex items-center gap-2 rounded-lg bg-white/12 px-3 py-2 shadow-inner shadow-white/10 backdrop-blur"
                title="${translateText("matchmaking_modal.waiting_for_game")}"
              >
                <span aria-hidden="true" class="text-base">⏱</span>
                <span
                  aria-label="${translateText(
                    "matchmaking_modal.waiting_for_game",
                  )}"
                >
                  ${timeDisplay}
                </span>
              </span>
            </div>
          </div>
        </div>
      </button>
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
    } else {
      this.dispatchEvent(
        new CustomEvent("leave-lobby", {
          detail: { lobby: this.currLobby },
          bubbles: true,
          composed: true,
        }),
      );
      this.leaveLobby();
    }
  }
}
