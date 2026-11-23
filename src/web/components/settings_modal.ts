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
  AGENT_MODEL_SUGGESTIONS,
  DEFAULT_AGENT_MODEL,
  DEFAULT_AUDIO_DUCKING_ENABLED,
  DEFAULT_DUCK_ATTACK_MS,
  DEFAULT_DUCK_HOLD_MS,
  DEFAULT_DUCK_RELEASE_MS,
  DEFAULT_DUCK_VOLUME_PERCENT,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TTS_MODEL,
  DEFAULT_SPEECH_MODEL,
  OPENAI_MODEL_SUGGESTIONS,
  OPENAI_TTS_MODEL_SUGGESTIONS,
  SPEECH_MODEL_SUGGESTIONS,
  TTS_LANGUAGES,
} from '../../core/constants';
import {showConfirm} from './confirm_modal';
import {appState} from '../../core/app_state';
import {styles} from './settings_modal_styles';
import {AppController} from '../controller/app_controller';
import {probeAvailableModels, ProbedModels} from '../../ai/model_prober';

interface ProviderProbeState {
  loading: boolean;
  probed: boolean;
  vlmModels: string[];
  ttsModels: string[];
  error: string;
}

function emptyProbeState(): ProviderProbeState {
  return {
    loading: false,
    probed: false,
    vlmModels: [],
    ttsModels: [],
    error: '',
  };
}

/**
 * Component for configuring user preferences (VLM provider/model/key source,
 * TTS engine/model/language, audio ducking, and keyboard shortcuts).
 */
@customElement('settings-modal')
export class SettingsModal extends LitElement {
  @query('dialog') dialog!: HTMLDialogElement;

  @state() currentHotkeys: HotkeyConfigEntry[] = [];
  @state() originalHotkeys: HotkeyConfigEntry[] = [];
  @state() currentLlmProvider: 'gemini' | 'openai' | 'none' = 'gemini';
  @state() originalLlmProvider: 'gemini' | 'openai' | 'none' = 'gemini';
  @state() currentUserGeminiApiKey: string = '';
  @state() originalUserGeminiApiKey: string = '';
  @state() currentUserOpenaiApiKey: string = '';
  @state() originalUserOpenaiApiKey: string = '';
  @state() currentUseCustomGeminiKey: boolean = false;
  @state() originalUseCustomGeminiKey: boolean = false;
  @state() currentUseCustomOpenaiKey: boolean = false;
  @state() originalUseCustomOpenaiKey: boolean = false;
  @state() currentTtsProvider: 'gemini' | 'openai' | 'kokoro' = 'gemini';
  @state() originalTtsProvider: 'gemini' | 'openai' | 'kokoro' = 'gemini';
  @state() currentLanguage: string = 'en-US';
  @state() originalLanguage: string = 'en-US';
  @state() currentAgentModel: string = '';
  @state() originalAgentModel: string = '';
  @state() currentOpenaiModel: string = '';
  @state() originalOpenaiModel: string = '';
  @state() currentSpeechModel: string = '';
  @state() originalSpeechModel: string = '';
  @state() currentOpenaiTtsModel: string = '';
  @state() originalOpenaiTtsModel: string = '';
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
  @state() private probeState: Record<'gemini' | 'openai', ProviderProbeState> =
    {
      gemini: emptyProbeState(),
      openai: emptyProbeState(),
    };

