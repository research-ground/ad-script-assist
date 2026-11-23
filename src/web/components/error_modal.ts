/*
 Copyright 2026 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import {css, html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';

export type ErrorModalAction = 'dismiss' | 'open-settings';

export interface ErrorModalOptions {
  title: string;
  summary: string;
  details?: string;
  suggestions?: string[];
  showOpenSettings?: boolean;
  dismissText?: string;
}

/**
 * App-wide accessible error alert modal built on native HTML `<dialog>` with
 * `role="alertdialog"`, focus trapping, Escape dismissal, and focus restoration.
 */
@customElement('error-modal')
export class ErrorModal extends LitElement {
  @query('dialog') dialog!: HTMLDialogElement;
  @query('#error-dismiss-button') dismissButton?: HTMLButtonElement;

  @state() private modalTitle = '';
  @state() private summary = '';
  @state() private details = '';
  @state() private suggestions: string[] = [];
  @state() private showOpenSettings = false;
  @state() private dismissText = 'Dismiss';

  private resolvePromise: ((action: ErrorModalAction) => void) | null = null;
  private previouslyFocusedElement: HTMLElement | null = null;

  private getDeepActiveElement(): HTMLElement | null {
    let current: Element | null = document.activeElement;
    while (current?.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement;
    }
    return current instanceof HTMLElement ? current : null;
  }

  static override styles = css`
    dialog {
      padding: 0;
      border: none;
      border-radius: 8px;
      box-shadow:
        0 8px 24px rgba(0, 0, 0, 0.18),
        0 2px 6px rgba(0, 0, 0, 0.1);
      max-width: 520px;
      width: calc(100vw - 32px);
      max-height: 85vh;
      overflow: hidden;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }

    dialog::backdrop {
      background: rgba(0, 0, 0, 0.55);
    }

    .container {
      display: flex;
      flex-direction: column;
      background: #ffffff;
      max-height: 85vh;
    }

    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 20px 24px 16px 24px;
      border-bottom: 1px solid #f28b82;
      background-color: #fce8e6;
    }

    .header-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .alert-icon {
      color: #a50e0e;
      font-size: 24px;
      flex-shrink: 0;
    }

    .material-icons {
      font-family: 'Material Icons';
      font-weight: normal;
      font-style: normal;
      font-size: 24px;
      display: inline-block;
      line-height: 1;
      text-transform: none;
      letter-spacing: normal;
      word-wrap: normal;
      white-space: nowrap;
      direction: ltr;
      -webkit-font-feature-settings: 'liga';
      -webkit-font-smoothing: antialiased;
    }

    .header h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: #a50e0e;
      line-height: 1.3;
    }

    .close-button {
      background: none;
      border: none;
      font-size: 1.5rem;
      line-height: 1;
      padding: 2px 6px;
      cursor: pointer;
      color: #5f6368;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .close-button:hover {
      color: #202124;
      background-color: rgba(0, 0, 0, 0.06);
    }

    .content-body {
      padding: 20px 24px;
      overflow-y: auto;
      color: #202124;
      font-size: 14px;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .summary {
      margin: 0;
      color: #202124;
    }

    .suggestions-heading {
      margin: 0 0 6px 0;
      font-size: 13px;
      font-weight: 600;
      color: #202124;
    }

    .suggestions-list {
      margin: 0;
      padding-left: 20px;
      color: #3c4043;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .details-box {
      background-color: #f8f9fa;
      border: 1px solid #dadce0;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 12.5px;
      color: #3c4043;
      word-break: break-word;
    }

    .details-label {
      display: block;
      font-weight: 600;
      color: #202124;
      margin-bottom: 4px;
    }

    .footer {
      padding: 16px 24px;
      border-top: 1px solid #dadce0;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      background-color: #f8f9fa;
      flex-shrink: 0;
    }

    button {
      padding: 8px 16px;
      border-radius: 4px;
      border: 1px solid #dadce0;
      background-color: #ffffff;
      color: #3c4043;
      font-weight: 500;
      font-size: 14px;
      cursor: pointer;
    }

    button:hover {
      background-color: #f1f3f4;
    }

    button.primary {
      background-color: #1a73e8;
      color: #ffffff;
      border-color: #1a73e8;
    }

    button.primary:hover {
      background-color: #1557b0;
    }

    button:focus-visible {
      outline: 2px solid #1a73e8;
      outline-offset: 2px;
    }
  `;

