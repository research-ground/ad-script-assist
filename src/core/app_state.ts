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

/**
 * @fileoverview Centralized application state management.
 * Uses a simple observer pattern to allow components to react to state changes.
 */

import {AdSegment, VideoPlayerApi, ConversationEntry} from './types';
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_KOKORO_VOICE,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TTS_MODEL,
  DEFAULT_SPEECH_MODEL,
  getDefaultVoiceForTtsProvider,
  getInjectedGeminiApiKey,
  getStaticFallbackGeminiKey,
  getVoicesForTtsProvider,
} from './constants';

/** Supported application states. */
export interface AppState {
  currentVideoId: string;
  currentTime: number;
  isVideoPaused: boolean;
  adSegments: AdSegment[];
  isAdAudioGenerating: boolean;
  videoPlayerApi?: VideoPlayerApi;
  isAgentResponding: boolean;
  localVideoFile?: File;
  statusMessage: string;
  videoDuration: number;
  compiledAdTrackUrl: string | null;
  conversationLog: ConversationEntry[];

  // Modal visibility states
  isSettingsModalOpen: boolean;
  isHelpModalOpen: boolean;
  isAddVideoModalOpen: boolean;

  // Computed Action States
  isPlayEnabled: boolean;
  isGenerateEnabled: boolean;
  isExportEnabled: boolean;
  isClearEnabled: boolean;
  isAgentInputEnabled: boolean;

  // Editor State
  editorScriptText: string;
  editorCursorLine: number;

  // Server-configured Provider, Model & Key State (from models.conf via GET /api/config)
  hasServerProxy: boolean;
  geminiApiKey: string;
  openaiApiKey: string;
  llmProvider: 'gemini' | 'openai' | 'none';
  cloudTtsProvider: 'gemini' | 'openai';
  ttsProvider: 'gemini' | 'openai' | 'kokoro';
  ttsApiKey: string;
  ttsLanguage: string;
  agentModel: string; // '' = DEFAULT_AGENT_MODEL
  openaiModel: string; // '' = DEFAULT_OPENAI_MODEL
  speechModel: string; // '' = DEFAULT_SPEECH_MODEL
  openaiTtsModel: string; // '' = DEFAULT_OPENAI_TTS_MODEL

  // Project Settings (Saved per-video)
  ttsVoice: string;
  speakAdText: boolean;
  videoType: 'local' | 'youtube';
  videoSource: string;
  scriptNotes: string;

  [key: string]: any;
}

type StateListener<T> = (value: T) => void;

const USER_SETTINGS_KEYS = ['ttsProvider', 'ttsLanguage'] as const;
const PROJECT_SETTINGS_KEYS = [
  'currentVideoId',
  'ttsVoice',
  'speakAdText',
  'videoType',
  'videoSource',
  'scriptNotes',
] as const;

function parseIniText(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let currentSection = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim().toLowerCase();
      if (!sections[currentSection]) sections[currentSection] = {};
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toLowerCase();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    } else {
      const hashIdx = val.indexOf(' #');
      if (hashIdx !== -1) {
        val = val.slice(0, hashIdx).trim();
      }
    }
    if (!sections[currentSection]) sections[currentSection] = {};
    sections[currentSection][key] = val;
  }
  return sections;
}

/**
 * Manages shared application state and automatically syncs subset of keys to localStorage.
 */
class AppStateManager {
  private readonly state: AppState = {
    currentVideoId: '',
    currentTime: 0,
    videoDuration: 0,
    isVideoPaused: true,
    adSegments: [],
    compiledAdTrackUrl: null,
    isAdAudioGenerating: false,
    isAgentResponding: false,
    statusMessage: '',
    conversationLog: [],

    isSettingsModalOpen: false,
    isHelpModalOpen: false,
    isAddVideoModalOpen: false,

    isPlayEnabled: false,
    isGenerateEnabled: false,
    isExportEnabled: false,
    isClearEnabled: false,
    isAgentInputEnabled: false,

    editorScriptText: '',
    editorCursorLine: 1,

    hasServerProxy: false,
    geminiApiKey: '',
    openaiApiKey: '',
    llmProvider: 'gemini',
    cloudTtsProvider: 'gemini',
    ttsProvider: 'kokoro',
    ttsApiKey: '',
    ttsLanguage: 'en-US',
    agentModel: DEFAULT_AGENT_MODEL,
    openaiModel: DEFAULT_OPENAI_MODEL,
    speechModel: DEFAULT_SPEECH_MODEL,
    openaiTtsModel: DEFAULT_OPENAI_TTS_MODEL,

    ttsVoice: DEFAULT_KOKORO_VOICE,
    speakAdText: true,
    videoType: 'youtube',
    videoSource: '',
    scriptNotes: '',
  };

