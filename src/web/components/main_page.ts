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
import {
  formatTimeForOverlay,
  formatTimeForScreenReader,
} from '../../core/time_utils';
import type {AdSegment, AgentContext, AgentResponse} from '../../core/types';
import {getVoicesForTtsProvider} from '../../core/constants';
import {adAudioManager} from '../../av/ad_audio_manager';
import {AppController} from '../controller/app_controller';

import './ad_text_area';
import type {AdTextArea} from './ad_text_area';
import './agent_chat';
import type {AgentChat} from './agent_chat';
import './agent_input';
import type {AgentInput} from './agent_input';
import './confirm_modal';
import {showConfirm} from './confirm_modal';
import './settings_modal';
import type {SettingsModal} from './settings_modal';
import './add_video_modal';
import type {AddVideoModal} from './add_video_modal';
import './help_modal';
import type {HelpModal} from './help_modal';
import './video_controls';
import type {VideoControls} from './video_controls';
import './video_player';
import type {AdVideoPlayer} from './video_player';
import './video-url-input';
import type {VideoUrlInput} from './video-url-input';
import './top_bar';
import type {TopBar} from './top_bar';

/**
 * Main application component.
 * Coordinative view component that delegates logic to AppController.
 */
@customElement('main-page')
export class MainPage extends LitElement {
  @state() private currentVideoId = '';
  @state() private localVideoFile?: File;
  @state() private isVideoPaused = true;
  @state() private currentTime = 0;
  @state() private videoDuration = 0;
  @state() private statusMessage = 'Ready';
  @state() private adSegments: AdSegment[] = [];

  @state() isAdTextAreaFocused = false;
  @state() isAdAudioGenerating = false;
  @state() ttsLanguage = 'en-US';
  @state() ttsVoice = 'Aoede';
  @state() ttsProvider: 'gemini' | 'openai' | 'kokoro' = 'gemini';
  @state() speakAdText = true;
  @state() private scriptNotes = '';

  @state() leftColWidth = 25;
  @state() rightColWidth = 25;
  private isResizing: 'left' | 'right' | null = null;
  private scriptDebounceTimer?: ReturnType<typeof setTimeout>;
  
  // Component References
  @query('#videoPlayerComponent') videoPlayerComponent!: AdVideoPlayer;
  @query('#videoControls') videoControls!: VideoControls;
  @query('video-url-input') videoUrlInput!: VideoUrlInput;
  @query('#adTextArea') adTextArea!: AdTextArea;
  @query('#agentInputComponent') agentInput!: AgentInput;
  @query('#agentChat') agentChat!: AgentChat;
  @query('settings-modal') settingsModal!: SettingsModal;

  private readonly controller = AppController.getInstance();
  private readonly unsubscribes: Array<() => void> = [];

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      
      --primary-bg: #f1f3f4;
      --secondary-bg: #ffffff;
      --tertiary-bg: #f8f9fa;
      
      --primary-text: #202124;     
      --secondary-text: #5f6368;   
      --accent-text: #ffffff;      
      
      --accent-color: #1a73e8;     
      --accent-hover: #1557b0;     
      
