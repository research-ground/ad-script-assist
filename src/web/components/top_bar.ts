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
  @state() private isGenerateEnabled = false;
  @state() private isExportEnabled = false;
  @state() private isClearEnabled = false;
  @state() private isAgentResponding = false;

  private readonly controller = AppController.getInstance();
  private unsubscribes: Array<() => void> = [];

  private readonly handleOutsideClick = (e: MouseEvent) => {
    if (!this.showExportMenu) return;
    const path = e.composedPath();
    const dropdown = this.shadowRoot?.querySelector('.dropdown');
    if (dropdown && !path.includes(dropdown)) {
      this.showExportMenu = false;
    }
  };

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this.handleOutsideClick);
    this.unsubscribes.push(
      appState.subscribe('localVideoFile', (file) => {
        this.isLocalVideo = !!file;
      }),
      appState.subscribe('isPlayEnabled', (val) => {
        this.isPlayEnabled = val;
      }),
      appState.subscribe('isGenerateEnabled', (val) => {
        this.isGenerateEnabled = val;
      }),
      appState.subscribe('isExportEnabled', (val) => {
        this.isExportEnabled = val;
      }),
      appState.subscribe('isClearEnabled', (val) => {
        this.isClearEnabled = val;
      }),
      appState.subscribe('isAgentResponding', (val) => {
        this.isAgentResponding = !!val;
      })
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleOutsideClick);
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
    if (this.showExportMenu) {
      void this.updateComplete.then(() => {
        const firstItem = this.shadowRoot?.querySelector<HTMLButtonElement>(
          '.dropdown-menu button:not([disabled])',
        );
        firstItem?.focus();
      });
    }
  }

  private handleExportMenuKeydown(e: KeyboardEvent) {
    const items = Array.from(
      this.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        '.dropdown-menu button:not([disabled])',
      ) || [],
    );
    if (e.key === 'Escape') {
      e.preventDefault();
      this.showExportMenu = false;
      const trigger = this.shadowRoot?.querySelector<HTMLButtonElement>(
        '#exportMenuButton',
      );
      trigger?.focus();
      return;
    }
    if (e.key === 'Tab') {
      this.showExportMenu = false;
      return;
    }
    if (items.length === 0) return;
    const currentIndex = items.indexOf(
      (this.shadowRoot?.activeElement as HTMLButtonElement) || items[0],
    );
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[(currentIndex + 1) % items.length];
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[(currentIndex - 1 + items.length) % items.length];
      prev?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
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

    .info-icon {
      color: var(--secondary-text, #5f6368);
      font-size: 16px;
      cursor: help;
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

    button:focus-visible, a.button-link:focus-visible {
      outline: 2px solid var(--accent-color, #1a73e8);
      outline-offset: 2px;
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

    button.primary-btn:hover:not(:disabled) {
      background-color: var(--accent-hover, #1557b0);
      color: #ffffff;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
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
          <span
            class="info-icon"
            role="img"
            aria-label="About AD Script Assist: Create, edit, and synthesize Audio Description scripts for videos."
            title="Create, edit, and synthesize Audio Description scripts for videos."
          ><span class="material-icons" aria-hidden="true">info_outline</span></span>
        </div>
        
        <div class="action-group">
          <button @click=${() => this.controller.openAddVideo()} aria-label="Add Video" aria-haspopup="dialog">
            <span class="material-icons" aria-hidden="true">video_call</span>
            Add Video
          </button>
          
          <button
            class="primary-btn"
            @click=${() => void this.controller.generateAd()}
            ?disabled=${!this.isGenerateEnabled}
            aria-busy=${this.isAgentResponding ? 'true' : 'false'}
            aria-label="Generate AD"
            title=${!this.isPlayEnabled
              ? 'Load a video first to generate an Audio Description script'
              : !this.isGenerateEnabled
                ? 'Configure a VLM provider and API key in models.conf to generate an Audio Description script'
                : 'Generate an Audio Description script with AI'}
          >
            <span class="material-icons" aria-hidden="true">auto_awesome</span>
            Generate AD
          </button>
          
          <button @click=${this.handleClearProject} ?disabled=${!this.isClearEnabled} aria-label="Clear Project" style="color: var(--error-color, #d93025);">
            <span class="material-icons" aria-hidden="true">delete_sweep</span>
            Clear Project
          </button>
          
          <div class="dropdown">
            <button
              id="exportMenuButton"
              @click=${this.toggleExportMenu}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'ArrowDown' && !this.showExportMenu) {
                  e.preventDefault();
                  this.toggleExportMenu();
                } else if (e.key === 'Escape' && this.showExportMenu) {
                  e.preventDefault();
                  this.showExportMenu = false;
                }
              }}
              ?disabled=${!this.isExportEnabled}
              aria-label="Export Menu"
              aria-haspopup="menu"
              aria-expanded=${this.showExportMenu ? 'true' : 'false'}
            >
              <span class="material-icons" aria-hidden="true">file_download</span>
              Export
            </button>
            ${this.showExportMenu ? html`
              <div
                class="dropdown-menu"
                role="menu"
                aria-label="Export Options"
                @keydown=${this.handleExportMenuKeydown}
              >
                <button role="menuitem" @click=${() => this.handleExport('webvtt')}>Export WebVTT</button>
                <button role="menuitem" @click=${() => this.handleExport('audio')}>Export Audio</button>
                <button
                  role="menuitem"
                  @click=${() => this.handleExport('video')}
                  ?disabled=${!this.isLocalVideo || !this.canExportVideo}
                  title=${!this.isLocalVideo
                    ? 'Only available for local videos'
                    : !this.canExportVideo
                      ? 'Requires a browser with built-in AAC audio encoding'
                      : ''}
                >Export Mixed Video</button>
                <button role="menuitem" @click=${() => this.handleExport('all')}>Export All</button>
              </div>
            ` : ''}
          </div>
          
          <button @click=${() => this.controller.openSettings()} aria-label="Settings" aria-haspopup="dialog">
            <span class="material-icons" aria-hidden="true">settings</span>
            Settings
          </button>
          
          <button @click=${() => this.controller.openHelp()} aria-label="Help" aria-haspopup="dialog">
            <span class="material-icons" aria-hidden="true">help_outline</span>
            Help
          </button>
        </div>
      </div>
    `;
  }
}
