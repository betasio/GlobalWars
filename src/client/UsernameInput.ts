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
import { ensureFirebaseReady } from "./firebaseAuth";

const usernameKeyPrefix: string = "username";

@customElement("username-input")
export class UsernameInput extends LitElement {
  @state() private username: string = "";
  @property({ type: String }) validationError: string = "";
  private _isValid: boolean = true;
  @state() private isGuest: boolean = true;
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
      this.applyAuthUser(detail ?? null, true);
    };
    document.addEventListener(
      "firebase-auth-changed",
      this.authListener as EventListener,
    );

    void ensureFirebaseReady()
      .then(({ user, configured }) => {
        this.applyAuthUser(configured ? user : null, configured);
      })
      .catch(() => {
        this.applyAuthUser(null, false);
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
        @input=${this.handleChange}
        @change=${this.handleChange}
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
      ${this.isGuest
        ? html`<p
            class="mt-2 text-sm text-gray-500 dark:text-gray-300 text-center"
          >
            ${translateText("username.guest_autogen") ||
            "Guest names are assigned automatically and reset each session."}
          </p>`
        : null}
    `;
  }

  private handleChange(e: Event) {
    if (this.isGuest) {
      return;
    }
    const input = e.target as HTMLInputElement;
    this.username = input.value.trim();
    const result = validateUsername(this.username);
    this._isValid = result.isValid;
    if (result.isValid) {
      if (this.currentUserId) {
        this.storeUsername(this.currentUserId, this.username);
      }
      this.validationError = "";
      this.dispatchUsernameEvent();
    } else {
      this.validationError = result.error ?? "";
    }
  }

  private applyAuthUser(user: any | null, configured: boolean) {
    const loggedIn = configured && !!user;
    this.isGuest = !loggedIn;
    this.currentUserId = loggedIn ? (user?.uid ?? null) : null;

    if (loggedIn && this.currentUserId) {
      const stored = this.getStoredUsername(this.currentUserId);
      const newName = stored ?? this.generateRegisteredUsername(user);
      this.username = newName;
      this._isValid = true;
      this.validationError = "";
      this.storeUsername(this.currentUserId, newName);
    } else {
      this.username = this.generateGuestUsername();
      this._isValid = true;
      this.validationError = "";
    }

    this.dispatchUsernameEvent();
  }

  private getStoredUsername(uid: string): string | null {
    const storedUsername = localStorage.getItem(this.getStorageKeyForUser(uid));
    return storedUsername ?? null;
  }

  private storeUsername(uid: string, username: string) {
    if (username && uid) {
      localStorage.setItem(this.getStorageKeyForUser(uid), username);
    }
  }

  private getStorageKeyForUser(uid: string) {
    return `${usernameKeyPrefix}:${uid}`;
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