  private readonly listeners: {
    [K in keyof AppState]?: Array<StateListener<AppState[K]>>;
  } = {};

  constructor() {
    // Load User Settings from localStorage immediately (only non-secret UI preferences)
    if (
      typeof localStorage !== 'undefined' &&
      typeof localStorage.getItem === 'function'
    ) {
      const injectedKey = getInjectedGeminiApiKey();
      if (injectedKey) {
        this.state.geminiApiKey = injectedKey;
        this.state.llmProvider = 'gemini';
      }
      const savedTtsProvider = localStorage.getItem(
        'userSettings_ttsProvider',
      ) as 'gemini' | 'openai' | 'kokoro' | null;
      if (
        savedTtsProvider === 'kokoro' ||
        savedTtsProvider === 'gemini' ||
        savedTtsProvider === 'openai'
      ) {
        this.state.ttsProvider = savedTtsProvider;
      }
      this.state.ttsLanguage =
        localStorage.getItem('userSettings_ttsLanguage') || 'en-US';

      // Load active project settings immediately
      const raw = localStorage.getItem('projectSettings_active');
      if (raw) {
        try {
          const projectSettings = JSON.parse(raw);
          for (const pKey of PROJECT_SETTINGS_KEYS) {
            if (projectSettings[pKey] !== undefined) {
              (this.state as any)[pKey] = projectSettings[pKey];
            }
          }
        } catch {
          // Ignore malformed JSON in localStorage
        }
      }
    }

    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      void this.loadServerConfig();
    }
  }

  private serverConfigPromise: Promise<void> | null = null;

  /**
   * Loads server-side provider, model, and key-placeholder configuration from
   * `GET /api/config` (`models.conf`).
   */
  loadServerConfig(): Promise<void> {
    if (!this.serverConfigPromise) {
      this.serverConfigPromise = this.fetchServerConfig().finally(() => {
        this.serverConfigPromise = null;
      });
    }
    return this.serverConfigPromise;
  }

  private async fetchServerConfig(): Promise<void> {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (res.ok) {
        const text = await res.text();
        if (
          text.includes('[providers]') ||
          text.includes('[models]') ||
          text.includes('[keys]')
        ) {
          this.set('hasServerProxy', true);
          this.applyServerConfText(text);
          return;
        }
      }
    } catch {
      // Fallback to static build key if running without the server shim
    }

    this.set('hasServerProxy', false);
    const fallbackKey = getStaticFallbackGeminiKey();
    if (fallbackKey && !this.state.geminiApiKey) {
      this.set('geminiApiKey', fallbackKey);
      this.set('ttsApiKey', fallbackKey);
    }
  }

  /**
   * Applies INI configuration text (`[providers]`, `[models]`, `[keys]`) to state.
   */
  applyServerConfText(text: string): void {
    const sections = parseIniText(text);
    const providers = sections['providers'] || {};
    const models = sections['models'] || {};
    const keys = sections['keys'] || {};

    const aiProv = (providers['ai_provider'] || 'gemini').toLowerCase();
    const llmProvider: 'gemini' | 'openai' | 'none' =
      aiProv === 'openai' ? 'openai' : aiProv === 'none' ? 'none' : 'gemini';
    this.set('llmProvider', llmProvider);

    const cloudTtsProv = (
      providers['cloud_tts_provider'] || 'gemini'
    ).toLowerCase();
    const cloudTtsProvider: 'gemini' | 'openai' =
      cloudTtsProv === 'openai' ? 'openai' : 'gemini';
    this.set('cloudTtsProvider', cloudTtsProvider);

    if (models['gemini_model']) {
      this.set('agentModel', models['gemini_model']);
    }
    if (models['openai_model']) {
      this.set('openaiModel', models['openai_model']);
    }
    if (models['gemini_tts_model']) {
      this.set('speechModel', models['gemini_tts_model']);
    }
    if (models['openai_tts_model']) {
      this.set('openaiTtsModel', models['openai_tts_model']);
    }

    const geminiKey = keys['gemini_api_key'] || getInjectedGeminiApiKey() || '';
    const openaiKey = keys['openai_api_key'] || '';
    this.set('geminiApiKey', geminiKey);
    this.set('openaiApiKey', openaiKey);

    const activeCloudTtsKey =
      cloudTtsProvider === 'openai' ? openaiKey : geminiKey;
    this.set('ttsApiKey', activeCloudTtsKey);

    const hasUserSavedTtsProvider =
      typeof localStorage !== 'undefined' &&
      typeof localStorage.getItem === 'function' &&
      Boolean(localStorage.getItem('userSettings_ttsProvider'));

    if (!hasUserSavedTtsProvider) {
      const confTtsProv = (providers['tts_provider'] || 'kokoro').toLowerCase();
      const targetTtsProvider: 'gemini' | 'openai' | 'kokoro' =
        confTtsProv === 'gemini' || confTtsProv === 'openai'
          ? confTtsProv
          : 'kokoro';
      this.state.ttsProvider = targetTtsProvider;
      this.notify('ttsProvider', targetTtsProvider);
    } else if (this.state.ttsProvider !== 'kokoro') {
      this.set('ttsProvider', cloudTtsProvider);
    }

    const validVoices = getVoicesForTtsProvider(this.state.ttsProvider);
    if (!validVoices.some((v) => v.name === this.state.ttsVoice)) {
      this.set('ttsVoice', getDefaultVoiceForTtsProvider(this.state.ttsProvider));
    }
  }

  /** Returns the current value of a state property. */
  get<K extends keyof AppState>(key: K): AppState[K] {
    return this.state[key];
  }

  /** Updates a state property, notifies listeners, and syncs to storage if needed. */
  set<K extends keyof AppState>(key: K, value: AppState[K]) {
    if (this.state[key] === value) return;

    this.state[key] = value;
    this.notify(key, value);

    // Auto-save User Settings
    if ((USER_SETTINGS_KEYS as readonly string[]).includes(key as string)) {
      if (
        typeof localStorage !== 'undefined' &&
        typeof localStorage.setItem === 'function'
      ) {
        localStorage.setItem(
          `userSettings_${String(key)}`,
          typeof value === 'string' ? value : JSON.stringify(value),
        );
      }
    }

    // Auto-save Project Settings
    if ((PROJECT_SETTINGS_KEYS as readonly string[]).includes(key as string)) {
      if (
        typeof localStorage !== 'undefined' &&
        typeof localStorage.setItem === 'function'
      ) {
        const raw = localStorage.getItem('projectSettings_active');
        const projectSettings = raw ? JSON.parse(raw) : {};
        projectSettings[key as string] = value;
        localStorage.setItem(
          'projectSettings_active',
          JSON.stringify(projectSettings),
        );
      }
    }
  }

  /** Notifies all listeners for a given state property. */
  private notify<K extends keyof AppState>(key: K, value: AppState[K]) {
    const propertyListeners = this.listeners[key];
    if (propertyListeners) {
      for (const listener of propertyListeners) {
        (listener as StateListener<AppState[K]>)(value);
      }
    }
  }

  /**
   * Subscribes to changes of a specific state property.
   * Returns an unsubscribe function.
   */
  subscribe<K extends keyof AppState>(
    key: K,
    listener: StateListener<AppState[K]>,
  ): () => void {
    if (!this.listeners[key]) {
      this.listeners[key] = [] as Array<StateListener<AppState[K]>>;
    }
    (this.listeners[key] as Array<StateListener<AppState[K]>>).push(listener);

    // Initial notification
    listener(this.state[key]);

    return () => {
      const currentListeners = this.listeners[key];
      if (currentListeners) {
        this.listeners[key] = (
          currentListeners as Array<StateListener<AppState[K]>>
        ).filter((l) => l !== listener);
      }
    };
  }
}

export const appState = new AppStateManager();
if (typeof window !== 'undefined') {
  (window as any).appState = appState;
}
