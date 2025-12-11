import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  ClanProfile,
  createClan,
  disbandClan,
  fetchClanForUser,
  joinClan,
  kickMember,
  leaveClan,
  renameClan,
} from "./firebaseAuth";
import { translateText } from "./Utils";
import { sanitizeClanName, validateClanName } from "../core/validations/clan";
import { ensureFirebaseReady, fetchStoredUsername } from "./firebaseAuth";

interface StatusMessage {
  type: "success" | "error";
  text: string;
}

@customElement("clan-modal")
export class ClanModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @property({ type: Boolean }) openOnInit = false;

  @state() private clan: ClanProfile | null = null;
  @state() private authUser: any | null = null;
  @state() private isLoading = false;
  @state() private status: StatusMessage | null = null;
  @state() private createName = "";
  @state() private joinName = "";
  @state() private renameName = "";
  @state() private isProcessing = false;

  private authListener: ((event: Event) => void) | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.authListener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      void this.applyAuthUser(detail ?? null);
    };
    document.addEventListener(
      "firebase-auth-changed",
      this.authListener as EventListener,
    );

    void ensureFirebaseReady()
      .then(({ user }) => this.applyAuthUser(user))
      .catch(() => this.applyAuthUser(null));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.authListener) {
      document.removeEventListener(
        "firebase-auth-changed",
        this.authListener as EventListener,
      );
    }
  }

  render() {
    return html`
      <o-modal
        id="clan-modal"
        title="${translateText("clan.title") || "Clans"}"
      >
        ${this.renderContent()}
      </o-modal>
    `;
  }

  private renderContent() {
    if (this.isLoading) {
      return html`<div class="p-4 text-center text-white">
        ${translateText("clan.loading") || "Loading clan info..."}
      </div>`;
    }

    if (!this.authUser) {
      return html`<div class="p-4 text-center text-white space-y-2">
        <p>${
          translateText("clan.login_required") ||
          "Log in to create or join a clan."
        }</p>
      </div>`;
    }

    return html`
      <div class="p-4 space-y-4 text-white">
        ${this.status
          ? html`<div
              class="text-sm text-center ${
                this.status.type === "success" ? "text-green-500" : "text-red-400"
              }"
            >
              ${this.status.text}
            </div>`
          : null}
        ${this.clan ? this.renderClanDetails() : this.renderCreateJoin()}
      </div>
    `;
  }

  private renderCreateJoin() {
    return html`<div class="space-y-6">
      <div class="space-y-2">
        <p class="text-lg font-semibold">
          ${translateText("clan.create_title") || "Create a clan"}
        </p>
        <input
          class="w-full px-3 py-2 rounded bg-gray-800 border border-gray-600 focus:outline-none"
          placeholder="${
            translateText("clan.name_placeholder") || "Clan name"
          }"
          .value=${this.createName}
          @input=${(e: Event) => (this.createName = (e.target as HTMLInputElement).value)}
        />
        <button
          class="w-full px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
          @click=${this.handleCreate}
          ?disabled=${this.isProcessing}
        >
          ${translateText("clan.create_button") || "Create clan"}
        </button>
      </div>
      <div class="space-y-2">
        <p class="text-lg font-semibold">
          ${translateText("clan.join_title") || "Join a clan"}
        </p>
        <input
          class="w-full px-3 py-2 rounded bg-gray-800 border border-gray-600 focus:outline-none"
          placeholder="${
            translateText("clan.name_placeholder") || "Clan name"
          }"
          .value=${this.joinName}
          @input=${(e: Event) => (this.joinName = (e.target as HTMLInputElement).value)}
        />
        <button
          class="w-full px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60"
          @click=${this.handleJoin}
          ?disabled=${this.isProcessing}
        >
          ${translateText("clan.join_button") || "Join clan"}
        </button>
      </div>
    </div>`;
  }

  private renderClanDetails() {
    if (!this.clan) return null;
    const memberEntries = Object.values(this.clan.members || {}).sort((a, b) => {
      if (a.role === "leader" && b.role !== "leader") return -1;
      if (b.role === "leader" && a.role !== "leader") return 1;
      return a.username.localeCompare(b.username);
    });
    const isLeader = this.clan.leaderUid === this.authUser?.uid;

    return html`
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xl font-bold">${this.clan.name}</p>
            <p class="text-sm text-gray-300">
              ${translateText("clan.members_label") || "Members"}: ${
                memberEntries.length
              }
            </p>
          </div>
          ${isLeader
            ? html`<button
                class="px-3 py-2 text-sm rounded bg-red-600 hover:bg-red-700"
                @click=${this.handleDisband}
                ?disabled=${this.isProcessing}
              >
                ${translateText("clan.disband") || "Disband clan"}
              </button>`
            : html`<button
                class="px-3 py-2 text-sm rounded bg-gray-600 hover:bg-gray-700"
                @click=${this.handleLeave}
                ?disabled=${this.isProcessing}
              >
                ${translateText("clan.leave") || "Leave clan"}
              </button>`}
        </div>

        ${isLeader
          ? html`<div class="space-y-2">
              <p class="font-semibold">
                ${translateText("clan.rename_label") || "Rename clan"}
              </p>
              <div class="flex gap-2">
                <input
                  class="flex-1 px-3 py-2 rounded bg-gray-800 border border-gray-600 focus:outline-none"
                  .value=${this.renameName}
                  placeholder="${
                    translateText("clan.name_placeholder") || "Clan name"
                  }"
                  @input=${(e: Event) =>
                    (this.renameName = (e.target as HTMLInputElement).value)}
                />
                <button
                  class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
                  @click=${this.handleRename}
                  ?disabled=${this.isProcessing || !this.renameName.trim()}
                >
                  ${translateText("clan.save_name") || "Save name"}
                </button>
              </div>
            </div>`
          : null}

        <div class="space-y-2">
          <p class="font-semibold">
            ${translateText("clan.members_label") || "Members"}
          </p>
          <div class="space-y-2">
            ${memberEntries.map(
              (member) => html`<div
                class="flex items-center justify-between bg-gray-800 rounded px-3 py-2"
              >
                <div>
                  <p class="font-medium">${member.username}</p>
                  <p class="text-xs text-gray-400">
                    ${member.role === "leader"
                      ? translateText("clan.leader_label") || "Leader"
                      : translateText("clan.member_label") || "Member"}
                  </p>
                </div>
                ${isLeader && member.uid !== this.authUser?.uid
                  ? html`<button
                      class="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 disabled:opacity-60"
                      @click=${() => this.handleKick(member.uid)}
                      ?disabled=${this.isProcessing}
                    >
                      ${translateText("clan.kick") || "Kick"}
                    </button>`
                  : null}
              </div>`
            )}
          </div>
        </div>
      </div>
    `;
  }

  private async applyAuthUser(user: any | null) {
    this.authUser = user;
    this.status = null;
    if (!user) {
      this.clan = null;
      return;
    }
    await this.refreshClan();
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  private async refreshClan() {
    if (!this.authUser) {
      this.clan = null;
      return;
    }
    this.isLoading = true;
    try {
      this.clan = await fetchClanForUser(this.authUser.uid);
      this.renameName = this.clan?.name ?? "";
    } finally {
      this.isLoading = false;
    }
  }

  private setStatus(text: string, type: StatusMessage["type"]) {
    this.status = { text, type };
  }

  private async ensureUsername(): Promise<string> {
    const stored = await fetchStoredUsername(this.authUser?.uid ?? "");
    const inputEl = document.querySelector("username-input") as any;
    const current = inputEl?.getCurrentUsername?.();
    return current || stored || "Player";
  }

  private async handleCreate() {
    if (!this.authUser) return;
    const name = sanitizeClanName(this.createName);
    const validation = validateClanName(name);
    if (!validation.isValid) {
      this.setStatus(
        translateText(validation.error || "clan.invalid_name") ||
          "Clan name is invalid.",
        "error",
      );
      return;
    }
    this.isProcessing = true;
    try {
      const username = await this.ensureUsername();
      this.clan = await createClan(this.authUser.uid, username, name);
      this.setStatus(
        translateText("clan.created_success") || "Clan created!",
        "success",
      );
      this.createName = "";
      this.renameName = this.clan.name;
    } catch (err: any) {
      this.handleError(err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleJoin() {
    if (!this.authUser) return;
    const name = sanitizeClanName(this.joinName);
    const validation = validateClanName(name);
    if (!validation.isValid) {
      this.setStatus(
        translateText(validation.error || "clan.invalid_name") ||
          "Clan name is invalid.",
        "error",
      );
      return;
    }
    this.isProcessing = true;
    try {
      const username = await this.ensureUsername();
      this.clan = await joinClan(this.authUser.uid, username, name);
      this.setStatus(
        translateText("clan.joined_success") || "Joined clan!",
        "success",
      );
      this.renameName = this.clan?.name ?? "";
    } catch (err: any) {
      this.handleError(err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleLeave() {
    if (!this.authUser) return;
    this.isProcessing = true;
    try {
      await leaveClan(this.authUser.uid);
      this.clan = null;
      this.setStatus(
        translateText("clan.left_success") || "Left clan.",
        "success",
      );
    } catch (err: any) {
      this.handleError(err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleRename() {
    if (!this.authUser || !this.clan) return;
    const name = sanitizeClanName(this.renameName);
    const validation = validateClanName(name);
    if (!validation.isValid) {
      this.setStatus(
        translateText(validation.error || "clan.invalid_name") ||
          "Clan name is invalid.",
        "error",
      );
      return;
    }
    this.isProcessing = true;
    try {
      this.clan = await renameClan(this.authUser.uid, this.clan.id, name);
      this.renameName = this.clan.name;
      this.setStatus(
        translateText("clan.renamed_success") || "Clan renamed.",
        "success",
      );
    } catch (err: any) {
      this.handleError(err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleDisband() {
    if (!this.authUser || !this.clan) return;
    this.isProcessing = true;
    try {
      await disbandClan(this.authUser.uid, this.clan.id);
      this.clan = null;
      this.setStatus(
        translateText("clan.disbanded_success") || "Clan disbanded.",
        "success",
      );
    } catch (err: any) {
      this.handleError(err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleKick(memberUid: string) {
    if (!this.authUser || !this.clan) return;
    this.isProcessing = true;
    try {
      this.clan = await kickMember(this.authUser.uid, this.clan.id, memberUid);
      this.setStatus(
        translateText("clan.kicked_success") || "Member removed.",
        "success",
      );
    } catch (err: any) {
      this.handleError(err);
    } finally {
      this.isProcessing = false;
    }
  }

  private handleError(err: any) {
    console.error("Clan action failed", err);
    const code = err?.code || err?.message;
    const lookup: Record<string, string> = {
      clan_name_taken: "clan.name_taken",
      already_in_clan: "clan.already_in_clan",
      clan_not_found: "clan.not_found",
      not_leader: "clan.not_leader",
      leader_cannot_leave: "clan.leader_leave_blocked",
      firebase_not_configured: "clan.login_required_action",
    };
    const key = lookup[code] || "clan.action_failed";
    this.setStatus(
      translateText(key) || "Unable to complete clan action.",
      "error",
    );
  }
}
