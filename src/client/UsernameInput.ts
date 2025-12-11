import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { v4 as uuidv4 } from "uuid";
import { translateText } from "../client/Utils";
import { UserSettings } from "../core/game/UserSettings";
import {
  MAX_USERNAME_LENGTH,
  sanitizeUsername,
  validateUsername,
} from "../core/validations/username";
import {
  claimUsername,
  ensureFirebaseReady,
  fetchStoredUsername,
} from "./firebaseAuth";

@customElement("username-input")
export class UsernameInput extends LitElement {
  @state() private username: string = "";
  @property({ type: String }) validationError: string = "";
  private _isValid: boolean = true;
  @state() private isGuest: boolean = true;
  private lastSavedUsername: string | null = null;
  private currentUserId: string | null = null;
  private userSettings: UserSettings = new UserSettings();
  private authListener: ((event: Event) => void) | null = null;

  // Remove static styles since we're using Tailwind

  createRenderRoot() {
    // Disable shadow DOM to allow Tailwind classes to work
    return this;
  }

  public getCurrentUsername(): string {
    return this.username;
  }

  connectedCallback() {
    super.connectedCallback();
    this.authListener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      void this.applyAuthUser(detail ?? null, true);
    };
    document.addEventListener(
      "firebase-auth-changed",
      this.authListener as EventListener,
    );

    void ensureFirebaseReady()
      .then(({ user, configured }) => {
        void this.applyAuthUser(configured ? user : null, configured);
      })
      .catch(() => {
        void this.applyAuthUser(null, false);
      });
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
      <input
        type="text"
        .value=${this.username}
        @input=${this.handleInput}
        @keydown=${this.handleKeydown}
        placeholder="${translateText("username.enter_username")}"
        maxlength="${MAX_USERNAME_LENGTH}"
        ?disabled=${this.isGuest}
        class="w-full px-4 py-2 border border-gray-300 rounded-xl shadow-sm text-2xl text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:border-gray-300/60 dark:bg-gray-700 dark:text-white ${this
          .isGuest
          ? "opacity-80 cursor-not-allowed"
          : ""}"
      />
      ${this.validationError
        ? html`<div
            id="username-validation-error"
            class="absolute z-10 w-full mt-2 px-3 py-1 text-lg border rounded bg-white text-red-600 border-red-600 dark:bg-gray-700 dark:text-red-300 dark:border-red-300"
          >
            ${this.validationError}
          </div>`
        : null}
      ${!this.isGuest
        ? html`<div class="mt-3 flex justify-center">
            <button
              class="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white shadow disabled:opacity-60 disabled:cursor-not-allowed"
              @click=${this.saveUsername}
              ?disabled=${!this._isValid ||
              this.lastSavedUsername === this.username.trim()}
            >
              ${translateText("username.save") || "Save username"}
            </button>
          </div>`
        : null}
    `;
  }

  private handleInput(e: Event) {
    if (this.isGuest) {
      return;
    }
    const input = e.target as HTMLInputElement;
    const sanitizedInput = input.value.replace(/\s+/g, "");
    this.username = sanitizedInput;
    if (input.value !== sanitizedInput) {
      input.value = sanitizedInput;
    }
    const result = validateUsername(this.username.trim());
    this._isValid = result.isValid;
    this.validationError = result.error ?? "";
  }

  private handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void this.saveUsername();
    }
  }

  private async saveUsername() {
    if (this.isGuest || !this.currentUserId) {
      return;
    }

    const trimmed = this.username.trim();
    const result = validateUsername(trimmed);
    this._isValid = result.isValid;
    this.validationError = result.error ?? "";

    if (!result.isValid) {
      return;
    }

    if (this.lastSavedUsername === trimmed) {
      return;
    }

    await this.commitUsername(this.currentUserId, trimmed, false);
  }

  private async applyAuthUser(user: any | null, configured: boolean) {
    const loggedIn = configured && !!user;
    this.isGuest = !loggedIn;
    this.currentUserId = loggedIn ? (user?.uid ?? null) : null;

    if (loggedIn && this.currentUserId) {
      const stored = await fetchStoredUsername(this.currentUserId);
      const proposed = stored ?? this.generateRegisteredUsername(user);
      const claimed = await this.commitUsername(
        this.currentUserId,
        proposed,
        true,
      );
      this.username = claimed;
      this.lastSavedUsername = claimed;
      this._isValid = true;
      this.validationError = "";
    } else {
      this.username = this.generateGuestUsername();
      this.lastSavedUsername = null;
      this._isValid = true;
      this.validationError = "";
      this.dispatchUsernameEvent();
    }
  }

  private generateRegisteredUsername(user: any): string {
    const candidate = sanitizeUsername(
      user?.displayName ?? user?.email?.split("@")[0] ?? "Player",
    );
    if (candidate && validateUsername(candidate).isValid) {
      return candidate;
    }
    const suffix = (user?.uid ?? "user").slice(0, 6);
    return `Player-${suffix}`;
  }

  private generateGuestUsername(): string {
    const random = Math.floor(Math.random() * 900) + 100;
    return `Guest${random}`;
  }

  private async commitUsername(
    uid: string,
    username: string,
    allowAutoFallback: boolean,
  ): Promise<string> {
    const validated = validateUsername(username.trim());
    if (!validated.isValid) {
      this.validationError = validated.error ?? "";
      this._isValid = false;
      return username;
    }

    const attemptClaim = async (
      name: string,
      attempts: number = 0,
    ): Promise<string> => {
      try {
        await claimUsername(uid, name.trim());
        this.validationError = "";
        this._isValid = true;
        this.username = name.trim();
        this.lastSavedUsername = this.username;
        this.dispatchUsernameEvent();
        return this.username;
      } catch (err: any) {
        if (err?.code === "username_taken") {
          if (allowAutoFallback) {
            if (attempts >= 5) {
              this.validationError =
                translateText("username.taken") ||
                "That username is already taken.";
              this._isValid = false;
              return name;
            }
            return attemptClaim(
              this.generateFallbackUsername(uid),
              attempts + 1,
            );
          }
          this.validationError =
            translateText("username.taken") ||
            "That username is already taken.";
          this._isValid = false;
          return name;
        }

        this.validationError =
          translateText("username.save_failed") || "Failed to save username.";
        this._isValid = false;
        console.error("Failed to save username", err);
        return name;
      }
    };

    return attemptClaim(username);
  }

  private generateFallbackUsername(uid: string): string {
    const suffix = uid.slice(0, 4);
    const random = Math.floor(Math.random() * 900) + 100;
    return `Player-${suffix}-${random}`;
  }

  private dispatchUsernameEvent() {
    this.dispatchEvent(
      new CustomEvent("username-change", {
        detail: { username: this.username },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private generateNewUsername(): string {
    const newUsername = "Anon" + this.uuidToThreeDigits();
    return newUsername;
  }

  private uuidToThreeDigits(): string {
    const uuid = uuidv4();
    const cleanUuid = uuid.replace(/-/g, "").toLowerCase();
    const decimal = BigInt(`0x${cleanUuid}`);
    const threeDigits = decimal % 1000n;
    return threeDigits.toString().padStart(3, "0");
  }

  public isValid(): boolean {
    return this._isValid;
  }
}
