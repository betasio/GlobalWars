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
    const label = this.darkMode ? "Light Mode" : "Dark Mode";

    const buttonClass =
      "fixed top-4 left-4 z-[9999] inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-slate-900/75 text-cyan-50 border border-white/15 shadow-[0_10px_30px_rgba(15,23,42,0.65)] backdrop-blur-xl transition duration-200 hover:border-cyan-300/60 hover:shadow-[0_16px_40px_rgba(59,130,246,0.35)] hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-cyan-200/80 focus:ring-offset-2 focus:ring-offset-slate-900 dark:bg-slate-950/80";

    return html`
      <button
        title="Toggle Dark Mode"
        class="${buttonClass}"
        aria-pressed="${this.darkMode}"
        @click=${() => this.toggleDarkMode()}
      >
        <span
          class="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 text-slate-900 text-lg font-bold shadow-inner shadow-cyan-200/60"
        >
          ${this.darkMode ? "☀" : "☾"}
        </span>
        <span class="text-sm font-semibold tracking-wide">${label}</span>
      </button>
    `;
  }
}
