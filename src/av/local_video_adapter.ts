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

export class LocalVideoAdapter implements VideoPlayerApi {
  private videoElement: HTMLVideoElement;
  private durationInterval: number | null = null;
  private isLoaded = false;

  constructor(
    private container: HTMLElement,
    private videoFile: File,
    private onReadyCallback: () => void,
    private onStateChangeCallback: (state: number) => void,
    private onErrorCallback: (error: Error) => void
  ) {
    if (!container) {
      throw new Error(`Container element not found.`);
    }

    this.videoElement = document.createElement('video');
    this.videoElement.style.width = '100%';
    this.videoElement.style.height = '100%';
    this.videoElement.controls = true;
    
    // Create local object URL for the file
    const objectUrl = URL.createObjectURL(this.videoFile);
    this.videoElement.src = objectUrl;

    // Attach events to simulate YT player states
    this.videoElement.addEventListener('canplay', () => {
      if (!this.isLoaded) {
        this.isLoaded = true;
        this.onReadyCallback();
      }
    });

    this.videoElement.addEventListener('play', () => this.onStateChangeCallback(1)); // YT.PlayerState.PLAYING
    this.videoElement.addEventListener('pause', () => this.onStateChangeCallback(2)); // YT.PlayerState.PAUSED
    this.videoElement.addEventListener('ended', () => this.onStateChangeCallback(0)); // YT.PlayerState.ENDED
    
    this.videoElement.addEventListener('error', () => {
      this.onErrorCallback(new Error('Error playing local video'));
    });

    container.appendChild(this.videoElement);
  }

  get currentTime(): number {
    return this.videoElement.currentTime;
  }

  get duration(): number {
    return this.videoElement.duration || 0;
  }

  get paused(): boolean {
    return this.videoElement.paused;
  }

  async play(): Promise<void> {
    await this.videoElement.play();
  }

  pause(): void {
    this.videoElement.pause();
  }

  seek(time: number): void {
    this.videoElement.currentTime = time;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
    this.videoElement.addEventListener(type, listener, options);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
    this.videoElement.removeEventListener(type, listener, options);
  }

  destroy(): void {
    if (this.durationInterval) {
      window.clearInterval(this.durationInterval);
    }
    if (this.videoElement) {
      const src = this.videoElement.src;
      this.videoElement.removeAttribute('src');
      this.videoElement.load();
      URL.revokeObjectURL(src);
      this.videoElement.remove();
    }
  }
}
