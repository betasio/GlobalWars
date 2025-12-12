import { css, html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  fetchRankedLeaderboards,
  RankedClanEntry,
  RankedLeaderboards,
  RankedPlayerEntry,
} from "./firebaseAuth";
import { translateText } from "./Utils";

@customElement("stats-modal")
export class StatsModal extends LitElement {
  @query("o-modal")
  private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private isLoading: boolean = false;
  @state() private error: string | null = null;
  @state() private leaderboard: RankedLeaderboards | null = null;
  @state() private activeTab: "players" | "clans" = "players";

  private hasLoaded = false;

  createRenderRoot() {
    return this;
  }

  public open() {
    this.modalEl?.open();
    if (!this.hasLoaded && !this.isLoading) {
      void this.loadLeaderboard();
    }
  }

  public close() {
    this.modalEl?.close();
  }

  private async loadLeaderboard() {
    this.isLoading = true;
    this.error = null;

    try {
      this.leaderboard = await fetchRankedLeaderboards();
      this.hasLoaded = true;
    } catch (err) {
      console.warn("StatsModal: failed to load ranked leaderboards", err);
      this.error = translateText("stats_modal.error");
    } finally {
      this.isLoading = false;
      this.requestUpdate();
    }
  }

  private renderTabs() {
    const tabBase =
      "flex-1 px-4 py-2 rounded-lg font-semibold text-sm md:text-base transition";
    return html`
      <div class="flex gap-2 bg-slate-800/80 p-1 rounded-xl mb-4">
        <button
          class="${tabBase} ${this.activeTab === "players"
            ? "bg-purple-600 text-white shadow-lg"
            : "text-gray-200 hover:bg-slate-700"}"
          @click=${() => (this.activeTab = "players")}
        >
          ${translateText("stats_modal.players_tab")}
        </button>
        <button
          class="${tabBase} ${this.activeTab === "clans"
            ? "bg-purple-600 text-white shadow-lg"
            : "text-gray-200 hover:bg-slate-700"}"
          @click=${() => (this.activeTab = "clans")}
        >
          ${translateText("stats_modal.clans_tab")}
        </button>
      </div>
    `;
  }

  private renderTableHeader(headers: string[]) {
    return html`<thead>
      <tr class="border-b border-gray-700 text-gray-300">
        ${headers.map(
          (header, idx) =>
            html`<th
              class="py-2 px-2 ${idx === 0 ? "text-left" : "text-right"}"
            >
              ${header}
            </th>`,
        )}
      </tr>
    </thead>`;
  }

