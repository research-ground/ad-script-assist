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

/**
 * @fileoverview Video player component.
 */

import {LitElement, css, html} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {appState} from '../../core/app_state';
import {formatTimeForOverlay} from '../../core/time_utils';
import {VideoPlayerApi} from '../../core/types';
import {YouTubeAdapter} from '../../av/youtube_adapter';
import {LocalVideoAdapter} from '../../av/local_video_adapter';

declare global {
  interface HTMLElementTagNameMap {
    'video-player': AdVideoPlayer;
  }
}

/**
 * Video player component. It delegates the actual playback and API communication
 * to the YouTubeAdapter or LocalVideoAdapter.
 */
@customElement('video-player')
export class AdVideoPlayer extends LitElement implements VideoPlayerApi {
  /** The YouTube video ID to play. */
  @property({type: String}) videoId = '';
  /** The local video file to play. */
  @state() private localVideoFile: File | undefined;
  
  /** Width of the player. */
  @property({type: Number}) width = 480;
  /** Height of the player. */
  @property({type: Number}) height = 360;

  static override styles = css`
    :host {
      display: block;
      position: relative;
      aspect-ratio: 4 / 3;
    }
    #player-container {
      position: relative;
      background: black;
      width: 100%;
      height: 100%;
    }
    #videoTimeOverlay {
      position: absolute;
      bottom: 10px;
      right: 10px;
      background-color: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 5px 10px;
      border-radius: 5px;
      font-family: monospace;
      font-size: 14px;
      pointer-events: none;
      z-index: 10;
    }
    iframe, video {
      width: 100%;
      height: 100%;
      border: 0;
      object-fit: contain;
    }
  `;

  private adapter: YouTubeAdapter | LocalVideoAdapter | null = null;
  private readonly unsubscribes: Array<() => void> = [];

  private addUnsubscribe(unsub: () => void) {
    this.unsubscribes.push(unsub);
  }

  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', 'Video Player');

    this.addUnsubscribe(
      appState.subscribe('currentVideoId', (id) => {
        if (id && id !== this.videoId) {
          this.videoId = id;
        } else if (!id) {
          this.videoId = '';
        }
      }),
    );
    this.addUnsubscribe(
      appState.subscribe('localVideoFile', (file) => {
        if (file !== this.localVideoFile) {
          this.localVideoFile = file;
        }
      }),
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    if (this.adapter) {
      this.adapter.destroy();
      this.adapter = null;
    }
  }

  protected override firstUpdated() {
    this.initPlayer();
  }

  private initPlayer() {
    if (this.adapter) {
      this.adapter.destroy();
      this.adapter = null;
    }

    const container = this.shadowRoot?.getElementById('player-container');
    if (!container) return;

    // We must ensure the container has a sub-element with a unique ID for adapters to attach to
    let placeholder = this.shadowRoot?.getElementById('video-placeholder');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.id = 'video-placeholder';
      placeholder.style.width = '100%';
      placeholder.style.height = '100%';
      // Prepend so it sits under the time overlay
      container.insertBefore(placeholder, container.firstChild);
    } else {
      placeholder.innerHTML = '';
    }

