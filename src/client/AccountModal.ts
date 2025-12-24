import { html, LitElement, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import {
  deleteAccountAndData,
  ensureFirebaseReady,
  fetchPlayerRankSummary,
  loginWithGoogle,
  logoutFirebase,
  PlayerRankSummary,
} from "./firebaseAuth";
import { isInIframe, translateText } from "./Utils";

@customElement("account-modal")
export class AccountModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private isLoadingUser: boolean = false;
  @state() private firebaseConfigured = true;
  @state() private authError: string | null = null;
  @state() private rankSummary: PlayerRankSummary | null = null;
  @state() private isLoadingRank: boolean = false;
  @state() private deleteConfirmValue: string = "";
  @state() private deleteError: string | null = null;
  @state() private isDeletingAccount: boolean = false;

  private loggedInEmail: string | null = null;

  constructor() {
    super();

    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        const userMeResponse = customEvent.detail as UserMeResponse;
        this.loggedInEmail = userMeResponse?.user?.email ?? null;
      } else {
        this.loggedInEmail = null;
        this.requestUpdate();
      }
    });
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <o-modal
        id="account-modal"
        title="${translateText("account_modal.title") || "Account"}"
      >
        ${this.renderInner()}
      </o-modal>
    `;
  }

  private renderInner() {
    if (this.isLoadingUser) {
      return html`
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-2">${translateText("account_modal.fetching_account")}</p>
          <div
            class="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
          ></div>
        </div>
      `;
    }
    if (this.loggedInEmail) {
      return this.renderLoggedInEmail();
    } else {
      return this.renderLoginOptions();
    }
  }

  private renderLoggedInEmail(): TemplateResult {
    return html`
      <div class="p-6">
        <div class="mb-4">
          <p class="text-white text-center mb-4">
            Logged in as ${this.loggedInEmail}
          </p>
        </div>
        ${this.renderRankBlock()}
        <div class="mt-6 flex flex-col gap-3">
          ${this.logoutButton()} ${this.renderDeleteAccount()}
        </div>
      </div>
    `;
  }

  private logoutButton(): TemplateResult {
    return html`
      <button
        @click="${this.handleLogout}"
        class="px-6 py-3 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors duration-200"
      >
        Log Out
      </button>
    `;
  }

  private renderRankBlock(): TemplateResult {
    if (this.isLoadingRank) {
      return html`<div class="flex items-center justify-center text-gray-200">
        <span class="text-sm mr-3">Loading rank...</span>
        <div
          class="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"
        ></div>
      </div>`;
    }

    if (!this.rankSummary) {
      return html`<div class="text-center text-gray-300 text-sm">
        Rank data unavailable.
      </div>`;
    }

    const tier = this.rankSummary.tier;
    const hasPosition = Number.isFinite(this.rankSummary.position);

    return html`
      <div
        class="flex flex-col items-center gap-2 rounded-xl bg-slate-800/70 p-4 border border-white/10"
      >
        <div class="flex items-center gap-3">
          <img src="${tier.logo}" alt="${tier.name}" class="w-10 h-10" />
          <div class="text-left">
            <div class="text-sm text-gray-300">Current Tier</div>
            <div class="text-lg font-semibold text-white">${tier.name}</div>
          </div>
        </div>
        <div
          class="flex flex-wrap items-center justify-center gap-3 text-sm text-gray-200"
        >
          <span
            class="px-3 py-1 rounded-full bg-slate-700/80 border border-white/10"
          >
            Rank Points: ${this.rankSummary.rankPoints}
          </span>
          <span
            class="px-3 py-1 rounded-full bg-slate-700/80 border border-white/10"
          >
            ${hasPosition
              ? `Leaderboard Rank: #${this.rankSummary.position}`
              : "Leaderboard Rank: --"}
          </span>
        </div>
      </div>
    `;
  }

  private renderDeleteAccount(): TemplateResult {
    const disabled =
      this.isDeletingAccount ||
      !this.loggedInEmail ||
      this.deleteConfirmValue.trim().toLowerCase() !==
        (this.loggedInEmail ?? "").toLowerCase();

    return html`
      <div class="p-4 rounded-xl border border-red-500/30 bg-red-900/10">
        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="text-white font-semibold">Delete account</div>
            <p class="text-xs text-gray-300">
              Type your email (${this.loggedInEmail}) to confirm deletion.
            </p>
          </div>
          <button
            @click="${this.handleDeleteAccount}"
            class="px-4 py-2 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            ?disabled=${disabled}
          >
            ${this.isDeletingAccount ? "Deleting..." : "Delete"}
          </button>
        </div>
        <input
          type="email"
          class="w-full px-3 py-2 rounded-md bg-slate-900 border border-white/10 text-white text-sm"
          placeholder="Confirm email"
          .value=${this.deleteConfirmValue}
          @input=${(e: Event) => {
            const target = e.target as HTMLInputElement;
            this.deleteConfirmValue = target.value;
            this.deleteError = null;
          }}
        />
        ${this.deleteError
          ? html`<p class="mt-2 text-xs text-red-400">${this.deleteError}</p>`
          : html``}
      </div>
    `;
  }

  private renderLoginOptions() {
    if (!this.firebaseConfigured) {
      return html`<div class="p-6 text-center text-white">
        <p class="mb-2">${translateText("account_modal.no_auth")}</p>
        <p class="text-sm text-gray-300">
          ${translateText("account_modal.no_auth_detail")}
        </p>
      </div>`;
    }
    return html`
      <div class="p-6">
        <div class="mb-6">
          <h3 class="text-lg font-medium text-white mb-4 text-center">
            ${translateText("account_modal.google_only") || "Login with Google"}
          </h3>
          <div class="mb-4 flex flex-col items-center gap-3">
            <button
              @click="${this.handleGoogleLogin}"
              class="w-full px-6 py-3 text-sm font-medium text-gray-800 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200 flex items-center justify-center space-x-2 disabled:opacity-60"
              ?disabled=${!this.firebaseConfigured}
            >
              <img src="/images/GoogleLogo.svg" alt="Google" class="w-5 h-5" />
              <span
                >${translateText("main.login_google") ||
                "Login with Google"}</span
              >
            </button>
            ${this.authError
              ? html`<p class="text-sm text-red-400 text-center">
                  ${this.authError}
                </p>`
              : null}
          </div>
        </div>
      </div>
    `;
  }

  private async handleGoogleLogin() {
    this.authError = null;
    try {
      const user = await loginWithGoogle();
      if (user?.email) {
        this.loggedInEmail = user.email;
        this.authError = null;
      } else {
        this.authError =
          translateText("account_modal.no_auth") || "Google login unavailable.";
      }
      this.requestUpdate();
    } catch (err) {
      console.error("Google login failed", err);
      this.authError =
        translateText("account_modal.google_error") ||
        "Unable to login with Google.";
    }
  }

  public open() {
    this.modalEl?.open();
    this.isLoadingUser = true;
    this.isLoadingRank = true;
    this.rankSummary = null;
    this.deleteConfirmValue = "";
    this.deleteError = null;

    void ensureFirebaseReady()
      .then(({ configured, user }) => {
        this.firebaseConfigured = configured;
        this.loggedInEmail = user?.email ?? null;
        const uid = user?.uid ?? null;
        if (uid) {
          void this.loadRankSummary(uid);
        } else {
          this.isLoadingRank = false;
        }
      })
      .catch((err) => {
        console.warn("Failed to initialize Firebase auth", err);
        this.firebaseConfigured = false;
        this.loggedInEmail = null;
        this.isLoadingRank = false;
      })
      .finally(() => {
        this.isLoadingUser = false;
        this.requestUpdate();
      });
  }

  public close() {
    this.modalEl?.close();
  }

  private async handleLogout() {
    await logoutFirebase();
    this.close();
    // Refresh the page after logout to update the UI state
    window.location.reload();
  }

  private async loadRankSummary(uid: string) {
    this.isLoadingRank = true;
    try {
      this.rankSummary = await fetchPlayerRankSummary(uid);
    } catch (err) {
      console.warn("Failed to fetch player rank summary", err);
      this.rankSummary = null;
    } finally {
      this.isLoadingRank = false;
      this.requestUpdate();
    }
  }

  private async handleDeleteAccount() {
    if (!this.loggedInEmail) return;
    if (
      this.deleteConfirmValue.trim().toLowerCase() !==
      this.loggedInEmail.toLowerCase()
    ) {
      this.deleteError = "Email does not match";
      return;
    }

    this.deleteError = null;
    this.isDeletingAccount = true;
    try {
      await deleteAccountAndData(this.deleteConfirmValue.trim());
      window.location.reload();
    } catch (err: any) {
      const code = err?.code ?? err?.message ?? "delete_failed";
      this.deleteError =
        code === "email_mismatch"
          ? "Email confirmation does not match your account."
          : code === "auth/requires-recent-login"
            ? "Please log in again before deleting your account."
            : "Failed to delete account. Please try again.";
      console.error("Failed to delete account", err);
    } finally {
      this.isDeletingAccount = false;
      this.requestUpdate();
    }
  }
}

@customElement("account-button")
export class AccountButton extends LitElement {
  @state() private loggedInEmail: string | null = null;

  private isVisible = true;

  @query("account-modal") private recoveryModal: AccountModal;

  constructor() {
    super();

    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;

      if (customEvent.detail) {
        const userMeResponse = customEvent.detail as UserMeResponse;
        if (userMeResponse.user.email) {
          this.loggedInEmail = userMeResponse.user.email;
          this.requestUpdate();
        }
      } else {
        // Clear the logged in states when user logs out
        this.loggedInEmail = null;
        this.requestUpdate();
      }
    });
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (isInIframe()) {
      return html``;
    }

    if (!this.isVisible) {
      return html``;
    }

    let buttonTitle = "";
    if (this.loggedInEmail) {
      buttonTitle = translateText("account_modal.logged_in_as", {
        email: this.loggedInEmail,
      });
    }

    const buttonClass =
      "inline-flex items-center gap-2 px-4 py-2.5 min-w-[130px] justify-center rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white font-semibold tracking-wide shadow-[0_10px_35px_rgba(59,130,246,0.35)] border border-white/25 hover:shadow-[0_16px_45px_rgba(99,102,241,0.35)] hover:-translate-y-0.5 active:translate-y-0 transition duration-200 backdrop-blur-xl focus:outline-none focus:ring-2 focus:ring-cyan-200/80 focus:ring-offset-2 focus:ring-offset-slate-900 dark:focus:ring-offset-slate-950";

    return html`
      <button
        @click="${this.open}"
        class="${buttonClass}"
        title="${buttonTitle}"
        aria-label="${buttonTitle || translateText("account_modal.title")}"
      >
        ${this.renderIcon()}
        <span class="text-sm md:text-base">
          ${translateText("account_modal.title") || "Account"}
        </span>
      </button>
      <account-modal></account-modal>
    `;
  }

  private renderIcon() {
    if (this.loggedInEmail) {
      return html`<img
        src="/images/EmailIcon.svg"
        alt="Email"
        class="w-6 h-6"
      />`;
    }
    return html`<img
      src="/images/LoggedOutIcon.svg"
      alt="Logged Out"
      class="w-6 h-6"
    />`;
  }

  private open() {
    this.recoveryModal?.open();
  }

  public close() {
    this.isVisible = false;
    this.recoveryModal?.close();
    this.requestUpdate();
  }
}