  private renderPlayerRows(players: RankedPlayerEntry[]) {
    if (!players.length) {
      return html`<div class="p-6 text-center text-gray-300">
        ${translateText("stats_modal.no_player_stats")}
      </div>`;
    }

    return html`<div class="overflow-x-auto">
      <table class="min-w-full text-xs md:text-sm">
        ${this.renderTableHeader([
          translateText("stats_modal.rank"),
          translateText("stats_modal.player"),
          translateText("stats_modal.rating"),
          translateText("stats_modal.wins"),
          translateText("stats_modal.losses"),
          translateText("stats_modal.games"),
        ])}
        <tbody>
          ${players.map(
            (player, idx) =>
              html`<tr class="border-b border-gray-800 last:border-b-0">
                <td class="py-2 px-2 text-left font-semibold">${idx + 1}</td>
                <td class="py-2 px-2 text-left">
                  <div class="flex flex-col">
                    <span class="font-semibold">${player.username}</span>
                    ${player.clanNickname && player.clanName
                      ? html`<span class="text-xs text-purple-200/80">
                          [${player.clanNickname}] ${player.clanName}
                        </span>`
                      : null}
                  </div>
                </td>
                <td class="py-2 px-2 text-right">${player.rating}</td>
                <td class="py-2 px-2 text-right">${player.wins}</td>
                <td class="py-2 px-2 text-right">${player.losses}</td>
                <td class="py-2 px-2 text-right">${player.games}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  private renderClanRows(clans: RankedClanEntry[]) {
    if (!clans.length) {
      return html`<div class="p-6 text-center text-gray-300">
        ${translateText("stats_modal.no_clan_stats")}
      </div>`;
    }

    return html`<div class="overflow-x-auto">
      <table class="min-w-full text-xs md:text-sm">
        ${this.renderTableHeader([
          translateText("stats_modal.rank"),
          translateText("stats_modal.clan"),
          translateText("stats_modal.rating"),
          translateText("stats_modal.wins"),
          translateText("stats_modal.losses"),
          translateText("stats_modal.games"),
        ])}
        <tbody>
          ${clans.map(
            (clan, idx) =>
              html`<tr class="border-b border-gray-800 last:border-b-0">
                <td class="py-2 px-2 text-left font-semibold">${idx + 1}</td>
                <td class="py-2 px-2 text-left">
                  <div class="flex flex-col">
                    <span class="font-semibold">
                      ${clan.nickname
                        ? `[${clan.nickname}] `
                        : ""}${clan.name ?? clan.id}
                    </span>
                  </div>
                </td>
                <td class="py-2 px-2 text-right">${clan.rating}</td>
                <td class="py-2 px-2 text-right">${clan.wins}</td>
                <td class="py-2 px-2 text-right">${clan.losses}</td>
                <td class="py-2 px-2 text-right">${clan.games}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  private renderBody() {
    if (this.isLoading) {
      return html`
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-2 text-lg font-semibold">
            ${translateText("stats_modal.loading")}
          </p>
          <div
            class="w-6 h-6 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"
          ></div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-4 text-center">${this.error}</p>
          <button
            class="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm font-medium"
            @click=${() => this.loadLeaderboard()}
          >
            ${translateText("stats_modal.retry")}
          </button>
        </div>
      `;
    }

    if (!this.leaderboard) {
      return html``;
    }

    const updated = this.leaderboard.fetchedAt;
    const players = this.leaderboard.players;
    const clans = this.leaderboard.clans;

    return html`
      <div class="p-4 md:p-6 text-gray-200 space-y-3">
        <div class="flex flex-col gap-1">
          <h2 class="text-xl font-semibold text-purple-200">
            ${translateText("stats_modal.ranked_title")}
          </h2>
          <p class="text-[11px] text-gray-500">
            ${translateText("stats_modal.last_updated", {
              date: updated.toLocaleString(),
            })}
          </p>
        </div>

        ${this.renderTabs()}
        ${this.activeTab === "players"
          ? this.renderPlayerRows(players)
          : this.renderClanRows(clans)}
      </div>
    `;
  }

  render() {
    return html`
      <o-modal id="stats-modal" title="${translateText("stats_modal.title")}">
        ${this.renderBody()}
      </o-modal>
    `;
  }
}

@customElement("stats-button")
export class StatsButton extends LitElement {
  @query("stats-modal") private statsModal: StatsModal;
  @state() private isVisible: boolean = true;

  static styles = css`
    :host {
      display: block;
    }
  `;

  constructor() {
    super();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    const buttonClass =
      "inline-flex items-center gap-2 px-4 py-2.5 min-w-[130px] justify-center rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white font-semibold tracking-wide shadow-[0_10px_35px_rgba(59,130,246,0.35)] border border-white/25 hover:shadow-[0_16px_45px_rgba(99,102,241,0.35)] hover:-translate-y-0.5 active:translate-y-0 transition duration-200 backdrop-blur-xl focus:outline-none focus:ring-2 focus:ring-cyan-200/80 focus:ring-offset-2 focus:ring-offset-slate-900 dark:focus:ring-offset-slate-950";

    return html`
      <button
        @click=${() => this.open()}
        class="${buttonClass}"
        title="${translateText("stats_modal.title")}"
        aria-label="${translateText("stats_modal.title")}"
      >
        <img src="/icons/stats.svg" alt="Stats" class="w-5 h-5 drop-shadow" />
        <span class="text-sm md:text-base">
          ${translateText("stats_modal.title")}
        </span>
      </button>
      <stats-modal></stats-modal>
    `;
  }

  private open() {
    this.isVisible = true;
    this.requestUpdate();
    this.statsModal?.open();
  }

  public close() {
    this.statsModal?.close();
    this.isVisible = false;
    this.requestUpdate();
  }
}
