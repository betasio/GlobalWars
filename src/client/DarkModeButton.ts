import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserSettings } from "../core/game/UserSettings";

@customElement("dark-mode-button")
export class DarkModeButton extends LitElement {
  private userSettings: UserSettings = new UserSettings();
  @state() private darkMode: boolean = this.userSettings.darkMode();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("dark-mode-changed", this.handleDarkModeChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("dark-mode-changed", this.handleDarkModeChanged);
  }

  private handleDarkModeChanged = (e: Event) => {
    const event = e as CustomEvent<{ darkMode: boolean }>;
    this.darkMode = event.detail.darkMode;
  };

  toggleDarkMode() {
    this.userSettings.toggleDarkMode();
    this.darkMode = this.userSettings.darkMode();
  }

  render() {
    return html`
      <button
        title="Toggle Dark Mode"
        class="absolute top-2 left-2 md:top-[10px] md:left-[10px] w-12 h-12 rounded-full border border-white/15 shadow-xl bg-gradient-to-br from-[#1c0f2b] via-[#2b0f45] to-[#4c1d95] text-white text-xl flex items-center justify-center transition-all duration-200 hover:scale-105 hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-[#a855f7]/50"
        @click=${() => this.toggleDarkMode()}
      >
        ${this.darkMode ? "☀️" : "🌙"}
      </button>
    `;
  }
}