    if (this.localVideoFile) {
      this.adapter = new LocalVideoAdapter(
        placeholder,
        this.localVideoFile,
        () => {
          appState.set('videoDuration', this.duration);
          this.dispatchEvent(new CustomEvent('canplay'));
        },
        (state) => {
          if (state === 1) this.dispatchEvent(new CustomEvent('play'));
          if (state === 2) this.dispatchEvent(new CustomEvent('pause'));
          if (state === 0) this.dispatchEvent(new CustomEvent('ended'));
        },
        (err) => this.dispatchEvent(new CustomEvent('error', {detail: err}))
      );

      // LocalVideoAdapter uses a <video> element. To get time updates, we must poll or listen
      // We will just poll like YouTubeAdapter does implicitly, or listen to 'timeupdate' on its video element
      // But actually LocalVideoAdapter creates the <video>. We can just poll here for simplicity
      // Or we can modify LocalVideoAdapter to dispatch timeupdate. Since it's hidden, let's poll here.
      setInterval(() => {
        if (this.adapter) {
          if (this.duration > 0 && appState.get('videoDuration') !== this.duration) {
            appState.set('videoDuration', this.duration);
          }
          if (!this.adapter.paused) {
            this.requestUpdate();
            this.dispatchEvent(new CustomEvent('timeupdate'));
          }
        }
      }, 250);

    } else if (this.videoId) {
      if (this.videoId.startsWith('local_')) {
        placeholder.innerHTML = `<div style="color: white; padding: 20px;">
          <h3>Local video session lost</h3>
          <p>Browsers cannot persist local files across page reloads for security reasons.</p>
          <p>Please click the "+ Add Video" button and select the same file again to resume.</p>
        </div>`;
        this.dispatchEvent(new CustomEvent('error', {detail: new Error('Local video file lost on reload.')}));
        return;
      }
      this.adapter = new YouTubeAdapter(placeholder, this.videoId);
      
      // Proxy adapter events up to this DOM element
      (this.adapter as YouTubeAdapter).addEventListener('canplay', () => this.dispatchEvent(new CustomEvent('canplay')));
      (this.adapter as YouTubeAdapter).addEventListener('loadedmetadata', () => {
        appState.set('videoDuration', this.duration);
        this.dispatchEvent(new CustomEvent('loadedmetadata'));
      });
      (this.adapter as YouTubeAdapter).addEventListener('play', () => this.dispatchEvent(new CustomEvent('play')));
      (this.adapter as YouTubeAdapter).addEventListener('playing', () => this.dispatchEvent(new CustomEvent('playing')));
      (this.adapter as YouTubeAdapter).addEventListener('pause', () => this.dispatchEvent(new CustomEvent('pause')));
      (this.adapter as YouTubeAdapter).addEventListener('ended', () => this.dispatchEvent(new CustomEvent('ended')));
      (this.adapter as YouTubeAdapter).addEventListener('error', (e: Event) => {
        const customE = e as CustomEvent;
        this.dispatchEvent(new CustomEvent('error', {detail: customE.detail}));
      });
      (this.adapter as YouTubeAdapter).addEventListener('timeupdate', () => {
        console.log(`[Playback] AdVideoPlayer received timeupdate from adapter`);
        if (this.duration > 0 && appState.get('videoDuration') !== this.duration) {
          appState.set('videoDuration', this.duration);
        }
        this.requestUpdate(); // Force lit to re-render the time overlay
        this.dispatchEvent(new CustomEvent('timeupdate'));
      });
    }
  }

  override updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('videoId') || changedProperties.has('localVideoFile')) {
      if (this.adapter && changedProperties.has('videoId') && this.videoId && !this.localVideoFile && this.adapter instanceof YouTubeAdapter) {
        this.adapter.setVideoId(this.videoId);
      } else {
        this.initPlayer();
      }
    }
  }

  /** Current playback time in seconds. */
  get currentTime(): number {
    return this.adapter?.currentTime ?? 0;
  }

  /** Duration of the video in seconds. */
  get duration(): number {
    return this.adapter?.duration ?? 0;
  }

  /** Whether the video is currently paused. */
  get paused(): boolean {
    return this.adapter?.paused ?? true;
  }

  /** Plays the video. */
  async play(): Promise<void> {
    await this.adapter?.play();
  }

  /** Pauses the video. */
  pause(): void {
    this.adapter?.pause();
  }

  /** Seeks to the specified time in seconds. */
  seek(time: number) {
    this.adapter?.seek(time);
  }

  /** Returns the audio/video element for playing media, here the component itself. */
  get nativeVideoElement(): this {
    return this;
  }

  /** Toggles between play and pause states. */
  async togglePlay() {
    if (this.paused) {
      await this.play();
    } else {
      this.pause();
    }
  }

  override render() {
    return html`
      <div id="player-container" inert>
        ${!this.videoId && !this.localVideoFile
          ? html`<div id="placeholder">Load a video</div>`
          : ''}
        <div
          id="videoTimeOverlay"
          role="timer"
          aria-live="off"
          aria-atomic="true">
          ${formatTimeForOverlay(this.currentTime)} /
          ${formatTimeForOverlay(this.duration)}
        </div>
      </div>
    `;
  }
}
