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

/**
 * An app-wide accessible confirmation modal.
 * Built using the native HTML <dialog> element for accessibility, trapping focus
 * and properly announcing itself to screen readers via aria-labelledby and aria-describedby.
 */
@customElement('confirm-modal')
export class ConfirmModal extends LitElement {
  @query('dialog') dialog!: HTMLDialogElement;

  @state() private modalTitle: string = '';
  @state() private message: string = '';
  @state() private confirmText: string = '';
  @state() private cancelText: string = '';
  @state() private isDestructive: boolean = false;

  private resolvePromise: ((value: boolean) => void) | null = null;
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
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
      max-width: 450px;
      width: 100%;
      font-family: sans-serif;
    }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.5);
    }
    .container {
      display: flex;
      flex-direction: column;
      background: white;
    }
    .header {
      padding: 20px 24px;
      border-bottom: 1px solid #dadce0;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 500;
      color: #202124;
    }
    .content-body {
      padding: 24px;
      color: #3c4043;
      font-size: 14px;
      line-height: 1.5;
    }
    .footer {
      padding: 16px 24px;
      border-top: 1px solid #dadce0;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      background-color: #f8f9fa;
    }
    button {
      padding: 8px 16px;
      border-radius: 4px;
      border: 1px solid #dadce0;
      background-color: white;
      color: #3c4043;
      font-weight: 500;
      font-size: 14px;
      cursor: pointer;
      transition: background-color 0.1s ease;
    }
    button:hover {
      background-color: #f1f3f4;
    }
    button:focus-visible {
      outline: 2px solid #1a73e8;
      outline-offset: 2px;
    }
    button.primary {
      background-color: #1a73e8;
      color: white;
      border-color: #1a73e8;
    }
    button.primary:hover {
      background-color: #1557b0;
    }
    button.destructive {
      background-color: #d93025;
      color: white;
      border-color: #d93025;
    }
    button.destructive:hover {
      background-color: #b3261e;
    }
  `;

  open(
    title: string,
    message: string,
    confirmText: string,
    cancelText: string,
    isDestructive: boolean
  ): Promise<boolean> {
    this.modalTitle = title;
    this.message = message;
    this.confirmText = confirmText;
    this.cancelText = cancelText;
    this.isDestructive = isDestructive;

    // Resolve any previously abandoned promise
    if (this.resolvePromise) {
      this.resolvePromise(false);
    }

    return new Promise(async (resolve) => {
      this.resolvePromise = resolve;
      this.previouslyFocusedElement = this.getDeepActiveElement();
      await this.updateComplete;
      this.dialog.showModal();
    });
  }

  private handleConfirm() {
    if (this.resolvePromise) this.resolvePromise(true);
    this.resolvePromise = null;
    this.dialog.close();
    this.previouslyFocusedElement?.focus();
    this.previouslyFocusedElement = null;
  }

  private handleCancel() {
    if (this.resolvePromise) this.resolvePromise(false);
    this.resolvePromise = null;
    this.dialog.close();
    this.previouslyFocusedElement?.focus();
    this.previouslyFocusedElement = null;
  }

  private handleDialogCancel(e: Event) {
    // Handle the ESC key natively firing the cancel event
    e.preventDefault();
    this.handleCancel();
  }

  override render() {
    return html`
      <dialog @cancel=${this.handleDialogCancel} aria-labelledby="dialog-title" aria-describedby="dialog-description">
        <div class="container">
          <div class="header">
            <h1 id="dialog-title">${this.modalTitle}</h1>
          </div>
          <div class="content-body" id="dialog-description">
            ${this.message}
          </div>
          <div class="footer">
            ${this.cancelText ? html`
              <button @click=${this.handleCancel}>
                ${this.cancelText}
              </button>
            ` : ''}
            <button
              class=${this.isDestructive ? 'destructive' : 'primary'}
              @click=${this.handleConfirm}
            >
              ${this.confirmText}
            </button>
          </div>
        </div>
      </dialog>
    `;
  }
}

let confirmModalInstance: ConfirmModal | null = null;

/**
 * Displays an app-wide accessible confirm modal.
 * 
 * @param title The dialog header title
 * @param message The dialog body description text
 * @param confirmText Text for the confirm button
 * @param cancelText Text for the cancel button
 * @param isDestructive If true, the confirm button uses a red, destructive styling
 * @returns A promise that resolves to true if confirmed, false if cancelled or dismissed.
 */
export async function showConfirm(
  title: string,
  message: string,
  confirmText: string = 'Confirm',
  cancelText: string = 'Cancel',
  isDestructive: boolean = false
): Promise<boolean> {
  if (!confirmModalInstance) {
    confirmModalInstance = document.createElement('confirm-modal') as ConfirmModal;
    document.body.appendChild(confirmModalInstance);
    await confirmModalInstance.updateComplete;
  }
  return confirmModalInstance.open(title, message, confirmText, cancelText, isDestructive);
}

declare global {
  interface HTMLElementTagNameMap {
    'confirm-modal': ConfirmModal;
  }
}
