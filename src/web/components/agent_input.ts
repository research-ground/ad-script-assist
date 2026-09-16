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

import {LitElement, PropertyValues, css, html} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {appState} from '../../core/app_state';
/**
 * Component for user input in the agent chat.
 */
@customElement('agent-input')
export class AgentInput extends LitElement {
  @property({type: String}) value = '';
  @property({type: Boolean}) disabled = false;
  @property({type: Boolean}) isApiKeyMissing = false;

  @property({type: Boolean}) isVideoLoaded = false;
  @state() isAgentResponding = false;

  @query('input') private readonly inputElement!: HTMLInputElement;

  private readonly unsubscribes: Array<() => void> = [];

  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'form');
    this.setAttribute('aria-label', 'Agent Input');

    this.unsubscribes.push(
      appState.subscribe('isAgentResponding', (responding: boolean) => {
        this.isAgentResponding = responding;
      }),
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const unsub of this.unsubscribes) {
      unsub();
    }
  }

  static override styles = [
    css`
      :host {
        display: block;
        width: 100%;
      }

      .container {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
        width: 100%;
      }

      input {
        flex-grow: 1;
        margin-bottom: 0;
        padding: 10px;
        border-radius: 4px;
        border: 1px solid var(--border-color, #dee2e6);
        background-color: var(--secondary-bg, #f8f9fa);
        color: var(--primary-text, #000000);
        box-sizing: border-box;
        font-size: 1em;
        outline: none;
      }

      input::placeholder {
        color: var(--secondary-text, #505050);
        font-style: italic;
      }

      button {
        flex-shrink: 0;
        width: 60px;
        background-color: var(--accent-color, #1a73e8);
        border-color: var(--accent-color, #1a73e8);
        color: #ffffff;
        border-radius: 6px;
        border: 1px solid var(--accent-color, #1a73e8);
        padding: 0.4em 0.8em;
        font-size: 0.9em;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        justify-content: center;
        align-items: center;
      }

      button:hover {
        background-color: var(--accent-hover, #1557b0);
        border-color: var(--accent-hover, #1557b0);
      }

      button:disabled {
        background-color: var(--tertiary-bg, #f1f3f4);
        border-color: var(--tertiary-bg, #f1f3f4);
        color: #3c4043;
        opacity: 0.5;
        cursor: not-allowed;
      }

      .material-icons {
        font-family: 'Material Icons';
        font-weight: normal;
        font-style: normal;
        font-size: 24px;
        line-height: 1;
        letter-spacing: normal;
        text-transform: none;
        display: inline-block;
        white-space: nowrap;
        word-wrap: normal;
        direction: ltr;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        -moz-osx-font-smoothing: grayscale;
        font-feature-settings: 'liga';
      }

      .warning-message {
        color: #d93025;
        font-size: 0.9em;
        margin-top: 5px;
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .warning-icon {
        font-size: 1.2em;
      }
    `,
  ];

  override updated(changedProperties: PropertyValues<this>) {
    super.updated(changedProperties);
    if (changedProperties.has('isAgentResponding')) {
      const wasResponding = changedProperties.get(
        'isAgentResponding',
      ) as boolean;
      if (wasResponding && !this.isAgentResponding) {
        this.focus();
      }
    }
    if (changedProperties.has('isVideoLoaded')) {
      const wasLoaded = changedProperties.get('isVideoLoaded') as boolean;
      if (!wasLoaded && this.isVideoLoaded) {
        this.focus();
      }
    }
  }

  private handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.value = target.value;
    this.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.submit();
    }
  }

  private submit() {
    if (
      this.disabled ||
      !this.value.trim() ||
      !this.isVideoLoaded ||
      this.isAgentResponding
    ) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent('submit-command', {
        detail: {command: this.value},
        bubbles: true,
        composed: true,
      }),
    );
    this.value = '';
    if (this.inputElement) {
      this.inputElement.value = '';
    }
  }

  override focus() {
    if (this.inputElement) {
      this.inputElement.focus();
    }
  }

  override render() {
    const isInputDisabled =
      this.disabled || this.isApiKeyMissing || !this.isVideoLoaded;
    const isSendDisabled =
      isInputDisabled || this.isAgentResponding || !this.value.trim();

    let placeholderText = 'Ask the agent...';
    if (this.isApiKeyMissing) {
      placeholderText = 'API Key required';
    } else if (!this.isVideoLoaded) {
      placeholderText = 'Load a video to chat';
    }

    return html`
      <div class="container">
        <input
          type="text"
          .value="${this.value}"
          placeholder="${placeholderText}"
          ?disabled="${isInputDisabled}"
          @input="${this.handleInput}"
          @keydown="${this.handleKeyDown}"
          aria-label="Agent Command Input" />
        <button
          id="agentSubmitButton"
          @click="${this.submit}"
          ?disabled="${isSendDisabled}"
          aria-label="Submit Agent Command"
          title="Submit Agent Command">
          <span class="material-icons">send</span>
        </button>
      </div>
      ${this.isApiKeyMissing
        ? html`
            <div class="warning-message">
              <span class="material-icons warning-icon">warning</span>
              <span
                >Gemini API Key is missing. Please configure it in
                Settings.</span
              >
            </div>
          `
        : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-input': AgentInput;
  }
}
