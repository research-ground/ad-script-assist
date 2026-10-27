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

/** Video URL Input component. */
@customElement('video-url-input')
export class VideoUrlInput extends LitElement {
  @state() private url = '';
  @state() private error = '';
  @query('input') private readonly inputElement!: HTMLInputElement;

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      margin-bottom: 20px;
    }

    .input-container {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    input {
      flex: 1;
      padding: 10px;
      border: 1px solid var(--border-color, #dee2e6);
      border-radius: 4px;
      font-size: 16px;
    }

    button {
      padding: 10px 15px;
      background-color: var(--accent-color, #0078d4);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
    }

    button:disabled {
      background-color: #cccccc;
      cursor: not-allowed;
    }

    .error-message {
      color: var(--error-text-color, red);
      font-size: 14px;
      margin-top: 5px;
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'search');
    this.setAttribute('aria-label', 'Video Selection');
  }

  private static readonly YOUTUBE_URL_REGEX =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;

  private extractVideoId(url: string): string | null {
    const match = url.match(VideoUrlInput.YOUTUBE_URL_REGEX);
    return match && match[2].length === 11 ? match[2] : null;
  }

  private handleLoad() {
    this.error = '';
    const videoId = this.extractVideoId(this.url);
    if (videoId) {
      this.dispatchEvent(
        new CustomEvent('video-load', {
          detail: {videoId},
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this.error = 'Invalid YouTube URL';
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.handleLoad();
    }
  }

  private handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.url = target.value;
    this.error = '';
  }

  /** Clears the input field. */
  clear() {
    this.url = '';
    this.error = '';
    if (this.inputElement) {
      this.inputElement.value = '';
    }
  }

  override render() {
    return html`
      <div>
        <label for="yt-input" style="display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px;">YouTube Video URL</label>
        <div class="input-container">
          <input
            id="yt-input"
            type="text"
            placeholder="Paste YouTube URL here..."
            .value="${this.url}"
            @input="${this.handleInput}"
            @keydown="${this.handleKeyDown}"
            aria-label="YouTube URL" />
          <button
            @click="${this.handleLoad}"
            ?disabled="${!this.url}"
            aria-label="Load Video">
            Load
          </button>
        </div>
        ${this.error
          ? html`<div class="error-message" role="alert">${this.error}</div>`
          : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'video-url-input': VideoUrlInput;
  }
}
