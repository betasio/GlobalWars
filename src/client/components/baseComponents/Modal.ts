import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

@customElement("o-modal")
export class OModal extends LitElement {
  @state() public isModalOpen = false;
  @property({ type: String }) title = "";
  @property({ type: String }) translationKey = "";
  @property({ type: Boolean }) alwaysMaximized = false;

  static styles = css`
    .c-modal {
      position: fixed;
      padding: 1rem;
      z-index: 9999;
      left: 0;
      bottom: 0;
      right: 0;
      top: 0;
      background-color: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(5px);
      -webkit-backdrop-filter: blur(5px);
      overflow-y: auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .c-modal__wrapper {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      min-width: 340px;
      max-width: 860px;
      color: #fff;
      overflow: hidden;
    }

    .c-modal__wrapper.always-maximized {
      width: 100%;
      min-width: 340px;
      max-width: 860px;
      min-height: 320px;
      /* Fallback for older browsers */
      height: 60vh;
      /* Use dvh if supported for dynamic viewport handling */
      height: 60dvh;
    }

    .c-modal__header {
      position: relative;
      font-size: 24px;
      font-weight: 600;
      background: rgba(0, 0, 0, 0.2);
      text-align: center;
      padding: 1.5rem;
    }

    .c-modal__close {
      cursor: pointer;
      position: absolute;
      right: 1.5rem;
      top: 50%;
      transform: translateY(-50%);
      width: 32px;
      height: 32px;
      background-color: rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.3s ease;
    }

    .c-modal__close:hover {
      background-color: rgba(255, 255, 255, 0.2);
    }

    .c-modal__close::before,
    .c-modal__close::after {
      content: "";
      position: absolute;
      width: 16px;
      height: 2px;
      background-color: #fff;
    }

    .c-modal__close::before {
      transform: rotate(45deg);
    }

    .c-modal__close::after {
      transform: rotate(-45deg);
    }

    .c-modal__content {
      position: relative;
      padding: 2rem;
      max-height: 70vh;
      overflow-y: auto;
    }
  `;
  public open() {
    this.isModalOpen = true;
  }

  public close() {
    this.isModalOpen = false;
    this.dispatchEvent(
      new CustomEvent("modal-close", { bubbles: true, composed: true }),
    );
  }

  render() {
    return html`
      ${this.isModalOpen
        ? html`
            <aside class="c-modal" @click=${this.close}>
              <div
                @click=${(e: Event) => e.stopPropagation()}
                class="c-modal__wrapper ${
                  this.alwaysMaximized ? "always-maximized" : ""
                }"
              >
                <header class="c-modal__header">
                  ${
                    `${this.translationKey}` === ""
                      ? `${this.title}`
                      : `${translateText(this.translationKey)}`
                  }
                  <div class.c-modal__close" @click=${this.close}></div>
                </header>
                <section class="c-modal__content">
                  <slot></slot>
                </section>
              </div>
            </aside>
          `
        : html``}
    `;
  }
}