  private defaultCombos = new Map<string, string | undefined>();
  private readonly controller = AppController.getInstance();
  private unsubscribes: Array<() => void> = [];
  private probeCache = new Map<string, ProbedModels>();
  private probeControllers: Partial<Record<'gemini' | 'openai', AbortController>> =
    {};

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
          this.abortActiveProbes();
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
    this.abortActiveProbes();
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
  }

  private abortActiveProbes() {
    for (const key of ['gemini', 'openai'] as const) {
      this.probeControllers[key]?.abort();
      delete this.probeControllers[key];
    }
  }

  private getActiveKeyForProvider(provider: 'gemini' | 'openai'): string {
    const isOpenAI = provider === 'openai';
    const serverKey = (
      (isOpenAI
        ? appState.get('serverOpenaiApiKey')
        : appState.get('serverGeminiApiKey')) || ''
    ).trim();
    const useCustom = isOpenAI
      ? this.currentUseCustomOpenaiKey
      : this.currentUseCustomGeminiKey;
    const userKey = (
      isOpenAI ? this.currentUserOpenaiApiKey : this.currentUserGeminiApiKey
    ).trim();
    if (serverKey && !useCustom) {
      return serverKey;
    }
    return userKey;
  }

  private async probeModelsForProvider(
    provider: 'gemini' | 'openai',
    forceRefresh = false,
  ) {
    const apiKey = this.getActiveKeyForProvider(provider);
    if (!apiKey) {
      this.probeControllers[provider]?.abort();
      delete this.probeControllers[provider];
      this.probeState = {
        ...this.probeState,
        [provider]: emptyProbeState(),
      };
      return;
    }

    const cacheKey = `${provider}:${apiKey}`;
    if (!forceRefresh && this.probeCache.has(cacheKey)) {
      const cached = this.probeCache.get(cacheKey)!;
      this.probeState = {
        ...this.probeState,
        [provider]: {
          loading: false,
          probed: true,
          vlmModels: cached.vlmModels,
          ttsModels: cached.ttsModels,
          error: '',
        },
      };
      return;
    }

    this.probeControllers[provider]?.abort();
    const controller = new AbortController();
    this.probeControllers[provider] = controller;

    this.probeState = {
      ...this.probeState,
      [provider]: {
        ...this.probeState[provider],
        loading: true,
        error: '',
      },
    };

    try {
      const result = await probeAvailableModels(
        provider,
        apiKey,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      this.probeCache.set(cacheKey, result);
      this.probeState = {
        ...this.probeState,
        [provider]: {
          loading: false,
          probed: true,
          vlmModels: result.vlmModels,
          ttsModels: result.ttsModels,
          error: '',
        },
      };
    } catch (err) {
      if (controller.signal.aborted) return;
      const message =
        err instanceof Error ? err.message : 'Failed to list models.';
      this.probeState = {
        ...this.probeState,
        [provider]: {
          loading: false,
          probed: false,
          vlmModels: [],
          ttsModels: [],
          error: message,
        },
      };
    } finally {
      if (this.probeControllers[provider] === controller) {
        delete this.probeControllers[provider];
      }
    }
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

      this.currentLlmProvider = appState.get('llmProvider') || 'gemini';
      this.originalLlmProvider = this.currentLlmProvider;
      this.currentUserGeminiApiKey = appState.get('userGeminiApiKey') || '';
      this.originalUserGeminiApiKey = this.currentUserGeminiApiKey;
      this.currentUserOpenaiApiKey = appState.get('userOpenaiApiKey') || '';
      this.originalUserOpenaiApiKey = this.currentUserOpenaiApiKey;
      this.currentUseCustomGeminiKey = Boolean(
        appState.get('useCustomGeminiKey'),
      );
      this.originalUseCustomGeminiKey = this.currentUseCustomGeminiKey;
      this.currentUseCustomOpenaiKey = Boolean(
        appState.get('useCustomOpenaiKey'),
      );
      this.originalUseCustomOpenaiKey = this.currentUseCustomOpenaiKey;

      this.currentTtsProvider = appState.get('ttsProvider') || 'kokoro';
      this.originalTtsProvider = this.currentTtsProvider;
      this.currentLanguage = appState.get('ttsLanguage') || 'en-US';
      this.originalLanguage = this.currentLanguage;
      this.currentAgentModel = appState.get('agentModel') || '';
      this.originalAgentModel = this.currentAgentModel;
      this.currentOpenaiModel = appState.get('openaiModel') || '';
      this.originalOpenaiModel = this.currentOpenaiModel;
      this.currentSpeechModel = appState.get('speechModel') || '';
      this.originalSpeechModel = this.currentSpeechModel;
      this.currentOpenaiTtsModel = appState.get('openaiTtsModel') || '';
      this.originalOpenaiTtsModel = this.currentOpenaiTtsModel;

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

    if (
      this.currentLlmProvider === 'gemini' ||
      this.currentLlmProvider === 'openai'
    ) {
      void this.probeModelsForProvider(this.currentLlmProvider);
    }
    if (
      (this.currentTtsProvider === 'gemini' ||
        this.currentTtsProvider === 'openai') &&
      this.currentTtsProvider !== this.currentLlmProvider
    ) {
      void this.probeModelsForProvider(this.currentTtsProvider);
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
      this.currentLlmProvider !== this.originalLlmProvider ||
      this.currentUserGeminiApiKey !== this.originalUserGeminiApiKey ||
      this.currentUserOpenaiApiKey !== this.originalUserOpenaiApiKey ||
      this.currentUseCustomGeminiKey !== this.originalUseCustomGeminiKey ||
      this.currentUseCustomOpenaiKey !== this.originalUseCustomOpenaiKey ||
      this.currentTtsProvider !== this.originalTtsProvider ||
      this.currentLanguage !== this.originalLanguage ||
      this.currentAgentModel !== this.originalAgentModel ||
      this.currentOpenaiModel !== this.originalOpenaiModel ||
      this.currentSpeechModel !== this.originalSpeechModel ||
      this.currentOpenaiTtsModel !== this.originalOpenaiTtsModel ||
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
        llmProvider: this.currentLlmProvider,
        userGeminiApiKey: this.currentUserGeminiApiKey,
        userOpenaiApiKey: this.currentUserOpenaiApiKey,
        useCustomGeminiKey: this.currentUseCustomGeminiKey,
        useCustomOpenaiKey: this.currentUseCustomOpenaiKey,
        ttsProvider: this.currentTtsProvider,
        ttsLanguage: this.currentLanguage,
        agentModel: this.currentAgentModel,
        openaiModel: this.currentOpenaiModel,
        speechModel: this.currentSpeechModel,
        openaiTtsModel: this.currentOpenaiTtsModel,
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

  /**
   * Model selector with live-probed available models dropdown, Refresh button,
   * and synced free-text override input (blank uses the server/app default).
   */
  private renderModelInput(
    id: string,
    label: string,
    provider: 'gemini' | 'openai',
    kind: 'vlm' | 'tts',
    value: string,
    defaultModel: string,
    fallbackSuggestions: string[],
    helpTextId: string,
    onInput: (v: string) => void,
  ) {
    const pState = this.probeState[provider];
    const providerLabel =
      provider === 'openai' ? 'OpenAI ChatGPT' : 'Google Gemini';
    const hasKey = Boolean(this.getActiveKeyForProvider(provider));
    const probedList =
      kind === 'tts' ? pState.ttsModels : pState.vlmModels;
    const availableModels =
      pState.probed && probedList.length > 0 ? probedList : fallbackSuggestions;
    const trimmedValue = value.trim();
    const hasCustomValue =
      trimmedValue !== '' && !availableModels.includes(trimmedValue);
    const selectId = `${id}-select`;
    const statusId = `${id}-probe-status`;
    const kindLabel = kind === 'tts' ? 'speech' : 'VLM';

    return html`
      <div>
        <div class="model-field-header">
          <label for=${selectId}>${label}:</label>
          <button
            id="${id}-refresh"
            type="button"
            class="refresh-models-btn"
            ?disabled=${pState.loading || !hasKey}
            aria-busy=${pState.loading ? 'true' : 'false'}
            aria-label="Refresh available ${label}s"
            @click=${() => {
              void this.probeModelsForProvider(provider, true);
            }}>
            ${pState.loading ? 'Checking...' : 'Refresh models'}
          </button>
        </div>
        <select
          id=${selectId}
          aria-describedby="${statusId} ${helpTextId}"
          style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; background-color: white;"
          @change=${(e: Event) => {
            if (e.target instanceof HTMLSelectElement) {
              onInput(e.target.value);
            }
          }}>
          <option value="" ?selected=${trimmedValue === ''}>
            Default (${defaultModel})
          </option>
          ${availableModels.map(
            (m) =>
              html`<option value=${m} ?selected=${trimmedValue === m}>
                ${m === defaultModel ? `${m} (default)` : m}
              </option>`,
          )}
          ${hasCustomValue
            ? html`<option value=${trimmedValue} selected>
                Custom: ${trimmedValue}
              </option>`
            : ''}
        </select>

        <label for=${id} class="sub-label">
          Or enter custom ${label.toLowerCase()} ID:
        </label>
        <input
          id=${id}
          type="text"
          list="${id}-suggestions"
          aria-describedby="${statusId} ${helpTextId}"
          style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"
          .value=${value}
          @input=${(e: Event) => {
            if (e.target instanceof HTMLInputElement) onInput(e.target.value);
          }}
          placeholder="${defaultModel} (default)"
        />
        <datalist id="${id}-suggestions">
          ${availableModels.map((m) => html`<option value=${m}></option>`)}
        </datalist>

        <div
          id=${statusId}
          class="probe-status"
          role="status"
          aria-live="polite">
          ${pState.loading
            ? `Probing available ${providerLabel} models...`
            : pState.error
              ? html`<span class="probe-error"
                  >Could not load ${providerLabel} models: ${pState.error}
                  (showing built-in suggestions).</span
                >`
              : pState.probed
                ? probedList.length > 0
                  ? `Found ${probedList.length} available ${kindLabel} model${probedList.length === 1 ? '' : 's'} from ${providerLabel}.`
                  : `No ${kindLabel} models returned by ${providerLabel} (showing built-in suggestions).`
                : !hasKey
                  ? `Enter a ${providerLabel} API key to probe available models (showing built-in suggestions).`
                  : ''}
        </div>
      </div>
    `;
  }

  /**
   * Renders screen-reader-accessible API key status, server-vs-custom key
   * toggle (when a server key is available), and custom key input for the
   * given provider.
   */
  private renderProviderKeyControls(
    provider: 'gemini' | 'openai',
    sectionPrefix: 'vlm' | 'tts',
  ) {
    const isOpenAI = provider === 'openai';
    const providerLabel = isOpenAI ? 'OpenAI ChatGPT' : 'Google Gemini';
    const serverKey = isOpenAI
      ? appState.get('serverOpenaiApiKey')
      : appState.get('serverGeminiApiKey');
    const hasServerKey = Boolean(serverKey && serverKey.trim());
    const useCustomKey = isOpenAI
      ? this.currentUseCustomOpenaiKey
      : this.currentUseCustomGeminiKey;
    const userKey = isOpenAI
      ? this.currentUserOpenaiApiKey
      : this.currentUserGeminiApiKey;
    const setUseCustomKey = (val: boolean) => {
      if (isOpenAI) {
        this.currentUseCustomOpenaiKey = val;
      } else {
        this.currentUseCustomGeminiKey = val;
      }
      void this.probeModelsForProvider(provider);
    };
    const setUserKey = (val: string) => {
      if (isOpenAI) {
        this.currentUserOpenaiApiKey = val;
      } else {
        this.currentUserGeminiApiKey = val;
      }
    };

    const statusId = `${sectionPrefix}-key-status`;
    const helpId = `${sectionPrefix}-key-help`;
    const warningId = `${sectionPrefix}-key-warning`;
    const inputId = `${sectionPrefix}-api-key-input`;
    const radioName = `${sectionPrefix}-key-source`;
    const showKeyInput = !hasServerKey || useCustomKey;
    const isMissingCustomKey = showKeyInput && userKey.trim() === '';
    const featureNote =
      sectionPrefix === 'vlm'
        ? 'AI chat and Generate AD require an API key and will display an error until a key is set.'
        : 'Cloud TTS requires an API key and will fall back to local Kokoro speech if no key is set.';

    return html`
      <div aria-live="polite" aria-atomic="true">
        ${hasServerKey
          ? html`
              <div id=${statusId} class="notice-banner notice-info" role="status">
                A server-provided ${providerLabel} API key is available. You can
                use the server-provided key or switch to your own personal API
                key below.
              </div>
            `
          : isMissingCustomKey
            ? html`
                <div
                  id=${statusId}
                  class="notice-banner notice-warning"
                  role="alert">
                  No ${providerLabel} API key is configured on the server or in
                  your browser. ${featureNote} Enter your own key below, or
                  configure
                  <code>${isOpenAI ? 'openai_api_key' : 'gemini_api_key'}</code>
                  on the server in <code>models.conf</code>.
                </div>
              `
            : html`
                <div id=${statusId} class="notice-banner notice-info" role="status">
                  No ${providerLabel} API key is configured on the server. Using
                  your browser-stored API key below.
                </div>
              `}
      </div>

      ${hasServerKey
        ? html`
            <fieldset class="key-source-fieldset" aria-describedby=${statusId}>
              <legend>${providerLabel} API Key Source</legend>
              <div class="key-source-options">
                <label
                  class="radio-option"
                  for="${sectionPrefix}-key-source-server">
                  <input
                    id="${sectionPrefix}-key-source-server"
                    type="radio"
                    name=${radioName}
                    value="server"
                    .checked=${!useCustomKey}
                    @change=${() => setUseCustomKey(false)} />
                  <span>Use server-provided key</span>
                </label>
                <label
                  class="radio-option"
                  for="${sectionPrefix}-key-source-custom">
                  <input
                    id="${sectionPrefix}-key-source-custom"
                    type="radio"
                    name=${radioName}
                    value="custom"
                    .checked=${useCustomKey}
                    @change=${() => setUseCustomKey(true)} />
                  <span>Use your own key</span>
                </label>
              </div>
            </fieldset>
          `
        : ''}

      ${showKeyInput
        ? html`
            <div>
              <label for=${inputId}>Your ${providerLabel} API Key:</label>
              <input
                id=${inputId}
                type="password"
                autocomplete="off"
                aria-invalid=${isMissingCustomKey ? 'true' : 'false'}
                aria-describedby=${hasServerKey && isMissingCustomKey
                  ? `${warningId} ${helpId}`
                  : `${statusId} ${helpId}`}
                style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"
                .value=${userKey}
                @input=${(e: Event) => {
                  if (e.target instanceof HTMLInputElement) {
                    setUserKey(e.target.value);
                  }
                }}
                @blur=${() => {
                  void this.probeModelsForProvider(provider);
                }}
                placeholder="Enter your ${providerLabel} API key" />
              ${hasServerKey && isMissingCustomKey
                ? html`
                    <div
                      id=${warningId}
                      class="notice-banner notice-warning"
                      role="alert"
                      style="margin-top: 6px;">
                      No custom ${providerLabel} API key entered. ${featureNote}
                      Enter a key above or switch back to the server-provided
                      key.
                    </div>
                  `
                : ''}
              <div id=${helpId} class="help-text" style="margin-top: 4px;">
                ${isOpenAI
                  ? html`Get an OpenAI key from
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        >OpenAI Platform</a
                      >. Stored locally in your browser.`
                  : html`Get a Gemini key from
                      <a
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        >Google AI Studio</a
                      >. Stored locally in your browser.`}
              </div>
            </div>
          `
        : ''}
    `;
  }

  override render() {
    const defaultAgentModel =
      appState.get('defaultAgentModel') || DEFAULT_AGENT_MODEL;
    const defaultOpenaiModel =
      appState.get('defaultOpenaiModel') || DEFAULT_OPENAI_MODEL;
    const defaultSpeechModel =
      appState.get('defaultSpeechModel') || DEFAULT_SPEECH_MODEL;
    const defaultOpenaiTtsModel =
      appState.get('defaultOpenaiTtsModel') || DEFAULT_OPENAI_TTS_MODEL;

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
                      <h2>Vision-Language Model (VLM)</h2>
                    </div>
                    <div
                      class="api-key-container"
                      style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
                      <div>
                        <label for="provider-select">VLM Provider:</label>
                        <select
                          id="provider-select"
                          style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; background-color: white;"
                          @change=${(e: Event) => {
                            if (e.target instanceof HTMLSelectElement) {
                              const next = e.target.value as
                                | 'gemini'
                                | 'openai'
                                | 'none';
                              this.currentLlmProvider = next;
                              if (next === 'gemini' || next === 'openai') {
                                void this.probeModelsForProvider(next);
                              }
                            }
                          }}>
                          <option
                            value="gemini"
                            ?selected=${this.currentLlmProvider === 'gemini'}>
                            Google Gemini
                          </option>
                          <option
                            value="openai"
                            ?selected=${this.currentLlmProvider === 'openai'}>
                            OpenAI ChatGPT
                          </option>
                          <option
                            value="none"
                            ?selected=${this.currentLlmProvider === 'none'}>
                            None (Manual Editing Only)
                          </option>
                        </select>
                      </div>

                      ${this.currentLlmProvider === 'gemini' ||
                      this.currentLlmProvider === 'openai'
                        ? this.renderProviderKeyControls(
                            this.currentLlmProvider,
                            'vlm',
                          )
                        : html`
                            <div
                              id="vlm-key-status"
                              class="notice-banner notice-info"
                              role="status">
                              Vision-Language Model (VLM) is set to None (Manual
                              Editing Only). AI chat and Generate AD will return
                              an error until you choose Google Gemini or OpenAI
                              ChatGPT and configure an API key.
                            </div>
                          `}

                      ${this.currentLlmProvider === 'gemini'
                        ? this.renderModelInput(
                            'agent-model-input',
                            'Gemini model',
                            'gemini',
                            'vlm',
                            this.currentAgentModel,
                            defaultAgentModel,
                            AGENT_MODEL_SUGGESTIONS,
                            'vlm-model-help',
                            (v) => {
                              this.currentAgentModel = v;
                            },
                          )
                        : this.currentLlmProvider === 'openai'
                          ? this.renderModelInput(
                              'openai-model-input',
                              'OpenAI model',
                              'openai',
                              'vlm',
                              this.currentOpenaiModel,
                              defaultOpenaiModel,
                              OPENAI_MODEL_SUGGESTIONS,
                              'vlm-model-help',
                              (v) => {
                                this.currentOpenaiModel = v;
                              },
                            )
                          : ''}
                      ${this.currentLlmProvider !== 'none'
                        ? html`
                            <div
                              id="vlm-model-help"
                              class="help-text"
                              style="margin-top: 4px;">
                              Leave blank to use the default model
                              (<code>${this.currentLlmProvider === 'openai'
                                ? defaultOpenaiModel
                                : defaultAgentModel}</code>).
                            </div>
                          `
                        : ''}
                    </div>
                  </div>

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
                              const next = e.target.value as
                                | 'gemini'
                                | 'openai'
                                | 'kokoro';
                              this.currentTtsProvider = next;
                              if (next === 'gemini' || next === 'openai') {
                                void this.probeModelsForProvider(next);
                              }
                            }
                          }}>
                          <option
                            value="gemini"
                            ?selected=${this.currentTtsProvider === 'gemini'}>
                            Google Gemini TTS
                          </option>
                          <option
                            value="openai"
                            ?selected=${this.currentTtsProvider === 'openai'}>
                            OpenAI ChatGPT TTS
                          </option>
                          <option
                            value="kokoro"
                            ?selected=${this.currentTtsProvider === 'kokoro'}>
                            Kokoro (Local Browser TTS)
                          </option>
                        </select>
                      </div>

                      ${this.currentTtsProvider === 'gemini' ||
                      this.currentTtsProvider === 'openai'
                        ? this.currentTtsProvider === this.currentLlmProvider
                          ? html`
                              <div class="help-text">
                                Uses the
                                ${this.currentTtsProvider === 'openai'
                                  ? 'OpenAI ChatGPT'
                                  : 'Google Gemini'}
                                API key configured in Vision-Language Model
                                (VLM) above.
                              </div>
                            `
                          : this.renderProviderKeyControls(
                              this.currentTtsProvider,
                              'tts',
                            )
                        : ''}

                      ${this.currentTtsProvider === 'gemini'
                        ? this.renderModelInput(
                            'speech-model-input',
                            'Gemini speech model',
                            'gemini',
                            'tts',
                            this.currentSpeechModel,
                            defaultSpeechModel,
                            SPEECH_MODEL_SUGGESTIONS,
                            'tts-model-help',
                            (v) => {
                              this.currentSpeechModel = v;
                            },
                          )
                        : this.currentTtsProvider === 'openai'
                          ? this.renderModelInput(
                              'openai-tts-model-input',
                              'OpenAI speech model',
                              'openai',
                              'tts',
                              this.currentOpenaiTtsModel,
                              defaultOpenaiTtsModel,
                              OPENAI_TTS_MODEL_SUGGESTIONS,
                              'tts-model-help',
                              (v) => {
                                this.currentOpenaiTtsModel = v;
                              },
                            )
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

                      <div id="tts-model-help" class="help-text" style="margin-top: 4px;">
                        Leave speech model blank to use the default from
                        <code>models.conf</code>. If a cloud TTS key is missing
                        or unavailable, narration automatically falls back to
                        local Kokoro speech.
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
