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
      color: #5f6368;
    }

    .close-button:hover {
      color: #202124;
    }

    .close-button:focus-visible {
      outline: 2px solid var(--accent-color, #1a73e8);
      outline-offset: 2px;
      border-radius: 4px;
    }

    .content-body {
      padding: 24px;
      color: #202124;
      line-height: 1.5;
      font-size: 14px;
      max-height: 70vh;
      overflow-y: auto;
    }

    .content-body h2 {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: 600;
    }

    .content-body ol,
    .content-body ul {
      margin: 0 0 16px 0;
      padding-left: 20px;
    }

    .content-body li {
      margin-bottom: 6px;
    }

    .shortcut-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .shortcut-table th,
    .shortcut-table td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid #dadce0;
    }

    .shortcut-table th {
      font-weight: 600;
      background-color: #f8f9fa;
    }

    .shortcut-table code {
      font-family: monospace;
      background-color: #f1f3f4;
      padding: 2px 4px;
      border-radius: 3px;
    }
  `;

  private previouslyFocusedElement: HTMLElement | null = null;

  private getDeepActiveElement(): HTMLElement | null {
    let current: Element | null = document.activeElement;
    while (current?.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement;
    }
    return current instanceof HTMLElement ? current : null;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.unsubscribes.push(
      appState.subscribe('isHelpModalOpen', (open) => {
        if (!this.dialog) return;
        if (open) {
          if (!this.dialog.open) {
            this.previouslyFocusedElement = this.getDeepActiveElement();
            this.dialog.showModal();
          }
        } else {
          if (this.dialog.open) {
            this.dialog.close();
          }
          this.previouslyFocusedElement?.focus();
          this.previouslyFocusedElement = null;
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

  private handleDialogCancel(e: Event) {
    e.preventDefault();
    this.close();
  }

  override render() {
    return html`
      <dialog
        aria-labelledby="help-title"
        aria-describedby="help-description"
        @cancel=${this.handleDialogCancel}>
        <div class="container">
          <div class="header">
            <h1 id="help-title">Help</h1>
            <button type="button" class="close-button" @click=${this.close} aria-label="Close modal">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div class="content-body" id="help-description">
            <h2>Getting Started</h2>
            <ol>
              <li><strong>Add Video:</strong> Load a local video file or paste a YouTube URL.</li>
              <li><strong>Generate or Write Script:</strong> Use <em>Generate AD</em> to draft a WebVTT Audio Description script with AI, or type cues directly in the Script Editor.</li>
              <li><strong>Refine with AI Chat:</strong> Ask visual questions about the video or request targeted edits to specific cues.</li>
              <li><strong>Preview &amp; Export:</strong> Play the video to hear synthesized AD cues, then export WebVTT, audio, or mixed video.</li>
            </ol>
            <h2>Default Keyboard Shortcuts</h2>
            <table class="shortcut-table" aria-label="Default Keyboard Shortcuts">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Shortcut</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Play / Pause video</td><td><code>Ctrl+1</code></td></tr>
                <tr><td>Rewind 5 seconds</td><td><code>Ctrl+2</code></td></tr>
                <tr><td>Forward 5 seconds</td><td><code>Ctrl+3</code></td></tr>
                <tr><td>Focus AI Chat input</td><td><code>Ctrl+4</code></td></tr>
                <tr><td>Focus AD Script Editor</td><td><code>Ctrl+5</code></td></tr>
                <tr><td>Generate AD script</td><td><code>Ctrl+M</code></td></tr>
                <tr><td>Read current line number</td><td><code>Ctrl+L</code></td></tr>
              </tbody>
            </table>
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
