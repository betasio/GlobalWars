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
        class="ui-controls__button"
        @click=${() => this.toggleDarkMode()}
      >
        <span class="ui-controls__icon text-lg">
          ${this.darkMode ? "☀️" : "🌙"}
        </span>
      </button>
    `;
  }
}
