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
import {TTS_LANGUAGES} from '../../core/constants';
import {showConfirm} from './confirm_modal';
import {appState} from '../../core/app_state';
import {styles} from './settings_modal_styles';
import {AppController} from '../controller/app_controller';

/**
 * Component for configuring user preferences (TTS mode, voice language, and
 * keyboard shortcuts). AI providers, model versions, and API keys are
 * configured on the server in `models.conf`.
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

      this.currentTtsProvider = appState.get('ttsProvider') || 'gemini';
      this.originalTtsProvider = this.currentTtsProvider;
      this.currentLanguage = appState.get('ttsLanguage') || 'en-US';
      this.originalLanguage = this.currentLanguage;
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
      this.currentLanguage !== this.originalLanguage
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