  get isOpen(): boolean {
    return Boolean(this.dialog?.open);
  }

  open(options: ErrorModalOptions): Promise<ErrorModalAction> {
    this.modalTitle = options.title;
    this.summary = options.summary;
    this.details = options.details || '';
    this.suggestions = options.suggestions || [];
    this.showOpenSettings = Boolean(options.showOpenSettings);
    this.dismissText = options.dismissText || 'Dismiss';

    if (this.resolvePromise) {
      this.resolvePromise('dismiss');
    }

    return new Promise(async (resolve) => {
      this.resolvePromise = resolve;
      if (!this.dialog?.open) {
        this.previouslyFocusedElement = this.getDeepActiveElement();
      }
      await this.updateComplete;
      if (!this.dialog.open) {
        this.dialog.showModal();
      }
      this.dismissButton?.focus();
    });
  }

  private finish(action: ErrorModalAction) {
    const resolver = this.resolvePromise;
    this.resolvePromise = null;
    if (this.dialog?.open) {
      this.dialog.close();
    }
    if (action === 'dismiss') {
      this.previouslyFocusedElement?.focus();
    }
    this.previouslyFocusedElement = null;
    resolver?.(action);
  }

  private handleDialogCancel(e: Event) {
    e.preventDefault();
    this.finish('dismiss');
  }

  override render() {
    const describedBy = this.details
      ? 'error-dialog-summary error-dialog-details'
      : 'error-dialog-summary';

    return html`
      <dialog
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-dialog-title"
        aria-describedby=${describedBy}
        @cancel=${this.handleDialogCancel}>
        <div class="container">
          <div class="header">
            <div class="header-title-row">
              <span class="material-icons alert-icon" aria-hidden="true"
                >error_outline</span
              >
              <h1 id="error-dialog-title">${this.modalTitle}</h1>
            </div>
            <button
              type="button"
              class="close-button"
              aria-label="Close error dialog"
              @click=${() => this.finish('dismiss')}>
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div class="content-body">
            <p id="error-dialog-summary" class="summary">${this.summary}</p>
            ${this.suggestions.length > 0
              ? html`
                  <div>
                    <h2 class="suggestions-heading">What you can try:</h2>
                    <ul class="suggestions-list">
                      ${this.suggestions.map((item) => html`<li>${item}</li>`)}
                    </ul>
                  </div>
                `
              : ''}
            ${this.details
              ? html`
                  <div id="error-dialog-details" class="details-box">
                    <span class="details-label">Error details:</span>
                    <span>${this.details}</span>
                  </div>
                `
              : ''}
          </div>
          <div class="footer">
            ${this.showOpenSettings
              ? html`
                  <button
                    id="error-open-settings-button"
                    type="button"
                    aria-haspopup="dialog"
                    @click=${() => this.finish('open-settings')}>
                    Open Settings
                  </button>
                `
              : ''}
            <button
              id="error-dismiss-button"
              type="button"
              class="primary"
              @click=${() => this.finish('dismiss')}>
              ${this.dismissText}
            </button>
          </div>
        </div>
      </dialog>
    `;
  }
}

let errorModalInstance: ErrorModal | null = null;

/**
 * Displays an app-wide accessible error modal dialog (`role="alertdialog"`).
 * Avoids stacking duplicate dialogs if one is already open.
 */
export async function showErrorModal(
  options: ErrorModalOptions,
): Promise<ErrorModalAction> {
  if (typeof document === 'undefined') {
    return 'dismiss';
  }
  if (!errorModalInstance || !errorModalInstance.isConnected) {
    errorModalInstance = document.createElement('error-modal') as ErrorModal;
    document.body.appendChild(errorModalInstance);
    await errorModalInstance.updateComplete;
  }
  if (errorModalInstance.isOpen) {
    return 'dismiss';
  }
  return errorModalInstance.open(options);
}

declare global {
  interface HTMLElementTagNameMap {
    'error-modal': ErrorModal;
  }
}
