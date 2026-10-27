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
      white-space: pre-wrap;
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
      white-space: pre-wrap;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .empty-chat-state {
      padding: 16px;
      margin: 8px 0;
      border: 1px dashed var(--border-color, #dadce0);
      border-radius: 8px;
      background-color: var(--tertiary-bg, #f8f9fa);
      color: var(--secondary-text, #5f6368);
      font-size: 0.85rem;
      line-height: 1.5;
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
    const visibleEntries = this.conversationLog.filter((e) => !e.trashed);
    return html`
      <div
        class="chat-container"
        id="conversationHistory"
        role="log"
        aria-live="polite"
        aria-relevant="additions">
        ${visibleEntries.length === 0 && !this.isResponding
          ? html`
              <div class="empty-chat-state" role="note">
                <strong>AI Assistant Ready</strong><br />
                Ask questions about the video, click <em>(Re)Generate AD</em> to draft a full WebVTT script, or request edits to specific cues.
              </div>
            `
          : ''}
        <ul>
          ${visibleEntries.map((entry) => {
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
                ${prefix ? html`<h3 class="visually-hidden">${prefix}</h3>` : ''}
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
