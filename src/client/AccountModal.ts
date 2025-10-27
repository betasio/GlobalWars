import { html, LitElement, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import "./components/Difficulties";
import "./components/PatternButton";
import { getApiBase, getUserMe, loginWithGoogle, logOut } from "./jwt";
import { isInIframe, translateText } from "./Utils";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id: {
          initialize: (options: Record<string, unknown>) => void;
          prompt: (callback?: (notification: unknown) => void) => void;
        };
      };
    };
  }
}

let googleSdkPromise: Promise<void> | null = null;

async function loadGoogleIdentitySdk(): Promise<void> {
  if (window.google?.accounts?.id) {
    return;
  }
  if (googleSdkPromise) {
    return googleSdkPromise;
  }
  googleSdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
  return googleSdkPromise;
}

@customElement("account-modal")
export class AccountModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private email: string = "";

  private loggedInEmail: string | null = null;
  private loggedInUsername: string | null = null;
  private googleClientId: string | null = null;
  private googleInitialized = false;

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
    if (this.loggedInEmail || this.loggedInUsername) {
      return this.renderLoggedInAccount();
    }
    return this.renderLoginOptions();
  }

  private renderLoggedInAccount(): TemplateResult {
    const displayName = this.loggedInUsername ?? this.loggedInEmail ?? "";
    const subtitle = this.loggedInEmail
      ? translateText("account_modal.logged_in_as", {
          email: this.loggedInEmail,
        })
      : translateText("account_modal.logged_in");
    return html`
      <div class="p-6">
        <div class="mb-4">
          <p class="text-white text-center mb-2 font-semibold text-lg">
            ${displayName}
          </p>
          ${subtitle
            ? html`<p class="text-center text-sm text-gray-300">${subtitle}</p>`
            : null}
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
      <div class="p-6">
        <div class="mb-6">
          <h3 class="text-lg font-medium text-white mb-4 text-center">
            Choose your login method
          </h3>

          <!-- Google Login Button -->
          <div class="mb-6">
            <button
              @click="${this.handleGoogleLogin}"
              class="w-full px-6 py-3 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200 flex items-center justify-center gap-2"
            >
              <span class="text-lg">🔒</span>
              <span
                >${translateText("account_modal.login_google") ||
                "Sign in with Google"}</span
              >
            </button>
          </div>

          <!-- Email Recovery -->
          <div class="mb-4">
            <label
              for="email"
              class="block text-sm font-medium text-white mb-2"
            >
              Recover account by email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              .value="${this.email}"
              @input="${this.handleEmailInput}"
              class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
              placeholder="Enter your email address"
              required
            />
          </div>
        </div>

        <div class="flex justify-end space-x-3">
          <button
            @click="${this.close}"
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            @click="${this.handleSubmit}"
            class="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Submit
          </button>
        </div>
      </div>
    `;
  }

  private handleEmailInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.email = target.value;
  }

  private async handleSubmit() {
    if (!this.email) {
      alert("Please enter an email address");
      return;
    }

    try {
      const apiBase = getApiBase();
      const response = await fetch(`${apiBase}/magic-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          redirectDomain: window.location.origin,
          email: this.email,
        }),
      });

      if (response.ok) {
        alert(
          translateText("account_modal.recovery_email_sent", {
            email: this.email,
          }),
        );
        this.close();
      } else {
        console.error(
          "Failed to send recovery email:",
          response.status,
          response.statusText,
        );
        alert("Failed to send recovery email. Please try again.");
      }
    } catch (error) {
      console.error("Error sending recovery email:", error);
      alert("Error sending recovery email. Please try again.");
    }
  }

  private async handleGoogleLogin() {
    try {
      if (!this.googleClientId) {
        const config = await getServerConfigFromClient();
        this.googleClientId = config.googleClientId();
      }
      if (!this.googleClientId) {
        alert("Google login is not configured yet. Please try again later.");
        return;
      }
      await loadGoogleIdentitySdk();
      const google = window.google;
      if (!google?.accounts?.id) {
        throw new Error("Google Identity Services not available");
      }
      if (!this.googleInitialized) {
        google.accounts.id.initialize({
          client_id: this.googleClientId,
          ux_mode: "popup",
          callback: async (response: { credential?: string }) => {
            if (!response.credential) return;
            const profile = await loginWithGoogle(response.credential);
            if (profile) {
              this.loggedInEmail = profile.user.email ?? null;
              this.loggedInUsername = profile.player.username ?? null;
              document.dispatchEvent(
                new CustomEvent("userMeResponse", {
                  detail: profile,
                  bubbles: true,
                  composed: true,
                }),
              );
              this.requestUpdate();
            }
          },
        });
        this.googleInitialized = true;
      }
      google.accounts.id.prompt();
    } catch (error) {
      console.error("Unable to launch Google login", error);
      alert("Unable to start Google login. Please try again later.");
    }
  }

  public async open() {
    const userMe = await getUserMe();
    if (userMe) {
      this.loggedInEmail = userMe.user.email ?? null;
      this.loggedInUsername = userMe.player.username ?? null;
    }
    this.modalEl?.open();
    this.requestUpdate();
  }

  public close() {
    this.modalEl?.close();
  }

  private async handleLogout() {
    await logOut();
    this.close();
    // Refresh the page after logout to update the UI state
    window.location.reload();
  }
}

@customElement("account-button")
export class AccountButton extends LitElement {
  @state() private loggedInEmail: string | null = null;
  @state() private loggedInUsername: string | null = null;

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
        }
        if (userMeResponse.player.username) {
          this.loggedInUsername = userMeResponse.player.username;
        }
        this.requestUpdate();
      } else {
        // Clear the logged in states when user logs out
        this.loggedInEmail = null;
        this.loggedInUsername = null;
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
    } else if (this.loggedInUsername) {
      buttonTitle =
        translateText("account_modal.logged_in_username", {
          username: this.loggedInUsername,
        }) ?? `Logged in as ${this.loggedInUsername}`;
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
    if (this.loggedInEmail) {
      return html`<img
        src="/images/EmailIcon.svg"
        alt="Email"
        class="w-6 h-6"
      />`;
    } else if (this.loggedInUsername) {
      return html`<span class="text-lg">👤</span>`;
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
