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
import {customElement, state, query} from 'lit/decorators.js';
import {appState} from '../../core/app_state';
import {AppController} from '../controller/app_controller';


@customElement('add-video-modal')
export class AddVideoModal extends LitElement {
  @query('dialog') dialog!: HTMLDialogElement;

  @state() private isDragging = false;
  @state() private error = '';
  @state() private isLoading = false;
  @state() private isOpen = false;
  @state() private youtubeUrl = '';

  private readonly controller = AppController.getInstance();
  private unsubscribes: Array<() => void> = [];

  override connectedCallback() {
    super.connectedCallback();
    this.unsubscribes.push(
      appState.subscribe('isAddVideoModalOpen', (open) => {
        this.isOpen = !!open;
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

  override updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('isOpen')) {
      if (this.isOpen) {
        this.youtubeUrl = '';
        this.error = '';
        this.dialog?.showModal();
      } else {
        this.dialog?.close();
      }
    }
  }

  static styles = css`
    dialog {
      padding: 0;
      border: none;
      border-radius: 8px;
      box-shadow:
        0 4px 6px -1px rgba(0, 0, 0, 0.1),
        0 2px 4px -1px rgba(0, 0, 0, 0.06);
      max-width: 90vw;
      width: 450px;
      background: transparent;
    }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.5);
    }
    .modal {
      background: white;
      color: #202124;
      display: flex;
      flex-direction: column;
      font-family: 'Inter', sans-serif;
    }
    .header {
      padding: 24px;
      border-bottom: 1px solid #dadce0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 400;
    }
    .close-btn {
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: #5f6368;
      padding: 0;
      line-height: 1;
    }
    .close-btn:hover {
      color: #202124;
    }
    .content {
      padding: 24px;
    }
    .drop-zone {
      border: 2px dashed #dadce0;
      border-radius: 8px;
      padding: 32px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
      background: #f8f9fa;
      color: #5f6368;
      font-size: 14px;
      line-height: 1.5;
    }
    .drop-zone:hover {
      background: #f1f3f4;
      border-color: #bdc1c6;
    }
    .drop-zone.dragging {
      border-color: #1a73e8;
      background: #e8f0fe;
      color: #1a73e8;
    }
    .youtube-input-container {
      display: flex;
      gap: 12px;
    }
    input[type="text"] {
      flex: 1;
      padding: 10px 12px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      font-size: 14px;
      background: white;
      color: #202124;
      box-sizing: border-box;
    }
    input[type="text"]::placeholder {
      color: #5f6368;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: #1a73e8;
    }
    button.primary {
      padding: 8px 16px;
      background: #1a73e8;
      color: white;
      border: 1px solid #1a73e8;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      font-size: 14px;
    }
    button.primary:hover {
      background: #1765cc;
      box-shadow: 0 1px 2px rgba(60, 64, 67, 0.3);
    }
    button.primary:disabled {
      background: #f1f3f4;
      border-color: #f1f3f4;
      color: #3c4043;
      cursor: not-allowed;
      opacity: 0.5;
      box-shadow: none;
    }
    .error { color: #d93025; margin-top: 16px; font-size: 14px; }
    .loading { color: #1a73e8; margin-top: 16px; font-size: 14px; }
    .divider {
      text-align: center;
      color: #5f6368;
      font-size: 14px;
      margin: 24px 0;
      position: relative;
    }
    .divider::before, .divider::after {
      content: "";
      position: absolute;
      top: 50%;
      width: 40%;
      border-top: 1px solid #dadce0;
    }
    .divider::before { left: 0; }
    .divider::after { right: 0; }
  `;

  private close() {
    this.controller.closeAddVideo();
  }

  private handleDialogCancel(e: Event) {
    e.preventDefault();
    this.close();
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    this.isDragging = true;
  }

  private handleDragLeave() {
    this.isDragging = false;
  }

  private handleDrop(e: DragEvent) {
    e.preventDefault();
    this.isDragging = false;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      this.processFile(e.dataTransfer.files[0]);
    }
  }

  private handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.processFile(input.files[0]);
    }
  }

  private async processFile(file: File) {
    this.error = '';
    
    if (!file.type.startsWith('video/')) {
      this.error = 'Please upload a valid video file.';
      return;
    }
    if (file.size > 75 * 1024 * 1024) {
      this.error = 'File size must be under 75MB.';
      return;
    }

    this.isLoading = true;
    try {
      const duration = await this.getVideoDuration(file);
      if (duration > 600) {
        this.error = 'Video must be under 10 minutes.';
        return;
      }
      
      // Valid!
      const videoId = 'local_' + file.name;
      appState.set('localVideoFile', file);
      appState.set('currentVideoId', videoId);
      appState.set('videoType', 'local');
      appState.set('videoSource', file.name);
      this.close();
    } catch (err) {
      this.error = 'Could not read video file.';
    } finally {
      this.isLoading = false;
    }
  }

  private getVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      
      const cleanup = () => {
        const src = video.src;
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(src);
      };

      video.onloadedmetadata = () => {
        const dur = video.duration;
        cleanup();
        resolve(dur);
      };
      
      video.onerror = (e) => {
        cleanup();
        reject(e);
      };
      
      video.src = URL.createObjectURL(file);
    });
  }

  private handleYouTubeInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.youtubeUrl = input.value;
  }

  private handleYouTubeKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.submitYouTube();
    }
  }

  private submitYouTube() {
    if (this.youtubeUrl) {
      this.processYouTubeUrl(this.youtubeUrl);
    }
  }

  private async processYouTubeUrl(url: string) {
    this.error = '';
    const videoId = this.extractYouTubeId(url);
    if (!videoId) {
      this.error = 'Invalid YouTube URL.';
      return;
    }

    this.isLoading = true;
    try {
      const duration = await this.getYouTubeDuration(videoId);
      if (duration > 600) {
        this.error = 'YouTube video must be under 10 minutes.';
        return;
      }
      
      // Valid!
      appState.set('localVideoFile', undefined);
      appState.set('currentVideoId', videoId);
      appState.set('videoType', 'youtube');
      appState.set('videoSource', url);
      this.close();
    } catch (err) {
      this.error = 'YouTube video is inaccessible or invalid.';
    } finally {
      this.isLoading = false;
    }
  }

  private extractYouTubeId(url: string): string | null {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }

  private getYouTubeDuration(videoId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // Create a hidden div for the player
      const div = document.createElement('div');
      div.style.display = 'none';
      document.body.appendChild(div);

      const timeout = setTimeout(() => {
        reject(new Error('Timeout'));
        cleanup();
      }, 10000);

      let player: any;
      const cleanup = () => {
        clearTimeout(timeout);
        if (player && typeof player.destroy === 'function') player.destroy();
        div.remove();
      };

      // Ensure YT API is loaded
      if (!(window as any).YT || !(window as any).YT.Player) {
        reject(new Error('YT API not loaded'));
        cleanup();
        return;
      }

      player = new (window as any).YT.Player(div, {
        videoId: videoId,
        playerVars: {
          origin: window.location.origin,
        },
        events: {
          'onReady': (event: any) => {
            const dur = player.getDuration();
            resolve(dur);
            cleanup();
          },
          'onError': () => {
            reject(new Error('Video unavailable'));
            cleanup();
          }
        }
      });
    });
  }

  render() {
    return html`
      <dialog @cancel=${this.handleDialogCancel}>
        <div class="modal">
          <div class="header">
            <h2>Add Video</h2>
            <button class="close-btn" @click=${this.close}>&times;</button>
          </div>
          
          <div class="content">
            <div class="drop-zone ${this.isDragging ? 'dragging' : ''}"
                 @dragover=${this.handleDragOver}
                 @dragleave=${this.handleDragLeave}
                 @drop=${this.handleDrop}
                 @click=${() => this.shadowRoot?.querySelector('input[type="file"]')?.dispatchEvent(new MouseEvent('click'))}>
              Drag & drop a local video (Max 75MB, 10 min)<br/>or click to browse
              <input type="file" accept="video/*" style="display:none" @change=${this.handleFileInput}>
            </div>
            
            <div class="divider">OR</div>
            
            <div class="youtube-input-container">
              <input type="text" 
                     placeholder="Paste YouTube URL..." 
                     .value=${this.youtubeUrl}
                     @input=${this.handleYouTubeInput}
                     @keydown=${this.handleYouTubeKeyDown}>
              <button class="primary" 
                      id="add-youtube-btn"
                      ?disabled=${!this.youtubeUrl || this.isLoading} 
                      @click=${this.submitYouTube}>
                Add
              </button>
            </div>
            
            ${this.isLoading ? html`<div class="loading">Validating video...</div>` : ''}
            ${this.error ? html`<div class="error">${this.error}</div>` : ''}
          </div>
        </div>
      </dialog>
    `;
  }
}
