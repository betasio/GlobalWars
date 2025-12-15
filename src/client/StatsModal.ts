import { css, html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { getRankForRating } from "../core/Ranks";
import {
  RankedClanEntry,
  RankedLeaderboards,
  RankedPlayerEntry,
  subscribeToRankedLeaderboards,
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
  private unsubscribeRanked: (() => void) | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.loadLeaderboard();
  }

  disconnectedCallback(): void {
    this.unsubscribeRanked?.();
    this.unsubscribeRanked = null;
    super.disconnectedCallback();
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
    if (this.unsubscribeRanked) return;

    this.isLoading = true;
    this.error = null;

    try {
      this.unsubscribeRanked = await subscribeToRankedLeaderboards(
        (leaderboard) => {
          this.leaderboard = leaderboard;
          this.hasLoaded = true;
          this.isLoading = false;
          this.error = null;
          this.requestUpdate();
        },
        (err) => {
          if (err?.code === "permission-denied") {
            console.info(
              "StatsModal: missing Firestore permissions for leaderboards",
            );
          } else {
            console.warn(
              "StatsModal: failed to subscribe to ranked leaderboards",
              err,
            );
          }
          this.error = translateText("stats_modal.error");
          this.isLoading = false;
          this.unsubscribeRanked = null;
          this.requestUpdate();
        },
      );
    } catch (err) {
      console.warn("StatsModal: failed to load ranked leaderboards", err);
      this.error = translateText("stats_modal.error");
      this.unsubscribeRanked = null;
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
              class="py-2 px-2 ${idx === 0
                ? "text-left"
                : idx === headers.length - 1
                  ? "text-left"
                  : "text-right"}"
            >
              ${header}
            </th>`,
        )}
      </tr>
    </thead>`;
  }

  private renderTierCell(
    rankPoints: number,
    tierOverride?: ReturnType<typeof getRankForRating>,
  ) {
    const tier = tierOverride ?? getRankForRating(rankPoints);
    return html`<div class="flex items-center gap-2">
      <img
        src="${tier.logo}"
        alt="${tier.name}"
        class="w-8 h-8 rounded-full border border-white/10 bg-slate-800/80"
      />
      <div class="flex flex-col leading-tight">
        <span class="font-semibold">${tier.name}</span>
        <span class="text-[11px] text-gray-300">${rankPoints} pts</span>
      </div>
    </div>`;
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
          translateText("stats_modal.rank_points"),
          translateText("stats_modal.tier"),
        ])}
        <tbody>
          ${players.map(
            (player, idx) =>
              html`<tr class="border-b border-gray-800 last:border-b-0">
                <td class="py-2 px-2 text-left font-semibold">
                  ${player.position ?? idx + 1}
                </td>
                <td class="py-2 px-2 text-left">
                  <div class="flex flex-col">
                    <span class="font-semibold">
                      ${player.clanNickname
                        ? `[${player.clanNickname}] `
                        : ""}${player.username}
                    </span>
                    ${player.clanName
                      ? html`<span class="text-xs text-purple-200/80">
                          ${player.clanName}
                        </span>`
                      : null}
                  </div>
                </td>
                <td class="py-2 px-2 text-right font-semibold">
                  ${player.rankPoints}
                </td>
                <td class="py-2 px-2 text-left">
                  ${this.renderTierCell(player.rankPoints, player.tier)}
                </td>
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
          translateText("stats_modal.total_rank_points"),
          translateText("stats_modal.tier"),
        ])}
        <tbody>
          ${clans.map(
            (clan, idx) =>
              html`<tr class="border-b border-gray-800 last:border-b-0">
                <td class="py-2 px-2 text-left font-semibold">
                  ${clan.position ?? idx + 1}
                </td>
                <td class="py-2 px-2 text-left">
                  <div class="flex flex-col">
                    <span class="font-semibold">
                      ${clan.nickname
                        ? `[${clan.nickname}] `
                        : ""}${clan.name ?? clan.id}
                    </span>
                  </div>
                </td>
                <td class="py-2 px-2 text-right font-semibold">
                  ${clan.totalRankPoints ?? clan.rankPoints}
                </td>
                <td class="py-2 px-2 text-left">
                  ${this.renderTierCell(clan.rankPoints, clan.tier)}
                </td>
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

    const players = this.leaderboard.players;
    const clans = this.leaderboard.clans;

    return html`
      <div class="p-4 md:p-6 text-gray-200 space-y-3">
        <div class="flex flex-col gap-1">
          <h2 class="text-xl font-semibold text-purple-200">
            ${translateText("stats_modal.ranked_title")}
          </h2>
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
      "inline-flex items-center gap-2 px-4 py-2.5 min-w-[130px] justify-center rounded-xl bg-gradient-to-r from-purple-400 via-fuchsia-600 to-indigo-700 text-white font-semibold tracking-wide shadow-[0_10px_35px_rgba(147,51,234,0.35)] border border-white/25 hover:shadow-[0_16px_45px_rgba(99,102,241,0.35)] hover:-translate-y-0.5 active:translate-y-0 transition duration-200 backdrop-blur-xl focus:outline-none focus:ring-2 focus:ring-purple-200/80 focus:ring-offset-2 focus:ring-offset-slate-900 dark:focus:ring-offset-slate-950";

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
