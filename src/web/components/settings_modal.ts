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
import {retrieveHotkeyConfigsFromDB} from '../storage/db';
import {
  DEFAULT_AUDIO_DUCKING_ENABLED,
  DEFAULT_DUCK_ATTACK_MS,
  DEFAULT_DUCK_HOLD_MS,
  DEFAULT_DUCK_RELEASE_MS,
  DEFAULT_DUCK_VOLUME_PERCENT,
  TTS_LANGUAGES,
} from '../../core/constants';
import {showConfirm} from './confirm_modal';
import {appState} from '../../core/app_state';
import {styles} from './settings_modal_styles';
import {AppController} from '../controller/app_controller';

/**
 * Component for configuring user preferences (TTS mode, voice language,
 * audio ducking, and keyboard shortcuts). AI providers, model versions, and
 * API keys are configured on the server in `models.conf`.
 */
@customElement('settings-modal')
export class SettingsModal extends LitElement {
  @query('dialog') dialog!: HTMLDialogElement;

  @state() currentHotkeys: HotkeyConfigEntry[] = [];
  @state() originalHotkeys: HotkeyConfigEntry[] = [];
  @state() currentTtsProvider: 'gemini' | 'openai' | 'kokoro' = 'gemini';
  @state() originalTtsProvider: 'gemini' | 'openai' | 'kokoro' = 'gemini';
  @state() currentLanguage: string = 'en-US';
  @state() originalLanguage: string = 'en-US';
  @state() currentAudioDuckingEnabled: boolean = DEFAULT_AUDIO_DUCKING_ENABLED;
  @state() originalAudioDuckingEnabled: boolean = DEFAULT_AUDIO_DUCKING_ENABLED;
  @state() currentDuckVolumePercent: number = DEFAULT_DUCK_VOLUME_PERCENT;
  @state() originalDuckVolumePercent: number = DEFAULT_DUCK_VOLUME_PERCENT;
  @state() currentDuckAttackMs: number = DEFAULT_DUCK_ATTACK_MS;
  @state() originalDuckAttackMs: number = DEFAULT_DUCK_ATTACK_MS;
  @state() currentDuckReleaseMs: number = DEFAULT_DUCK_RELEASE_MS;
  @state() originalDuckReleaseMs: number = DEFAULT_DUCK_RELEASE_MS;
  @state() currentDuckHoldMs: number = DEFAULT_DUCK_HOLD_MS;
  @state() originalDuckHoldMs: number = DEFAULT_DUCK_HOLD_MS;
  @state() private isLoadingConfigs = true;

