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

import {LitElement, css, html} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {appState} from '../../core/app_state';
import {ConversationEntry} from '../../core/types';

/**
 * Component for rendering the conversation history with the AI agent.
 */
@customElement('agent-chat')
export class AgentChat extends LitElement {
  @state() conversationLog: ConversationEntry[] = [];
  @state() isResponding = false;

  private readonly unsubscribes: Array<() => void> = [];

  @query('.chat-container') private readonly scrollContainer!: HTMLDivElement;

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      color: var(--secondary-text, #505050);
      overflow: hidden;
    }

    .chat-container {
      flex: 1;
      overflow-y: auto;
      padding-right: 5px;
      min-height: 0;
    }

    ul {
      list-style-type: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    li {
      margin-bottom: 5px;
      line-height: 1.4;
      font-size: 0.9em;
    }

    .user-message {
      text-align: right;
      color: var(--primary-text, #000000);
      font-weight: 500;
      background-color: var(--tertiary-bg, #e9ecef);
      padding: 8px 12px;
      border-radius: 12px 12px 0 12px;
      align-self: flex-end;
      max-width: 80%;
      word-wrap: break-word;
    }

    .agent-message {
      text-align: left;
      color: var(--secondary-text, #505050);
      background-color: var(--primary-bg, #ffffff);
      border: 1px solid var(--border-color, #dee2e6);
      padding: 8px 12px;
      border-radius: 12px 12px 12px 0;
      align-self: flex-start;
      max-width: 80%;
      word-wrap: break-word;
    }

    .system-message {
      text-align: center;
      font-style: italic;
      color: var(--secondary-text, #505050);
      font-size: 0.8em;
      opacity: 0.8;
      align-self: center;
      margin: 5px 0;
    }

    .responding-message {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      padding: 2px 0px;
      margin-bottom: 6px;
      font-style: italic;
      font-size: 0.75rem;
      color: var(--secondary-text, #505050);
      opacity: 0.7;
    }

    .dots::after {
      content: '.';
      animation: dots 2s steps(4, end) infinite;
      display: inline-block;
      width: 1.5em;
    }

    @keyframes dots {
      0% {
        content: '';
      }
      25% {
        content: '.';
      }
      50% {
        content: '..';
      }
      75% {
        content: '...';
      }
      100% {
        content: '';
      }
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', 'Agent Chat Log');

    this.unsubscribes.push(
      appState.subscribe('conversationLog', (log) => {
        this.conversationLog = log || [];
      })
    );

    this.unsubscribes.push(
      appState.subscribe('isAgentResponding', (responding) => {
        this.isResponding = !!responding;
      })
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const unsub of this.unsubscribes) {
      unsub();
    }
  }

  override updated() {
    this.scrollToBottom();
  }

  private scrollToBottom() {
    if (this.scrollContainer) {
      this.scrollContainer.scrollTo({
        top: this.scrollContainer.scrollHeight,
        behavior: 'smooth',
      });
    }
  }

  override render() {
    return html`
      <div class="chat-container" id="conversationHistory">
        <ul>
          ${this.conversationLog.map((entry) => {
            if (entry.trashed) return null;

            let className = 'system-message';
            let prefix = '';

            if (entry.type === 'user') {
              className = 'user-message';
              prefix = 'You said: ';
            } else if (entry.type === 'agent') {
              className = 'agent-message';
              prefix = 'Agent said: ';
            }

            return html`
              <li class="${className}">
                <span class="visually-hidden">${prefix}</span>
                <span>${entry.message}</span>
              </li>
            `;
          })}
          ${this.isResponding
            ? html`
                <li class="responding-message" aria-live="polite">
                  <span>Agent is responding</span
                  ><span aria-hidden="true" class="dots"></span>
                </li>
              `
            : ''}
        </ul>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-chat': AgentChat;
  }
}
