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
import {customElement, query} from 'lit/decorators.js';
import {appState} from '../../core/app_state';
import {AppController} from '../controller/app_controller';

/**
 * Component for displaying help information.
 */
@customElement('help-modal')
export class HelpModal extends LitElement {
  @query('dialog') dialog!: HTMLDialogElement;

  private readonly controller = AppController.getInstance();
  private unsubscribes: Array<() => void> = [];

  static override styles = css`
    dialog {
      padding: 0;
      border: none;
      border-radius: 8px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
      max-width: 600px;
      width: 100%;
    }

    dialog::backdrop {
      background: rgba(0, 0, 0, 0.5);
    }

    .container {
      display: flex;
      flex-direction: column;
      background: white;
      font-family: sans-serif;
    }

    .header {
      padding: 24px;
      border-bottom: 1px solid #dadce0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .header h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 400;
    }

    .close-button {
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: #666;
    }

    .close-button:hover {
      color: #333;
    }

    .content-body {
      padding: 24px;
      color: #333;
      line-height: 1.5;
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this.unsubscribes.push(
      appState.subscribe('isHelpModalOpen', (open) => {
        if (!this.dialog) return;
        if (open) {
          if (!this.dialog.open) {
            this.dialog.showModal();
          }
        } else {
          if (this.dialog.open) {
            this.dialog.close();
          }
        }
      })
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
  }

  /** Opens the help modal. */
  open() {
    this.controller.openHelp();
  }

  /** Closes the help modal. */
  close() {
    this.controller.closeHelp();
  }

  override render() {
    return html`
      <dialog>
        <div class="container">
          <div class="header">
            <h1>Help</h1>
            <button class="close-button" @click=${this.close} aria-label="Close modal">
              &times;
            </button>
          </div>
          <div class="content-body">
            <p>Help content goes here.</p>
          </div>
        </div>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'help-modal': HelpModal;
  }
}
