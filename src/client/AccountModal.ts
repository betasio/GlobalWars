import { html, LitElement, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import "./components/Difficulties";
import "./components/PatternButton";
import { getUserMe, googleLogin, logOut } from "./jwt";
import { isInIframe, translateText } from "./Utils";

@customElement("account-modal")
export class AccountModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  private loggedInEmail: string | null = null;
  private loggedInDiscord: string | null = null;

  @state()
  private showRankedAuthPrompt = false;

  constructor() {
    super();
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
    if (this.loggedInDiscord) {
      return this.renderLoggedInDiscord();
    } else if (this.loggedInEmail) {
      return this.renderLoggedInEmail();
    } else {
      return this.renderLoginOptions();
    }
  }

  private renderLoggedInDiscord() {
    return html`
      <div class="p-6">
        <div class="mb-4">
          <p class="text-white text-center mb-4">
            Logged in with Discord as ${this.loggedInDiscord}
          </p>
        </div>
        ${this.logoutButton()}
      </div>
    `;
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
    return html`
      <div class="p-6 space-y-6">
        <div class="text-center space-y-2">
          <h3 class="text-lg font-medium text-white">
            ${translateText("account_modal.choose_login") ||
            "Sign in to Global Wars"}
          </h3>
          <p class="text-sm text-gray-300">
            ${translateText("account_modal.google_only_copy") ||
            "Use your Google account to continue."}
          </p>
        </div>
        <div>
          <button
            @click="${this.handleGoogleLogin}"
            class="w-full px-6 py-3 text-sm font-medium text-gray-900 bg-white border border-transparent rounded-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors duration-200 flex items-center justify-center space-x-2"
          >
            <img src="/images/GoogleLogo.svg" alt="Google" class="w-5 h-5" />
            <span
              >${translateText("main.login_google") ||
              "Login with Google"}</span
            >
          </button>
        </div>
      </div>
    `;
  }

  private readonly handleGoogleLogin = () => {
    googleLogin();
  };

  public readonly open = async () => {
    const userMe = await getUserMe();
    if (userMe) {
      this.loggedInEmail = userMe.user.email ?? null;
      this.loggedInDiscord = userMe.user.discord?.global_name ?? null;
    }
    this.showRankedAuthPrompt = options?.showRankedAuthPrompt ?? false;
    this.modalEl?.open();
    this.requestUpdate();
  };

  public readonly close = () => {
    this.modalEl?.close();
  };

  private readonly handleLogout = async () => {
    await logOut();
    this.close();
    // Refresh the page after logout to update the UI state
    window.location.reload();
  };
}

@customElement("account-button")
export class AccountButton extends LitElement {
  @state() private loggedInEmail: string | null = null;
  @state() private loggedInDiscord: string | null = null;

  private isVisible = true;

  @query("account-modal") private recoveryModal!: AccountModal;

  constructor() {
    super();

    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;

      if (customEvent.detail) {
        const userMeResponse = customEvent.detail as UserMeResponse;
        if (userMeResponse.user.email) {
          this.loggedInEmail = userMeResponse.user.email;
          this.requestUpdate();
        } else if (userMeResponse.user.discord) {
          this.loggedInDiscord = userMeResponse.user.discord.id;
          this.requestUpdate();
        }
      } else {
        // Clear the logged in states when user logs out
        this.loggedInEmail = null;
        this.loggedInDiscord = null;
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
    } else if (this.loggedInDiscord) {
      buttonTitle = translateText("account_modal.logged_in_with_discord");
    }

    return html`
      <div class="fixed top-4 right-4 z-[9999]">
        <button
          @click="${this.open}"
          class="w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-200 flex items-center justify-center text-xl focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-offset-4"
          title="${buttonTitle}"
        >
          ${this.renderIcon()}
        </button>
      </div>
      <account-modal></account-modal>
    `;
  }

  private renderIcon() {
    if (this.loggedInDiscord) {
      return html`<img
        src="/images/DiscordLogo.svg"
        alt="Discord"
        class="w-6 h-6"
      />`;
    } else if (this.loggedInEmail) {
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