      --border-color: #dadce0;     
      --error-color: #d93025;      
    }

    .app-container {
      display: flex;
      flex: 1;
      min-height: 0;
      background-color: var(--primary-bg);
      color: var(--primary-text);
      width: 100%;
      position: relative;
    }

    .status-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 24px;
      padding: 0 12px;
      background-color: var(--primary-bg);
      border-top: 1px solid var(--border-color);
      color: var(--secondary-text);
      font-size: 0.75rem;
      flex-shrink: 0;
      z-index: 10;
    }

    .status-left, .status-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .status-bar .material-icons {
      font-size: 14px;
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

    .column {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }

    .left-column {
      flex-shrink: 0;
      min-width: 320px;
      background-color: var(--secondary-bg);
    }

    .center-column {
      flex: 1;
      overflow: hidden;
      min-width: 400px;
      background-color: var(--primary-bg);
    }

    .right-column {
      flex-shrink: 0;
      min-width: 320px;
      background-color: var(--secondary-bg);
    }

    .splitter {
      width: 8px;
      margin: 0 -4px;
      background-color: transparent;
      cursor: col-resize;
      z-index: 5;
      position: relative;
    }
    .splitter::after {
      content: '';
      position: absolute;
      top: 0; bottom: 0; left: 3px; right: 4px;
      background-color: var(--border-color);
      transition: background-color 0.2s ease;
    }
    .splitter:hover::after, .splitter:active::after, .splitter:focus-visible::after {
      background-color: var(--accent-color);
    }
    .splitter:focus-visible {
      outline: 2px solid var(--accent-color);
      outline-offset: -2px;
    }

    section {
      display: flex;
      flex-direction: column;
      background-color: var(--secondary-bg);
      border-bottom: 1px solid var(--border-color);
      min-height: 0;
      padding: 16px;
    }
    
    .video-player-section {
      flex: 0 0 auto;
    }

    .agent-chat-container {
      flex: 1;
    }
    
    .project-settings-section {
      flex: 1;
    }

    .settings-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-top: 8px;
    }

    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.85rem;
    }

    .form-select {
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
      background: var(--primary-bg);
      color: var(--primary-text);
      font-family: inherit;
      font-size: 0.85rem;
    }

    .form-select:focus-visible,
    input[type="checkbox"]:focus-visible,
    textarea:focus-visible {
      outline: 2px solid var(--accent-color);
      outline-offset: 2px;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }
    
    .ad-script-section {
      flex: 1;
      border-bottom: none;
      background-color: var(--secondary-bg);
      padding: 0;
    }

    h1, h2 {
      margin: -16px -16px 16px -16px;
      padding: 8px 16px;
      font-size: 0.75em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--secondary-text);
      background-color: var(--tertiary-bg);
      border-bottom: 1px solid var(--border-color);
      user-select: none;
    }

    .video-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: -16px -16px 16px -16px;
      padding: 8px 16px;
      background-color: var(--tertiary-bg);
      border-bottom: 1px solid var(--border-color);
    }

    .video-section-header h2 {
      margin: 0;
      padding: 0;
      border-bottom: none;
      background: none;
    }

    .video-duration-badge {
      font-size: 0.75em;
      color: var(--secondary-text);
      font-family: monospace;
    }

    .ad-textarea-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background-color: var(--tertiary-bg);
      border-bottom: 1px solid var(--border-color);
      padding: 8px 16px;
    }
    
    .ad-textarea-header h1, .ad-textarea-header h2 {
      margin: 0;
      padding: 0;
      border-bottom: none;
      background: none;
    }

    .ad-header-status {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--secondary-text);
      font-size: 0.75em;
    }

    .ad-header-status.speech-ready {
      color: #1e8e3e;
    }

    .speech-dot {
      width: 7px;
      height: 7px;
      display: inline-block;
      box-sizing: border-box;
      border-radius: 1px;
    }

    .speech-dot.ready {
      background-color: #1e8e3e;
      transform: rotate(45deg);
    }

    .speech-dot.pending {
      background-color: #f9ab00;
      border-radius: 50%;
    }

    .ad-header-status .loading-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(0, 0, 0, 0.1);
      border-left-color: var(--accent-color, #0078d4);
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
  `;

  override async connectedCallback() {
    super.connectedCallback();

    this.controller.registerUICallbacks({
      onScriptUpdate: (script) => {
        appState.set('editorScriptText', script);
        if (this.adTextArea) {
          this.adTextArea.setScript(script);
        }
      },
      onGoToLine: (line) => {
        appState.set('editorCursorLine', line);
        if (this.adTextArea) {
          this.adTextArea.goToLine(line);
        }
      }
    });

    await this.controller.initialize();

    this.unsubscribes.push(
      appState.subscribe('currentVideoId', (id) => {
        this.currentVideoId = id;
      })
    );
    this.unsubscribes.push(
      appState.subscribe('localVideoFile', (file) => {
        this.localVideoFile = file;
      })
    );
    this.unsubscribes.push(
      appState.subscribe('isVideoPaused', (paused) => {
        this.isVideoPaused = paused;
      })
    );
    this.unsubscribes.push(
      appState.subscribe('currentTime', (time) => {
        this.currentTime = time;
      })
    );
    this.unsubscribes.push(
      appState.subscribe('statusMessage', (msg) => {
        if (msg) this.statusMessage = msg;
      })
    );
    this.unsubscribes.push(
      appState.subscribe('ttsVoice', (voice) => {
        this.ttsVoice = voice;
      })
    );
    this.unsubscribes.push(
      appState.subscribe('ttsProvider', (provider) => {
        this.ttsProvider = (provider as 'gemini' | 'openai' | 'kokoro') || 'gemini';
      })
    );
    this.unsubscribes.push(
      appState.subscribe('speakAdText', (val) => {
        this.speakAdText = val;
      })
    );
    this.unsubscribes.push(
      appState.subscribe('scriptNotes', (val) => {
        this.scriptNotes = val || '';
      })
    );
    this.unsubscribes.push(
      appState.subscribe('isAdAudioGenerating', (generating) => {
        this.isAdAudioGenerating = !!generating;
      })
    );
    this.unsubscribes.push(
      appState.subscribe('ttsLanguage', (lang) => {
        this.ttsLanguage = lang as string;
      })
    );
    this.unsubscribes.push(
      appState.subscribe('adSegments', (segments) => {
        this.adSegments = segments ? [...segments] : [];
      })
    );
    this.unsubscribes.push(
      appState.subscribe('videoDuration', (duration) => {
        this.videoDuration = duration || 0;
      })
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.scriptDebounceTimer) {
      clearTimeout(this.scriptDebounceTimer);
    }
    this.controller.destroy();
    for (const unsub of this.unsubscribes) {
      unsub();
    }
  }

  override firstUpdated() {
    this.setupHotkeys();
    const initialScript = appState.get('editorScriptText');
    if (initialScript && this.adTextArea) {
      this.adTextArea.setScript(initialScript);
    }
  }

  override updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);
    if (this.videoPlayerComponent) {
      appState.set('videoPlayerApi', this.videoPlayerComponent);
    } else {
      appState.set('videoPlayerApi', undefined);
    }
  }

  setupHotkeys() {
    const actions: Record<string, () => void> = {
      'TOGGLE_PLAY_PAUSE': () => {
        void this.controller.togglePlayPause();
      },
      'JUMP_BACKWARD': () => {
        this.controller.jumpBackward();
      },
      'JUMP_FORWARD': () => {
        this.controller.jumpForward();
      },
      'MOVE_TO_COMMAND': () => {
        appState.set('statusMessage', 'Moved to conversation agent');
        this.agentInput.focus();
      },
      'MOVE_TO_EDITOR': () => {
        appState.set('statusMessage', 'Moved to text editing area');
        this.moveToTextArea();
      },
      'REGENERATE_AD_SCRIPT': () => {
        void this.controller.generateAd();
      },
      'EXPORT_AUDIO_DESCRIPTION': () => {
        void this.controller.exportFile('audio', this.localVideoFile);
      },
      'READ_CURRENT_LINE': () => {
        this.readCurrentLine();
      },
      'DESCRIBE_HIGH_LEVEL_SUMMARY': () => {
        this.setAgentInputCommand(
          'Describe high-level summary of this video for me, do not change the AD script.',
        );
      },
      'CLEAR_VIDEO_DATA': () => {
        void this.clearVideoData();
      },
    };

    this.controller.setupHotkeys(actions);
  }

  readCurrentLine() {
    const lineNumber = this.adTextArea.getLineNumber();
    if (this.isAdTextAreaFocused) {
      appState.set('statusMessage', `Line ${lineNumber}`);
    } else {
      appState.set('statusMessage', `Last focused on line ${lineNumber}`);
    }
  }

  async setCurrentVideo(videoId: string) {
    appState.set('currentVideoId', videoId);
    appState.set('isVideoPaused', true);

    await this.updateComplete;
    if (this.videoPlayerComponent) {
      this.videoPlayerComponent.videoId = videoId;
      await this.videoPlayerComponent.updateComplete;
      appState.set('statusMessage', 'Video loaded successfully.');
    }
  }

  handleVideoLoad(e: CustomEvent) {
    const videoId = e.detail.videoId;
    void this.setCurrentVideo(videoId);
    this.agentInput.focus();
  }

  async clearVideoData() {
    if (!this.currentVideoId) return;
    const isConfirmed = await showConfirm(
      'Clear Video Data',
      'Are you sure you want to clear the current video and all its cached data?',
      'Clear Data',
      'Cancel',
      true
    );
    if (isConfirmed) {
      await this.controller.clearVideoData();
      if (this.videoPlayerComponent) {
        this.videoPlayerComponent.videoId = '';
      }
      if (this.videoUrlInput) {
        this.videoUrlInput.clear();
      }
    }
  }

  handleAgentCommand(e: CustomEvent) {
    const context = this.controller.getAgentContext(this.adTextArea.value, this.adTextArea.getLineNumber());
    void this.controller.sendMessage(e.detail.command, context);
  }

  moveToTextArea() {
    this.adTextArea.focus();
    this.isAdTextAreaFocused = true;
  }

  setAgentInputCommand(command: string) {
    this.agentInput.value = command;
    this.agentInput.focus();
    const context = this.controller.getAgentContext(this.adTextArea.value, this.adTextArea.getLineNumber());
    void this.controller.sendMessage(command, context);
  }

  private startResize(e: MouseEvent, side: 'left' | 'right') {
    e.preventDefault();
    this.isResizing = side;
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', this.doResize);
    window.addEventListener('mouseup', this.stopResize);
  }

  private doResize = (e: MouseEvent) => {
    if (!this.isResizing) return;
    
    const appContainer = this.shadowRoot!.querySelector('.app-container') as HTMLElement;
    if (!appContainer) return;
    
    const containerWidth = appContainer.getBoundingClientRect().width;
    
    if (this.isResizing === 'left') {
      let newWidth = (e.clientX / containerWidth) * 100;
      newWidth = Math.max(15, Math.min(newWidth, 50));
      this.leftColWidth = newWidth;
    } else if (this.isResizing === 'right') {
      let newWidth = ((containerWidth - e.clientX) / containerWidth) * 100;
      newWidth = Math.max(15, Math.min(newWidth, 50));
      this.rightColWidth = newWidth;
    }
  }

  private stopResize = () => {
    this.isResizing = null;
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', this.doResize);
    window.removeEventListener('mouseup', this.stopResize);
  }

  private handleSplitterKeydown(e: KeyboardEvent, side: 'left' | 'right') {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = 2;
    if (side === 'left') {
      const delta = e.key === 'ArrowRight' ? step : -step;
      this.leftColWidth = Math.max(15, Math.min(50, this.leftColWidth + delta));
    } else {
      const delta = e.key === 'ArrowLeft' ? step : -step;
      this.rightColWidth = Math.max(15, Math.min(50, this.rightColWidth + delta));
    }
  }

  private renderSpeechStatus() {
    const nonEmpty = this.adSegments.filter((s) => s.script.trim().length > 0);
    const total = nonEmpty.length;
    const ready = nonEmpty.filter((s) => Boolean(s.audioData)).length;

    if (this.isAdAudioGenerating) {
      return html`
        <div class="ad-header-status" role="status" aria-live="polite">
          <span class="loading-spinner" aria-hidden="true"></span>
          <span>${total > 0 ? `Generating speech (${ready}/${total})...` : 'Generating speech...'}</span>
        </div>
      `;
    }

    if (total === 0) {
      return '';
    }

    if (ready === total) {
      return html`
        <div class="ad-header-status speech-ready" role="status" aria-live="polite" title="Speech generated for all ${total} cue(s)">
          <span class="speech-dot ready" aria-hidden="true"></span>
          <span>Speech ready (${ready})</span>
        </div>
      `;
    }

    return html`
      <div class="ad-header-status" role="status" aria-live="polite" title="Speech generated for ${ready} of ${total} cue(s)">
        <span class="speech-dot pending" aria-hidden="true"></span>
        <span>Speech ${ready}/${total}</span>
      </div>
    `;
  }

  override render() {
    return html`
      <top-bar></top-bar>
      <add-video-modal></add-video-modal>
      <div class="app-container" data-test-id="main-page-ready">
        <!-- Left Column -->
        <div id="leftColumn" class="column left-column" style="width: ${this.leftColWidth}%;">
          <!-- Video Section -->
          <section
            id="videoPlayer"
            class="video-player-section"
            aria-label="Video Player Section">
            <div class="video-section-header">
              <h2>Video</h2>
              ${this.videoDuration > 0 && (this.currentVideoId || this.localVideoFile)
                ? html`<span class="video-duration-badge" title="Total Video Duration">Duration: ${formatTimeForOverlay(this.videoDuration)}</span>`
                : ''}
            </div>
            
            ${!this.currentVideoId && !this.localVideoFile
              ? html`
                  <div
                    role="region"
                    aria-labelledby="onboarding-title"
                    style="padding: 24px 20px; text-align: center; border: 2px dashed var(--border-color, #dadce0); border-radius: 8px; margin: 8px 0 12px 0; background: var(--tertiary-bg, #f8f9fa);"
                  >
                    <h3 id="onboarding-title" style="margin: 0 0 8px 0; font-size: 0.95rem; color: var(--primary-text, #202124);">Get Started with AD Script Assist</h3>
                    <p style="margin: 0; font-size: 0.82rem; color: var(--secondary-text, #5f6368); line-height: 1.4;">
                      <strong>Step 1:</strong> Use the <strong>Add Video</strong> button in the top toolbar to select a local video file or YouTube URL.<br />
                      <strong>Step 2:</strong> Write cues manually or generate an AI Audio Description script.
                    </p>
                  </div>
                `
              : html`
            <video-player
              id="videoPlayerComponent"
              @play=${() => {
                appState.set('isVideoPaused', false);
              }}
              @pause=${() => {
                appState.set('isVideoPaused', true);
              }}
              @seeking=${() => this.controller.syncAdAudioWithVideo()}
              @seeked=${() => this.controller.syncAdAudioWithVideo()}
              @timeupdate=${() => {
                if (this.videoPlayerComponent) {
                  const t = this.videoPlayerComponent.currentTime;
                  appState.set('currentTime', t);
                  this.controller.handleTimeUpdate(t);
                }
              }}></video-player>
              `
            }

            <video-controls
              id="videoControls"
              @restart=${() => this.controller.jumpToStart()}
              @play-pause=${() => this.controller.togglePlayPause()}
              @rewind=${() => this.controller.jumpBackward()}
              @forward=${() => this.controller.jumpForward()}
              @export-ad-track=${() => {
                void this.controller.exportFile('audio', this.localVideoFile);
              }}
              @clear-video-data=${() => {
                void this.clearVideoData();
              }}
              @open-settings=${() => {
                this.settingsModal.open();
              }}></video-controls>
          </section>

          <!-- Project Settings Section -->
          <section class="project-settings-section" aria-labelledby="project-settings-heading">
            <h2 id="project-settings-heading">Project Settings</h2>
            <div class="settings-content">
              <div class="settings-subsection" role="group" aria-labelledby="voice-settings-heading" style="width: 100%; display: flex; flex-direction: column; gap: 8px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color, #dadce0);">
                <h3 id="voice-settings-heading" style="margin: 0; font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text, #5f6368);">Voice Settings</h3>
                <div class="setting-row">
                  <label for="speakToggle" class="checkbox-label">
                    <input 
                      type="checkbox" 
                      id="speakToggle" 
                      .checked=${this.speakAdText}
                      @change=${(e: Event) => {
                        const checked = (e.target as HTMLInputElement).checked;
                        appState.set('speakAdText', checked);
                      }}
                    />
                    Speak AD Text
                  </label>
                </div>
                <div class="setting-row">
                  <label for="voiceSelect">Voice</label>
                  <select
                    id="voiceSelect"
                    class="form-select"
                    .value=${this.ttsVoice}
                    @change=${async (e: Event) => {
                      const select = e.target as HTMLSelectElement;
                      const newVoice = select.value;
                      const oldVoice = this.ttsVoice;
                      
                      if (newVoice === oldVoice) return;
                      
                      const segments = appState.get('adSegments') || [];
                      const hasSpeech = segments.some(s => !!s.audioData);
                      
                      if (hasSpeech) {
                        const isConfirmed = await showConfirm(
                          'Change Voice',
                          'You have already generated speech. Do you want to regenerate it with the new voice?',
                          'Regenerate',
                          'Cancel',
                          true
                        );
                        
                        if (isConfirmed) {
                          this.ttsVoice = newVoice;
                          appState.set('ttsVoice', newVoice);
                          void adAudioManager.regenerateAdAudio(true);
                        } else {
                          select.value = oldVoice;
                        }
                      } else {
                        this.ttsVoice = newVoice;
                        appState.set('ttsVoice', newVoice);
                        if (segments.length > 0) {
                          void adAudioManager.regenerateAdAudio(true);
                        }
                      }
                    }}
                  >
                    ${getVoicesForTtsProvider(this.ttsProvider).map(
                      (v) => html`<option value="${v.name}" ?selected=${this.ttsVoice === v.name}>${v.label}</option>`
                    )}
                  </select>
                </div>
              </div>

              <div class="settings-subsection" role="group" aria-labelledby="script-settings-heading" style="width: 100%; display: flex; flex-direction: column; gap: 6px; padding-top: 4px;">
                <h3 id="script-settings-heading" style="margin: 0; font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text, #5f6368);">Script Settings</h3>
                <div class="setting-row-notes" style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                  <label for="scriptNotes" style="font-weight: 500;">Script Notes</label>
                  <textarea
                    id="scriptNotes"
                    style="width: 100%; min-height: 80px; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--primary-bg); color: var(--primary-text); font-family: inherit; font-size: 0.85rem; resize: vertical; box-sizing: border-box;"
                    .value=${this.scriptNotes}
                    @input=${(e: Event) => {
                      const value = (e.target as HTMLTextAreaElement).value;
                      appState.set('scriptNotes', value);
                    }}
                    placeholder="Style, vocabulary rules, or characters..."
                  ></textarea>
                </div>
              </div>
            </div>
          </section>

          <settings-modal></settings-modal>
          <help-modal></help-modal>
        </div>

        <div
          class="splitter"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          aria-label="Resize left panel"
          aria-valuemin="15"
          aria-valuemax="50"
          aria-valuenow=${Math.round(this.leftColWidth)}
          @mousedown=${(e: MouseEvent) => this.startResize(e, 'left')}
          @keydown=${(e: KeyboardEvent) => this.handleSplitterKeydown(e, 'left')}
        ></div>

        <!-- Center Column -->
        <div id="centerColumn" class="column center-column">
          <!-- Ad Script Section -->
          <section
            id="ad-script"
            class="ad-script-section"
            aria-label="Audio Description Script Editor">
            <div class="ad-textarea-header">
              <h2>Script Editor</h2>
              ${this.renderSpeechStatus()}
            </div>
            <ad-text-area
              id="adTextArea"
              .segments=${this.adSegments}
              .isGenerating=${this.isAdAudioGenerating}
              @focus=${() => (this.isAdTextAreaFocused = true)}
              @blur=${() => (this.isAdTextAreaFocused = false)}
              @script-changed=${(e: CustomEvent) => {
                appState.set('editorScriptText', e.detail.value);
                this.controller.syncScriptSegments(e.detail.value, false);
                if (this.scriptDebounceTimer) {
                  clearTimeout(this.scriptDebounceTimer);
                }
                this.scriptDebounceTimer = setTimeout(() => {
                  void adAudioManager.regenerateAdAudio();
                }, 1500);
              }}
              @cursor-line-changed=${(e: CustomEvent) => {
                appState.set('editorCursorLine', e.detail.line);
              }}
              @editor-blur=${() => {
                if (this.scriptDebounceTimer) {
                  clearTimeout(this.scriptDebounceTimer);
                  this.scriptDebounceTimer = undefined;
                }
                void this.controller.syncScriptSegments(this.adTextArea.value, true);
              }}
              @seek-video=${(e: CustomEvent) => {
                if (this.videoPlayerComponent) {
                   this.videoPlayerComponent.seek(e.detail.time);
                   this.videoPlayerComponent.play();
                }
              }}></ad-text-area>
          </section>
        </div>

        <div
          class="splitter"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          aria-label="Resize right panel"
          aria-valuemin="15"
          aria-valuemax="50"
          aria-valuenow=${Math.round(this.rightColWidth)}
          @mousedown=${(e: MouseEvent) => this.startResize(e, 'right')}
          @keydown=${(e: KeyboardEvent) => this.handleSplitterKeydown(e, 'right')}
        ></div>

        <!-- Right Column -->
        <div id="rightColumn" class="column right-column" style="width: ${this.rightColWidth}%;">
          <!-- Agent Chat Section -->
          <section
            id="agentChatContainer"
            class="agent-chat-container"
            aria-label="AI Chat">
            <h2>AI Chat</h2>
            <agent-chat id="agentChat"></agent-chat>

            <agent-input
              id="agentInputComponent"
              .isVideoLoaded=${!!this.currentVideoId}
              @submit-command=${this.handleAgentCommand}></agent-input>
          </section>
        </div>
      </div>
      
      <div class="status-bar" role="status" aria-live="polite" aria-atomic="true">
        <div class="status-left">
          <span>${this.statusMessage}</span>
        </div>
      </div>
    `;
  }
}
