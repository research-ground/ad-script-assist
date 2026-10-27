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

import {css, html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';

import {HotkeyConfigEntry} from '../../core/types';
import {getDefaultHotkeyConfigs} from '../hotkeys';
import {
  retrieveHotkeyConfigsFromDB,
} from '../storage/db';
import {
  AGENT_MODEL_SUGGESTIONS,
  DEFAULT_AGENT_MODEL,
  DEFAULT_SPEECH_MODEL,
  getInjectedGeminiApiKey,
  SPEECH_MODEL_SUGGESTIONS,
  TTS_LANGUAGES,
} from '../../core/constants';
import {showConfirm} from './confirm_modal';
import {appState} from '../../core/app_state';
import {styles} from './settings_modal_styles';
import {AppController} from '../controller/app_controller';


/**
 * Component for configuring application settings (previously ModalDialog +
 * SettingsModal).
 */
@customElement('settings-modal')
export class SettingsModal extends LitElement {
  // It is safe to use non-nullability assertion here because the dialog element
  // is present in the shadow DOM and will be available after the first render.
  @query('dialog') dialog!: HTMLDialogElement;

  @state() currentHotkeys: HotkeyConfigEntry[] = [];
  @state() originalHotkeys: HotkeyConfigEntry[] = [];
  @state() currentApiKey: string = '';
  @state() originalApiKey: string = '';
  @state() currentLlmProvider: 'gemini' | 'openai' | 'none' = 'gemini';
  @state() originalLlmProvider: 'gemini' | 'openai' | 'none' = 'gemini';
  @state() currentTtsProvider: 'gemini' | 'openai' | 'kokoro' = 'gemini';
  @state() originalTtsProvider: 'gemini' | 'openai' | 'kokoro' = 'gemini';
  @state() currentTtsApiKey: string = '';
  @state() originalTtsApiKey: string = '';
  @state() currentLanguage: string = '';
  @state() originalLanguage: string = '';
  @state() currentAgentModel: string = '';
  @state() originalAgentModel: string = '';
  @state() currentSpeechModel: string = '';
  @state() originalSpeechModel: string = '';
  @state() private isLoadingConfigs = true;

  private defaultCombos = new Map<string, string | undefined>();

  constructor() {
    super();
  }

  static override styles = [
    css`
      dialog {
        padding: 0;
        border: none;
        border-radius: 8px;
        box-shadow:
          0 4px 6px -1px rgba(0, 0, 0, 0.1),
          0 2px 4px -1px rgba(0, 0, 0, 0.06);
        max-width: 90vw;
        max-height: 90vh;
        overflow: hidden; /* Changed to hidden to let internal container scroll if needed */
        background: transparent; /* Container handles background */
      }

      dialog::backdrop {
        background: rgba(0, 0, 0, 0.5);
      }

      .close-button {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: #666;
        z-index: 10;
      }

      .close-button:hover {
        color: #333;
      }
    `,
    styles,
  ];

  private readonly controller = AppController.getInstance();
  private unsubscribes: Array<() => void> = [];

  override async connectedCallback() {
    super.connectedCallback();
    // We set role="dialog" and aria-label="Settings" on the host to satisfy
    // the accessibility audit goldens. While the internal <dialog> also
    // provides these, the audit infrastructure expects them on the host.
    this.setAttribute('role', 'dialog');
    this.setAttribute('aria-label', 'Settings');
    
    this.unsubscribes.push(
      appState.subscribe('isSettingsModalOpen', (open) => {
        if (!this.dialog) return;
        if (open) {
          if (!this.dialog.open) {
            this.dialog.showModal();
            void this.loadConfigs();
          }
        } else {
          if (this.dialog.open) {
            this.dialog.close();
          }
        }
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

  /** Opens the modal dialog. */
  open() {
    this.controller.openSettings();
  }

  /** Closes the modal dialog. */
  close() {
    this.controller.closeSettings();
  }

  async loadConfigs() {
    this.isLoadingConfigs = true;
    try {
      if (this.defaultCombos.size === 0) {
        this.defaultCombos = new Map(
          getDefaultHotkeyConfigs().map((c) => [c.command, c.keyCombo]),
        );
      }
      this.currentHotkeys = await retrieveHotkeyConfigsFromDB();
      this.originalHotkeys = structuredClone(this.currentHotkeys);
      
      this.currentApiKey = appState.get('geminiApiKey') || appState.get('openaiApiKey') || '';
      this.originalApiKey = this.currentApiKey;
      this.currentLlmProvider = appState.get('llmProvider') || 'gemini';
      this.originalLlmProvider = this.currentLlmProvider;
      this.currentTtsProvider = appState.get('ttsProvider') || 'gemini';
      this.originalTtsProvider = this.currentTtsProvider;
      this.currentTtsApiKey = appState.get('ttsApiKey') || '';
      this.originalTtsApiKey = this.currentTtsApiKey;
      this.currentLanguage = appState.get('ttsLanguage');
      this.originalLanguage = this.currentLanguage;
      this.currentAgentModel = appState.get('agentModel');
      this.originalAgentModel = this.currentAgentModel;
      this.currentSpeechModel = appState.get('speechModel');
      this.originalSpeechModel = this.currentSpeechModel;
    } finally {
      this.isLoadingConfigs = false;
    }
  }

  handleKeyComboInput(e: Event, index: number) {
    if (!(e.target instanceof HTMLInputElement)) return;
    const target = e.target;
    const newConfigs = [...this.currentHotkeys];
    newConfigs[index] = {...newConfigs[index], keyCombo: target.value};
    this.currentHotkeys = newConfigs;
  }

  get hasChanges() {
    return (
      JSON.stringify(this.currentHotkeys) !==
        JSON.stringify(this.originalHotkeys) ||
      this.currentApiKey !== this.originalApiKey ||
      this.currentLlmProvider !== this.originalLlmProvider ||
      this.currentTtsProvider !== this.originalTtsProvider ||
      this.currentTtsApiKey !== this.originalTtsApiKey ||
      this.currentLanguage !== this.originalLanguage ||
      this.currentAgentModel !== this.originalAgentModel ||
      this.currentSpeechModel !== this.originalSpeechModel
    );
  }

  async saveConfigs() {
    try {
      // Save Hotkeys
      const changedHotkeys = this.currentHotkeys.filter(
        (config, index) =>
          JSON.stringify(config) !==
          JSON.stringify(this.originalHotkeys[index]),
      );

      await this.controller.saveSettings({
        geminiApiKey: this.currentApiKey,
        openaiApiKey: this.currentApiKey,
        llmProvider: this.currentLlmProvider,
        ttsProvider: this.currentTtsProvider,
        ttsApiKey: this.currentTtsApiKey,
        ttsLanguage: this.currentLanguage,
        agentModel: this.currentAgentModel,
        speechModel: this.currentSpeechModel,
        hotkeys: changedHotkeys.length > 0 ? this.currentHotkeys : undefined,
      });

      this.close();
    } catch (err) {
      console.error('Error saving settings:', err);
      await showConfirm('Error', 'Failed to save settings.', 'OK', '');
    }
  }

  async resetAllSettingsToDefaults() {
    const isConfirmed = await showConfirm(
      'Reset All Settings',
      'Are you sure you want to reset all settings and hotkeys to defaults?',
      'Reset',
      'Cancel',
      true
    );
    if (!isConfirmed) {
      return;
    }

    await this.controller.resetSettings();
    await this.loadConfigs();
  }


  isRowChanged(index: number) {
    return (
      JSON.stringify(this.currentHotkeys[index]) !==
      JSON.stringify(this.originalHotkeys[index])
    );
  }

  /** Free-text model field; blank means "use the default". */
  private renderModelInput(id: string, label: string, value: string,
      defaultModel: string, suggestions: string[], onInput: (v: string) => void) {
    return html`
      <div>
        <label for=${id}>${label}:</label>
        <input
          id=${id}
          type="text"
          list="${id}-suggestions"
          style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px;"
          .value=${value}
          @input=${(e: Event) => {
            if (e.target instanceof HTMLInputElement) onInput(e.target.value);
          }}
          placeholder="${defaultModel} (default)"
        />
        <datalist id="${id}-suggestions">
          ${suggestions.map((m) => html`<option value=${m}></option>`)}
        </datalist>
      </div>
    `;
  }

  override render() {
    return html`
      <dialog aria-labelledby="settings-title">
        <button
          class="close-button"
          @click=${this.close}
          aria-label="Close modal">
          &times;
        </button>
        <div class="container">
          <div class="header">
            <h1 id="settings-title">Settings</h1>
          </div>

          ${this.isLoadingConfigs ? html`
            <div class="content-body" style="padding: 40px; text-align: center; color: #666;">
              Loading settings...
            </div>
          ` : html`
            <div class="content-body">
              <div class="section">
                <div class="section-header">
                  <h2>Vision-Language Model (VLM)</h2>
                </div>
              ${getInjectedGeminiApiKey() ? html`
              <p style="padding: 10px; margin: 0;">This app is using a preconfigured Google Gemini API key.</p>
              ` : html`
              <div class="api-key-container" style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
                <div>
                  <label for="provider-select">VLM Provider:</label>
                  <select id="provider-select" 
                    style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px;"
                    @change=${(e: Event) => {
                      if (e.target instanceof HTMLSelectElement) {
                        this.currentLlmProvider = e.target.value as 'gemini' | 'openai' | 'none';
                      }
                    }}>
                    <option value="gemini" ?selected=${this.currentLlmProvider === 'gemini'}>Google Gemini</option>
                    <option value="openai" ?selected=${this.currentLlmProvider === 'openai'}>OpenAI ChatGPT</option>
                    <option value="none" ?selected=${this.currentLlmProvider === 'none'}>None (Manual Editing Only)</option>
                  </select>
                </div>
                
                <div>
                  <label for="api-key-input">VLM API Key:</label>
                  <input
                    id="api-key-input"
                    type="password"
                    aria-describedby="vlm-key-help"
                    style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"
                    .value=${this.currentApiKey}
                    ?disabled=${this.currentLlmProvider === 'none'}
                    @input=${(e: Event) => {
                      if (e.target instanceof HTMLInputElement) {
                        this.currentApiKey = e.target.value;
                      }
                    }}
                    placeholder=${this.currentLlmProvider === 'none'
                      ? 'No API key required when VLM is None'
                      : 'Enter your Gemini or OpenAI API Key'}
                  />
                  <div id="vlm-key-help" class="help-text" style="margin-top: 4px;">
                    Get a Gemini key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a> or an OpenAI key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI Platform</a>. Stored locally in your browser.
                  </div>
                </div>

                ${this.currentLlmProvider === 'gemini'
                  ? this.renderModelInput('agent-model-input', 'Gemini model', this.currentAgentModel,
                      DEFAULT_AGENT_MODEL, AGENT_MODEL_SUGGESTIONS, (v) => { this.currentAgentModel = v; })
                  : ''}
              </div>
              `}
            </div>

            <div class="section">
              <div class="section-header">
                <h2>Text-to-Speech (TTS)</h2>
              </div>
              <div class="api-key-container" style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
                <div>
                  <label for="tts-provider-select">TTS Engine:</label>
                  <select
                    id="tts-provider-select"
                    style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; background-color: white;"
                    @change=${(e: Event) => {
                      if (e.target instanceof HTMLSelectElement) {
                        this.currentTtsProvider = e.target.value as 'gemini' | 'openai' | 'kokoro';
                      }
                    }}
                  >
                    <option value="gemini" ?selected=${this.currentTtsProvider === 'gemini'}>Google Gemini TTS</option>
                    <option value="openai" ?selected=${this.currentTtsProvider === 'openai'}>OpenAI TTS</option>
                    <option value="kokoro" ?selected=${this.currentTtsProvider === 'kokoro'}>Kokoro (Local Browser TTS)</option>
                  </select>
                </div>

                <div>
                  <label for="tts-api-key-input">TTS API Key:</label>
                  <input
                    id="tts-api-key-input"
                    type="password"
                    aria-describedby="tts-key-help"
                    style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"
                    .value=${this.currentTtsApiKey}
                    ?disabled=${this.currentTtsProvider === 'kokoro' || (this.currentTtsProvider === 'gemini' && Boolean(getInjectedGeminiApiKey()))}
                    @input=${(e: Event) => {
                      if (e.target instanceof HTMLInputElement) {
                        this.currentTtsApiKey = e.target.value;
                      }
                    }}
                    placeholder=${this.currentTtsProvider === 'kokoro'
                      ? 'No API key required for Kokoro (leave blank)'
                      : 'Enter TTS API Key (or leave blank to use VLM key)'}
                  />
                  <div id="tts-key-help" class="help-text" style="margin-top: 4px;">
                    Leave blank for Kokoro (runs locally in your browser) or to reuse your VLM API key.
                  </div>
                </div>

                ${this.currentTtsProvider === 'gemini' && !getInjectedGeminiApiKey()
                  ? this.renderModelInput('speech-model-input', 'Gemini speech model', this.currentSpeechModel,
                      DEFAULT_SPEECH_MODEL, SPEECH_MODEL_SUGGESTIONS, (v) => { this.currentSpeechModel = v; })
                  : ''}

                <div>
                  <label for="language-select">Voice Language:</label>
                  <select
                    id="language-select"
                    style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; background-color: white;"
                    @change=${(e: Event) => {
                      if (e.target instanceof HTMLSelectElement) {
                        this.currentLanguage = e.target.value;
                      }
                    }}
                  >
                    ${TTS_LANGUAGES.map((lang) => html`<option value="${lang.code}" ?selected=${this.currentLanguage === lang.code}>${lang.label}</option>`)}
                  </select>
                </div>
              </div>
            </div>

            <div class="section">
              <div class="section-header">
                <h2>Hotkeys</h2>
              </div>

              <div id="hotkey-list" class="hotkey-list-container">
                <div class="hotkey-header">
                  <div class="hotkey-description">Action</div>
                  <div>Default</div>
                  <div>Custom Combo</div>
                </div>
                <div id="hotkey-items" class="hotkey-items-container">
                  ${this.currentHotkeys.map((hotkey, index) => {
                    const defaultCombo = this.defaultCombos.get(hotkey.command);
                    const isChanged = this.isRowChanged(index);

                    return html`
                      <div
                        class="hotkey-item ${isChanged ? 'row-changed' : ''}">
                        <div
                          id="hotkey-desc-${index}"
                          class="hotkey-description"
                          >${hotkey.description}</div
                        >
                        <div class="hotkey-default-combo">${defaultCombo}</div>
                        <input
                          type="text"
                          class="hotkey-input-keycombo"
                          aria-labelledby="hotkey-desc-${index}"
                          .value=${hotkey.keyCombo}
                          @input=${(e: Event) => {
                            this.handleKeyComboInput(e, index);
                          }} />
                      </div>
                    `;
                  })}
                </div>
              </div>
            </div>
          `}

          <div class="footer">
            <button
              id="reset-all-button"
              class="reset-button"
              @click=${this.resetAllSettingsToDefaults}>
              Reset All Settings
            </button>
            <button
              id="save-button"
              class="save-button primary"
              @click=${() => {
                void this.saveConfigs();
              }}
              .disabled=${this.isLoadingConfigs || !this.hasChanges}>
              Save Changes
            </button>
          </div>
        </div>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'settings-modal': SettingsModal;
  }
}
