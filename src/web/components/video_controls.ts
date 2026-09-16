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
import {customElement, state} from 'lit/decorators.js';
import {appState} from '../../core/app_state';

/**
 * Component for controlling video playback and Audio Description (AD) features.
 *
 * This component provides controls for:
 * - Play/Pause and Rewind/Forward navigation.
 * - Toggling Audio Description tracks on/off.
 * - Exporting the AD track script.
 * - Accessing settings.
 */
@customElement('video-controls')
export class VideoControls extends LitElement {
  @state() private isPlaying = false;
  @state() private isAdAudioGenerating = false;

  @state() private isVideoLoaded = false;
  @state() private hasAdScript = false;

  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'toolbar');
    this.setAttribute('aria-label', 'Video Controls');

    this.addUnsubscribe(
      appState.subscribe('isVideoPaused', (paused) => {
        this.isPlaying = !paused;
      }),
    );
    this.addUnsubscribe(
      appState.subscribe('currentVideoId', (id) => {
        this.isVideoLoaded = !!id;
      }),
    );
    this.addUnsubscribe(
      appState.subscribe('adSegments', (segments) => {
        this.hasAdScript = (segments || []).length > 0;
      }),
    );
    this.addUnsubscribe(
      appState.subscribe('isAdAudioGenerating', (generating) => {
        this.isAdAudioGenerating = !!generating;
      }),
    );
  }

  private readonly unsubscribes: Array<() => void> = [];
  private addUnsubscribe(unsub: () => void) {
    this.unsubscribes.push(unsub);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const unsub of this.unsubscribes) {
      unsub();
    }
  }

  static override styles = [
    css`
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
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        -moz-osx-font-smoothing: grayscale;
        font-feature-settings: 'liga';
      }
    `,
    css`
      :host {
        display: block;
      }
      .controls-container {
        display: flex;
        gap: 10px;
        margin-top: 6px;
      }
      button {
        flex-grow: 1;
        display: flex;
        justify-content: center;
        align-items: center;
        border-radius: 6px;
        border: 1px solid var(--accent-color, #0078d4);
        padding: 0.4em 0.8em;
        font-size: 0.9em;
        font-weight: 500;
        font-family: inherit;
        background-color: var(--accent-color, #0078d4);
        color: #ffffff;
        cursor: pointer;
        transition:
          background-color 0.25s,
          transform 0.1s;
      }
      button:hover {
        background-color: #005a9e;
      }
      button:active {
        transform: scale(0.98);
      }
      button.toggled {
        background-color: var(--accent-color, #0078d4);
        color: #ffffff;
      }
      button:not(.toggled) {
        background-color: var(--tertiary-bg, #e9ecef);
        color: var(--secondary-text, #505050);
        border-color: var(--border-color, #dee2e6);
      }
      button:disabled {
        background-color: #cccccc;
        border-color: #bbbbbb;
        color: #666666;
        cursor: not-allowed;
        transform: none;
      }
      button i {
        font-size: 1.1rem;
      }
      .loading-spinner {
        display: inline-block;
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }
    `,
  ];

  private dispatch(eventName: string) {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="controls-container">
        <button
          id="rewindButton"
          @click=${() => {
            this.dispatch('rewind');
          }}
          ?disabled=${!this.isVideoLoaded}
          aria-label="Rewind video 5 seconds"
          title="Rewind video 5 seconds">
          <span class="material-icons">fast_rewind</span>
        </button>
        <button
          id="playButton"
          @click=${() => {
            this.dispatch('play-pause');
          }}
          ?disabled=${!this.isVideoLoaded}
          aria-label="Play or pause video"
          title="Play or pause video">
          <span class="material-icons"
            >${this.isPlaying ? 'pause' : 'play_arrow'}</span
          >
        </button>
        <button
          id="forwardButton"
          @click=${() => {
            this.dispatch('forward');
          }}
          ?disabled=${!this.isVideoLoaded}
          aria-label="Forward video 5 seconds"
          title="Forward video 5 seconds">
          <span class="material-icons">fast_forward</span>
        </button>



      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'video-controls': VideoControls;
  }
}
