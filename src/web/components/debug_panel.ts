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

import {LitElement, html, css} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {appState} from '../../core/app_state';
import {AdSegment} from '../../core/types';

@customElement('debug-panel')
export class DebugPanel extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--secondary-bg, #f8f9fa);
      border-left: 1px solid var(--border-color, #dadce0);
      color: var(--primary-text, #202124);
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      padding: 16px;
      box-sizing: border-box;
      overflow-y: auto;
    }
    
    h3 {
      margin-top: 0;
      color: var(--primary-text, #202124);
      border-bottom: 1px solid var(--border-color, #dadce0);
      padding-bottom: 8px;
      font-size: 1.1rem;
    }
    
    .segment {
      margin-bottom: 12px;
      padding: 10px;
      background: #ffffff;
      border-radius: 6px;
      border: 1px solid var(--border-color, #dadce0);
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .time {
      color: var(--secondary-text, #5f6368);
      font-size: 12px;
    }

    .script {
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--primary-text, #202124);
      margin-bottom: 8px;
      font-family: monospace;
      background: var(--tertiary-bg, #e9ecef);
      padding: 6px;
      border-radius: 4px;
    }
    
    .status-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .status-badge.has-audio {
      background: #e6f4ea;
      color: #137333;
      border: 1px solid #ceead6;
    }
    
    .status-badge.no-audio {
      background: #fce8e6;
      color: #c5221f;
      border: 1px solid #fad2cf;
    }
  `;

  @state()
  private adSegments: AdSegment[] = [];

  private unsubscribes: Array<() => void> = [];

  override connectedCallback() {
    super.connectedCallback();
    this.unsubscribes.push(
      appState.subscribe('adSegments', (segments: AdSegment[]) => {
        this.adSegments = segments || [];
      })
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribes.forEach((unsub) => unsub());
    this.unsubscribes = [];
  }

  override render() {
    return html`
      <h3>Debug Panel</h3>
      ${this.adSegments.length === 0 ? html`<p style="color: #9ca3af; font-style: italic;">No segments parsed yet.</p>` : ''}
      ${this.adSegments.map((seg, i) => html`
        <div class="segment">
          <div class="header">
            <strong>Line ${i + 1}</strong>
            <span class="time">${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s</span>
          </div>
          <div class="script">${seg.script || html`<em>[empty]</em>`}</div>
          <div>
            <span class="status-badge ${seg.audioData ? 'has-audio' : 'no-audio'}">
              ${seg.audioData ? 'TTS READY' : 'NO TTS'}
            </span>
          </div>
        </div>
      `)}
    `;
  }
}
