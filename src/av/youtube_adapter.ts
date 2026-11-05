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
import {VideoPlayerApi} from '../core/types';

// Minimal YT Player Interface.
// See: https://developers.google.com/youtube/iframe_api_reference.
interface YTPlayer {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getDuration(): number;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YTPlayerOptions {
  height: string;
  width: string;
  videoId: string;
  playerVars: {
    playsinline: number;
    controls: number;
    enablejsapi: number;
    origin: string;
    disablekb: number;
    fs: number;
    rel: number;
  };
  events: {
    onReady: (event: {target: YTPlayer}) => void;
    onStateChange: (event: {data: number; target: YTPlayer}) => void;
    onError: (event: {data: number; target: YTPlayer}) => void;
  };
}

export enum YTState {
  UNSTARTED = -1,
  ENDED = 0,
  PLAYING = 1,
  PAUSED = 2,
  BUFFERING = 3,
  CUED = 5,
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: YTPlayerOptions,
  ) => YTPlayer;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
  }
}

/**
 * Adapter that encapsulates the YouTube IFrame API, exposing it via the standard
 * VideoPlayerApi interface.
 */
export class YouTubeAdapter extends EventTarget implements VideoPlayerApi {
  private player: YTPlayer | null = null;
  private currentTimeValue = 0;
  private durationValue = 0;
  private isPaused = true;

  private timeUpdateInterval: number | null = null;
  private statePollInterval: number | null = null;
  private lastState: number = YTState.UNSTARTED;

  constructor(
    private readonly placeholder: HTMLElement,
    private videoId: string
  ) {
    super();
    this.initPlayer();
  }

  private initPlayer() {
    if (window.YT && window.YT.Player) {
      this.createPlayer();
    } else {
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds
      const checkInterval = setInterval(() => {
        attempts++;
        if (window.YT && window.YT.Player) {
          clearInterval(checkInterval);
          this.createPlayer();
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
        }
      }, 100);
    }
  }

  private createPlayer() {
    if (this.player || !this.videoId || !window.YT) return;

    this.player = new window.YT.Player(this.placeholder, {
      height: '100%',
      width: '100%',
      videoId: this.videoId,
      playerVars: {
        playsinline: 1,
        controls: 0,
        enablejsapi: 1,
        origin: window.location.origin,
        disablekb: 1,
        fs: 0,
        rel: 0,
      },
      events: {
        onReady: this.onPlayerReady.bind(this),
        onStateChange: this.onPlayerStateChange.bind(this),
        onError: this.onPlayerError.bind(this),
      },
    });
  }

  public setVideoId(videoId: string) {
    if (this.videoId === videoId) return;
    this.videoId = videoId;
    if (this.player) {
      this.player.loadVideoById(this.videoId);
    } else {
      this.createPlayer();
    }
  }

  private onPlayerReady(event: {target: YTPlayer}) {
    this.dispatchEvent(new Event('canplay'));
    this.dispatchEvent(new Event('loadedmetadata'));
    if (this.player) {
      this.durationValue = this.player.getDuration();

      if (this.statePollInterval) {
        window.clearInterval(this.statePollInterval);
      }
      this.statePollInterval = window.setInterval(() => {
        this.pollPlayerState();
      }, 100);
    }
  }

  private pollPlayerState() {
    if (this.player && typeof this.player.getPlayerState === 'function') {
      const state = this.player.getPlayerState();
      if (state !== this.lastState && state !== undefined && state !== null) {
        this.onPlayerStateChange({data: state});
      }
    }
  }

  private onPlayerStateChange(event: {data: number}) {
    const state = event.data;
    this.lastState = state;
    if (state === YTState.PLAYING) {
      this.isPaused = false;
      this.startTimeUpdate();
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('playing'));
    } else {
      this.isPaused = true;
      this.stopTimeUpdate();
      if (state === YTState.PAUSED) {
        this.dispatchEvent(new Event('pause'));
      } else if (state === YTState.ENDED) {
        this.player?.stopVideo();
        this.dispatchEvent(new Event('ended'));
      }
    }
    this.updateTimeFromPlayer();
  }

  private onPlayerError(event: {data: number}) {
    this.dispatchEvent(
      new CustomEvent('error', {detail: {code: event.data}}),
    );
  }

  private updateTimeFromPlayer() {
    if (this.player) {
      this.currentTimeValue = this.player.getCurrentTime();
      const dur = this.player.getDuration();
      if (dur > 0) this.durationValue = dur;
    }
  }

  private startTimeUpdate() {
    this.stopTimeUpdate();
    console.log('[Playback] startTimeUpdate called in YouTubeAdapter');
    this.timeUpdateInterval = window.setInterval(() => {
      this.updateTimeFromPlayer();
      console.log(`[Playback] YouTubeAdapter interval, time=${this.currentTimeValue}`);
      this.dispatchEvent(new Event('timeupdate'));
    }, 250);
  }

  private stopTimeUpdate() {
    if (this.timeUpdateInterval) {
      window.clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }
  }

  get currentTime(): number {
    return this.currentTimeValue;
  }

  get duration(): number {
    return this.durationValue;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  async play(): Promise<void> {
    if (this.player) {
      this.player.playVideo();
    }
  }

  pause(): void {
    if (this.player) {
      this.player.pauseVideo();
    }
  }

  seek(time: number) {
    if (this.player) {
      const clampedTime = Math.max(0, Math.min(time, this.durationValue));
      this.player.seekTo(clampedTime, true);
      this.currentTimeValue = clampedTime;
    }
  }

  /** Accepts a 0-1 volume and maps it to YouTube's 0-100 integer scale. */
  setVolume(volume: number) {
    if (this.player && typeof this.player.setVolume === 'function') {
      const clamped = Math.max(0, Math.min(1, volume));
      this.player.setVolume(Math.round(clamped * 100));
    }
  }

  destroy() {
    this.stopTimeUpdate();
    if (this.statePollInterval) {
      window.clearInterval(this.statePollInterval);
      this.statePollInterval = null;
    }
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
  }
}
