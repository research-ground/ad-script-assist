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
import {getVideoExporter} from '../../av/video_exporter';
import {AppController} from '../controller/app_controller';
import {showConfirm} from './confirm_modal';

@customElement('top-bar')
export class TopBar extends LitElement {
  @state() private showExportMenu = false;
  @state() private isLocalVideo = false;
  @state() private canExportVideo = false;
  @state() private isPlayEnabled = false;
  @state() private isExportEnabled = false;
  @state() private isClearEnabled = false;

  private readonly controller = AppController.getInstance();
  private unsubscribes: Array<() => void> = [];

  override connectedCallback() {
    super.connectedCallback();
    this.unsubscribes.push(
      appState.subscribe('localVideoFile', (file) => {
        this.isLocalVideo = !!file;
      }),
      appState.subscribe('isPlayEnabled', (val) => {
        this.isPlayEnabled = val;
      }),
      appState.subscribe('isExportEnabled', (val) => {
        this.isExportEnabled = val;
      }),
      appState.subscribe('isClearEnabled', (val) => {
        this.isClearEnabled = val;
      })
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const unsub of this.unsubscribes) {
      unsub();
    }
  }

  private toggleExportMenu() {
    this.showExportMenu = !this.showExportMenu;
    if (this.showExportMenu && this.isLocalVideo) {
      void getVideoExporter()
        .then((exporter) => exporter.isSupported())
        .then(
          (supported) => (this.canExportVideo = supported),
          () => (this.canExportVideo = false),
        );
    }
  }

  private handleExport(type: string) {
    this.showExportMenu = false;
    void this.controller.exportFile(type, appState.get('localVideoFile'));
  }

  private async handleClearProject() {
    const isConfirmed = await showConfirm(
      'Clear Project',
      'Are you sure you want to clear the current project? This cannot be undone.',
      'Clear',
      'Cancel',
      true
    );
    if (!isConfirmed) return;
    await this.controller.clearVideoData();
    location.reload();
  }

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      background-color: var(--secondary-bg, #ffffff);
      border-bottom: 1px solid var(--border-color, #dadce0);
      z-index: 10;
      flex-shrink: 0;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 40px;
      padding: 0 16px;
      box-sizing: border-box;
    }

    .title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-icon {
      color: var(--accent-color, #1a73e8);
      font-size: 20px;
    }

    h1 {
      margin: 0;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--primary-text, #202124);
      letter-spacing: 0.02em;
    }

    .action-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    button, a.button-link {
      display: flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 4px 8px;
      color: var(--secondary-text, #5f6368);
      font-family: inherit;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.1s ease;
      text-decoration: none;
      box-sizing: border-box;
    }

    button:hover, a.button-link:hover {
      background-color: var(--tertiary-bg, #f8f9fa);
      color: var(--primary-text, #202124);
    }

    button.primary-btn {
      background-color: var(--accent-color, #1a73e8);
      color: #ffffff;
      border-color: var(--accent-color, #1a73e8);
    }

    button.primary-btn:hover {
      background-color: var(--accent-hover, #1557b0);
      color: #ffffff;
    }

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
      -webkit-font-feature-settings: 'liga';
      -webkit-font-smoothing: antialiased;
    }

    button .material-icons, a.button-link .material-icons {
      font-size: 18px;
    }

    .dropdown {
      position: relative;
    }

    .dropdown-menu {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      background: var(--secondary-bg, #ffffff);
      border: 1px solid var(--border-color, #dadce0);
      border-radius: 4px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      padding: 4px;
      min-width: 150px;
      z-index: 100;
    }

    .dropdown-menu button {
      width: 100%;
      text-align: left;
      padding: 8px 12px;
      border-radius: 4px;
      justify-content: flex-start;
      border: none;
      background: transparent;
    }

    .dropdown-menu button:hover {
      background-color: var(--tertiary-bg, #f8f9fa);
    }
  `;

  override render() {
    return html`
      <div class="toolbar" role="toolbar" aria-label="Global Application Actions">
        <div class="title-group">
          <span class="material-icons logo-icon" aria-hidden="true">movie_edit</span>
          <h1>AD Script Assist</h1>
        </div>
        
        <div class="action-group">
          <button @click=${() => this.controller.openAddVideo()} aria-label="Add Video">
            <span class="material-icons" aria-hidden="true">video_call</span>
            Add Video
          </button>
          
          <button class="primary-btn" @click=${() => this.controller.generateAd()} ?disabled=${!this.isPlayEnabled} aria-label="(Re)Generate AD">
            <span class="material-icons" aria-hidden="true">auto_awesome</span>
            (Re)Generate AD
          </button>
          
          <button @click=${this.handleClearProject} ?disabled=${!this.isClearEnabled} aria-label="Clear Project" style="color: #ef4444;">
            <span class="material-icons" aria-hidden="true">delete_sweep</span>
            Clear Project
          </button>
          
          <div class="dropdown">
            <button @click=${this.toggleExportMenu} ?disabled=${!this.isExportEnabled} aria-label="Export Menu">
              <span class="material-icons" aria-hidden="true">file_download</span>
              Export
            </button>
            ${this.showExportMenu ? html`
              <div class="dropdown-menu">
                <button @click=${() => this.handleExport('webvtt')}>Export WebVTT</button>
                <button @click=${() => this.handleExport('audio')}>Export Audio</button>
                <button
                  @click=${() => this.handleExport('video')}
                  ?disabled=${!this.isLocalVideo || !this.canExportVideo}
                  title=${!this.isLocalVideo
                    ? 'Only available for local videos'
                    : !this.canExportVideo
                      ? 'Requires a browser with built-in AAC audio encoding'
                      : ''}
                >Export Mixed Video</button>

              </div>
            ` : ''}
          </div>
          <button @click=${() => this.dispatchEvent(new CustomEvent('toggle-debug'))} aria-label="Toggle Debug">
            <span class="material-icons" aria-hidden="true">bug_report</span>
            Debug
          </button>
          
          <button @click=${() => this.controller.openSettings()} aria-label="Settings">
            <span class="material-icons" aria-hidden="true">settings</span>
            Settings
          </button>
          
          <button @click=${() => this.controller.openHelp()} aria-label="Help">
            <span class="material-icons" aria-hidden="true">help_outline</span>
            Help
          </button>
        </div>
      </div>
    `;
  }
}