  private defaultCombos = new Map<string, string | undefined>();
  private readonly controller = AppController.getInstance();
  private unsubscribes: Array<() => void> = [];

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
        overflow: hidden;
        background: transparent;
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
        color: #5f6368;
        z-index: 10;
      }

      .close-button:hover {
        color: #202124;
      }
    `,
    styles,
  ];

  private previouslyFocusedElement: HTMLElement | null = null;

  private getDeepActiveElement(): HTMLElement | null {
    let current: Element | null = document.activeElement;
    while (current?.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement;
    }
    return current instanceof HTMLElement ? current : null;
  }

  override async connectedCallback() {
    super.connectedCallback();

    this.unsubscribes.push(
      appState.subscribe('isSettingsModalOpen', (open) => {
        if (!this.dialog) return;
        if (open) {
          if (!this.dialog.open) {
            this.previouslyFocusedElement = this.getDeepActiveElement();
            this.dialog.showModal();
            void this.loadConfigs();
          }
        } else {
          if (this.dialog.open) {
            this.dialog.close();
          }
          this.previouslyFocusedElement?.focus();
          this.previouslyFocusedElement = null;
        }
      }),
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
  }

  open() {
    this.controller.openSettings();
  }

  close() {
    this.controller.closeSettings();
  }

  private handleDialogCancel(e: Event) {
    e.preventDefault();
    this.close();
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

      this.currentTtsProvider = appState.get('ttsProvider') || 'kokoro';
      this.originalTtsProvider = this.currentTtsProvider;
      this.currentLanguage = appState.get('ttsLanguage') || 'en-US';
      this.originalLanguage = this.currentLanguage;

      this.currentAudioDuckingEnabled =
        appState.get('audioDuckingEnabled') ?? DEFAULT_AUDIO_DUCKING_ENABLED;
      this.originalAudioDuckingEnabled = this.currentAudioDuckingEnabled;

      this.currentDuckVolumePercent =
        appState.get('duckVolumePercent') ?? DEFAULT_DUCK_VOLUME_PERCENT;
      this.originalDuckVolumePercent = this.currentDuckVolumePercent;

      this.currentDuckAttackMs =
        appState.get('duckAttackMs') ?? DEFAULT_DUCK_ATTACK_MS;
      this.originalDuckAttackMs = this.currentDuckAttackMs;

      this.currentDuckReleaseMs =
        appState.get('duckReleaseMs') ?? DEFAULT_DUCK_RELEASE_MS;
      this.originalDuckReleaseMs = this.currentDuckReleaseMs;

      this.currentDuckHoldMs =
        appState.get('duckHoldMs') ?? DEFAULT_DUCK_HOLD_MS;
      this.originalDuckHoldMs = this.currentDuckHoldMs;
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
      this.currentTtsProvider !== this.originalTtsProvider ||
      this.currentLanguage !== this.originalLanguage ||
      this.currentAudioDuckingEnabled !== this.originalAudioDuckingEnabled ||
      this.currentDuckVolumePercent !== this.originalDuckVolumePercent ||
      this.currentDuckAttackMs !== this.originalDuckAttackMs ||
      this.currentDuckReleaseMs !== this.originalDuckReleaseMs ||
      this.currentDuckHoldMs !== this.originalDuckHoldMs
    );
  }

  async saveConfigs() {
    try {
      const changedHotkeys = this.currentHotkeys.filter(
        (config, index) =>
          JSON.stringify(config) !==
          JSON.stringify(this.originalHotkeys[index]),
      );

      await this.controller.saveSettings({
        ttsProvider: this.currentTtsProvider,
        ttsLanguage: this.currentLanguage,
        audioDuckingEnabled: this.currentAudioDuckingEnabled,
        duckVolumePercent: this.currentDuckVolumePercent,
        duckAttackMs: this.currentDuckAttackMs,
        duckReleaseMs: this.currentDuckReleaseMs,
        duckHoldMs: this.currentDuckHoldMs,
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
      true,
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

  override render() {
    const cloudTtsProvider = appState.get('cloudTtsProvider') || 'gemini';
    const cloudTtsLabel =
      cloudTtsProvider === 'openai'
        ? 'Cloud TTS (OpenAI)'
        : 'Cloud TTS (Google Gemini)';

    return html`
      <dialog aria-labelledby="settings-title" @cancel=${this.handleDialogCancel}>
        <button
          type="button"
          class="close-button"
          @click=${this.close}
          aria-label="Close modal">
          <span aria-hidden="true">&times;</span>
        </button>
        <div class="container">
          <div class="header">
            <h1 id="settings-title">Settings</h1>
          </div>

          ${this.isLoadingConfigs
            ? html`
                <div
                  class="content-body"
                  role="status"
                  aria-live="polite"
                  style="padding: 40px; text-align: center; color: #5f6368;">
                  Loading settings...
                </div>
              `
            : html`
                <div class="content-body">
                  <div class="section">
                    <div class="section-header">
                      <h2>Text-to-Speech (TTS)</h2>
                    </div>
                    <div
                      class="api-key-container"
                      style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
                      <div>
                        <label for="tts-provider-select">TTS Engine:</label>
                        <select
                          id="tts-provider-select"
                          style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; background-color: white;"
                          @change=${(e: Event) => {
                            if (e.target instanceof HTMLSelectElement) {
                              this.currentTtsProvider = e.target.value as
                                | 'gemini'
                                | 'openai'
                                | 'kokoro';
                            }
                          }}>
                          <option
                            value=${cloudTtsProvider}
                            ?selected=${this.currentTtsProvider !== 'kokoro'}>
                            ${cloudTtsLabel}
                          </option>
                          <option
                            value="kokoro"
                            ?selected=${this.currentTtsProvider === 'kokoro'}>
                            Kokoro (Local Browser TTS)
                          </option>
                        </select>
                      </div>

                      <div>
                        <label for="language-select">Voice Language:</label>
                        <select
                          id="language-select"
                          style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; background-color: white;"
                          @change=${(e: Event) => {
                            if (e.target instanceof HTMLSelectElement) {
                              this.currentLanguage = e.target.value;
                            }
                          }}>
                          ${TTS_LANGUAGES.map(
                            (lang) =>
                              html`<option
                                value="${lang.code}"
                                ?selected=${this.currentLanguage === lang.code}>
                                ${lang.label}
                              </option>`,
                          )}
                        </select>
                      </div>

                      <div class="help-text" style="margin-top: 4px;">
                        AI providers, model versions, and API keys are configured on the server in <code>models.conf</code>.
                      </div>
                    </div>
                  </div>

                  <div class="section">
                    <div class="section-header">
                      <h2>Audio Ducking</h2>
                    </div>
                    <div
                      class="ducking-container"
                      style="padding: 10px; display: flex; flex-direction: column; gap: 12px;">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <input
                          id="audio-ducking-enabled"
                          type="checkbox"
                          .checked=${this.currentAudioDuckingEnabled}
                          aria-describedby="ducking-help-text"
                          @change=${(e: Event) => {
                            if (e.target instanceof HTMLInputElement) {
                              this.currentAudioDuckingEnabled = e.target.checked;
                            }
                          }} />
                        <label
                          for="audio-ducking-enabled"
                          style="font-weight: 500; cursor: pointer;">
                          Enable Audio Ducking
                        </label>
                      </div>
                      <div id="ducking-help-text" class="help-text">
                        Automatically lowers the original video volume while Audio Description narration is playing and when exporting mixed video.
                      </div>

                      <div
                        class="ducking-params-grid"
                        style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                          <label for="duck-volume-percent">
                            Ducked Video Volume (%):
                          </label>
                          <input
                            id="duck-volume-percent"
                            type="number"
                            min="0"
                            max="100"
                            step="5"
                            style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"
                            .value=${String(this.currentDuckVolumePercent)}
                            .disabled=${!this.currentAudioDuckingEnabled}
                            aria-describedby="duck-volume-help"
                            @input=${(e: Event) => {
                              if (e.target instanceof HTMLInputElement) {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v)) {
                                  this.currentDuckVolumePercent = Math.max(0, Math.min(100, v));
                                }
                              }
                            }} />
                          <div id="duck-volume-help" class="help-text" style="margin-top: 4px;">
                            Target background volume during speech (default: 35%).
                          </div>
                        </div>

                        <div>
                          <label for="duck-attack-ms">
                            Fade-Down / Attack (ms):
                          </label>
                          <input
                            id="duck-attack-ms"
                            type="number"
                            min="0"
                            max="2000"
                            step="10"
                            style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"
                            .value=${String(this.currentDuckAttackMs)}
                            .disabled=${!this.currentAudioDuckingEnabled}
                            aria-describedby="duck-attack-help"
                            @input=${(e: Event) => {
                              if (e.target instanceof HTMLInputElement) {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v)) {
                                  this.currentDuckAttackMs = Math.max(0, Math.min(2000, v));
                                }
                              }
                            }} />
                          <div id="duck-attack-help" class="help-text" style="margin-top: 4px;">
                            Ramp-down time before each cue (default: 50ms).
                          </div>
                        </div>

                        <div>
                          <label for="duck-release-ms">
                            Fade-Up / Release (ms):
                          </label>
                          <input
                            id="duck-release-ms"
                            type="number"
                            min="0"
                            max="2000"
                            step="10"
                            style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"
                            .value=${String(this.currentDuckReleaseMs)}
                            .disabled=${!this.currentAudioDuckingEnabled}
                            aria-describedby="duck-release-help"
                            @input=${(e: Event) => {
                              if (e.target instanceof HTMLInputElement) {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v)) {
                                  this.currentDuckReleaseMs = Math.max(0, Math.min(2000, v));
                                }
                              }
                            }} />
                          <div id="duck-release-help" class="help-text" style="margin-top: 4px;">
                            Ramp-up time after each cue ends (default: 150ms).
                          </div>
                        </div>

                        <div>
                          <label for="duck-hold-ms">
                            Hold / Tail Time (ms):
                          </label>
                          <input
                            id="duck-hold-ms"
                            type="number"
                            min="0"
                            max="2000"
                            step="10"
                            style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"
                            .value=${String(this.currentDuckHoldMs)}
                            .disabled=${!this.currentAudioDuckingEnabled}
                            aria-describedby="duck-hold-help"
                            @input=${(e: Event) => {
                              if (e.target instanceof HTMLInputElement) {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v)) {
                                  this.currentDuckHoldMs = Math.max(0, Math.min(2000, v));
                                }
                              }
                            }} />
                          <div id="duck-hold-help" class="help-text" style="margin-top: 4px;">
                            Hold duration after a cue finishes (default: 150ms).
                          </div>
                        </div>
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
                          const defaultCombo = this.defaultCombos.get(
                            hotkey.command,
                          );
                          const isChanged = this.isRowChanged(index);

                          return html`
                            <div
                              class="hotkey-item ${isChanged
                                ? 'row-changed'
                                : ''}">
                              <div
                                id="hotkey-desc-${index}"
                                class="hotkey-description">
                                ${hotkey.description}
                              </div>
                              <div
                                id="hotkey-default-${index}"
                                class="hotkey-default-combo">
                                ${defaultCombo}
                              </div>
                              <input
                                type="text"
                                class="hotkey-input-keycombo"
                                aria-labelledby="hotkey-desc-${index}"
                                aria-describedby="hotkey-default-${index}"
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
