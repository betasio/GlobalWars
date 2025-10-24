import { LitElement, css, html } from "lit";
import { resolveMarkdown } from "lit-markdown";
import { customElement, property, query } from "lit/decorators.js";
import changelog from "../../resources/changelog.md";
import { translateText } from "../client/Utils";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";

@customElement("news-modal")
export class NewsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  @property({ type: String }) markdown = "Loading...";

  private initialized: boolean = false;

  static styles = css`
    :host {
      display: block;
    }

    .news-container {
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .news-content {
      color: rgba(221, 237, 255, 0.92);
      line-height: 1.6;
      background: rgba(7, 29, 54, 0.8);
      border-radius: 12px;
      border: 1px solid rgba(118, 198, 255, 0.24);
      padding: 1.25rem;
      box-shadow: 0 24px 45px rgba(3, 12, 25, 0.45);
    }

    .news-content a {
      color: #61e6ff !important;
      text-decoration: underline !important;
      text-decoration-thickness: 2px !important;
      text-underline-offset: 6px !important;
      transition:
        color 0.2s ease,
        text-decoration-color 0.2s ease;
    }

    .news-content a:hover {
      color: #ff6b91 !important;
      text-decoration-color: rgba(255, 107, 145, 0.8) !important;
    }
  `;

  render() {
    return html`
      <o-modal title=${translateText("news.title")}>
        <div class="options-layout">
          <div class="options-section">
            <div class="news-container">
              <div class="news-content">
                ${resolveMarkdown(this.markdown, {
                  includeImages: true,
                  includeCodeBlockClassNames: true,
                })}
              </div>
            </div>
          </div>
        </div>

        <div>
          ${translateText("news.see_all_releases")}
          <a
            href="https://github.com/globalwars-game/GlobalWars/releases"
            target="_blank"
            rel="noreferrer"
            >${translateText("news.github_link")}</a
          >.
        </div>

        <o-button
          title=${translateText("common.close")}
          @click=${this.close}
          blockDesktop
        ></o-button>
      </o-modal>
    `;
  }

  public open() {
    if (!this.initialized) {
      this.initialized = true;
      fetch(changelog)
        .then((response) => (response.ok ? response.text() : "Failed to load"))
        .then((markdown) =>
          markdown
            .replace(
              /(?<!\()\bhttps:\/\/github\.com\/openfrontio\/OpenFrontIO\/pull\/(\d+)\b/g,
              (_match, prNumber) =>
                `[#${prNumber}](https://github.com/globalwars-game/GlobalWars/pull/${prNumber})`,
            )
            .replace(
              /(?<!\()\bhttps:\/\/github\.com\/openfrontio\/OpenFrontIO\/compare\/([\w.-]+)\b/g,
              (_match, comparison) =>
                `[${comparison}](https://github.com/globalwars-game/GlobalWars/compare/${comparison})`,
            ),
        )
        .then((markdown) => (this.markdown = markdown));
    }
    this.requestUpdate();
    this.modalEl?.open();
  }

  private close() {
    this.modalEl?.close();
  }
}
