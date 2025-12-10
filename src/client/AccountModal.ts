import { html, LitElement, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import {
  ensureFirebaseReady,
  loginWithGoogle,
  logoutFirebase,
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
        ${this.logoutButton()}
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

    void ensureFirebaseReady()
      .then(({ configured, user }) => {
        this.firebaseConfigured = configured;
        this.loggedInEmail = user?.email ?? null;
      })
      .catch((err) => {
        console.warn("Failed to initialize Firebase auth", err);
        this.firebaseConfigured = false;
        this.loggedInEmail = null;
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
