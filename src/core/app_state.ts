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
import {getInjectedGeminiApiKey} from './constants';

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
  isExportEnabled: boolean;
  isClearEnabled: boolean;
  isAgentInputEnabled: boolean;

  // Editor State
  editorScriptText: string;
  editorCursorLine: number;
  
  // User Settings (Saved globally)
  geminiApiKey: string;
  openaiApiKey: string;
  llmProvider: 'gemini' | 'openai';
  ttsLanguage: string;
  agentModel: string; // '' = DEFAULT_AGENT_MODEL
  speechModel: string; // '' = DEFAULT_SPEECH_MODEL
  
  // Project Settings (Saved per-video)
  ttsVoice: string;
  speakAdText: boolean;
  videoType: 'local' | 'youtube';
  videoSource: string;
  scriptNotes: string;

  [key: string]: any;
}

type StateListener<T> = (value: T) => void;

const USER_SETTINGS_KEYS = ['geminiApiKey', 'openaiApiKey', 'llmProvider', 'ttsLanguage', 'agentModel', 'speechModel'] as const;
const PROJECT_SETTINGS_KEYS = [
  'currentVideoId',
  'ttsVoice',
  'speakAdText',
  'videoType',
  'videoSource',
  'scriptNotes',
] as const;

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
    isExportEnabled: false,
    isClearEnabled: false,
    isAgentInputEnabled: false,

    editorScriptText: '',
    editorCursorLine: 1,

    geminiApiKey: '',
    openaiApiKey: '',
    llmProvider: 'gemini',
    ttsLanguage: 'en-US',
    agentModel: '',
    speechModel: '',
    
    ttsVoice: 'Aoede',
    speakAdText: true,
    videoType: 'youtube',
    videoSource: '',
    scriptNotes: '',
  };

  private readonly listeners: {
    [K in keyof AppState]?: Array<StateListener<AppState[K]>>;
  } = {};

  constructor() {
    // Load User Settings from localStorage immediately
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      const hasInjectedKey = Boolean(getInjectedGeminiApiKey());
      this.state.geminiApiKey = localStorage.getItem('userSettings_geminiApiKey') || '';
      this.state.openaiApiKey = localStorage.getItem('userSettings_openaiApiKey') || '';
      this.state.llmProvider = (localStorage.getItem('userSettings_llmProvider') as 'gemini' | 'openai') || 'gemini';
      if (hasInjectedKey) this.state.llmProvider = 'gemini'; // Injected key / AI Studio: locked to Gemini.
      this.state.ttsLanguage = localStorage.getItem('userSettings_ttsLanguage') || 'en-US';
      if (!hasInjectedKey) { // Injected key / AI Studio: always the default models.
        this.state.agentModel = localStorage.getItem('userSettings_agentModel') || '';
        this.state.speechModel = localStorage.getItem('userSettings_speechModel') || '';
      }
      
      // Load active project settings immediately
      const raw = localStorage.getItem('projectSettings_active');
      if (raw) {
        const projectSettings = JSON.parse(raw);
        for (const pKey of PROJECT_SETTINGS_KEYS) {
          if (projectSettings[pKey] !== undefined) {
            (this.state as any)[pKey] = projectSettings[pKey];
          }
        }
      }
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
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        localStorage.setItem(`userSettings_${String(key)}`, typeof value === 'string' ? value : JSON.stringify(value));
      }
    }

    // Auto-save Project Settings
    if ((PROJECT_SETTINGS_KEYS as readonly string[]).includes(key as string)) {
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        const raw = localStorage.getItem('projectSettings_active');
        const projectSettings = raw ? JSON.parse(raw) : {};
        projectSettings[key as string] = value;
        localStorage.setItem('projectSettings_active', JSON.stringify(projectSettings));
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
        ).filter((l) => l !== listener) as Array<StateListener<AppState[K]>>;
      }
    };
  }
}

export const appState = new AppStateManager();
if (typeof window !== 'undefined') {
  (window as any).appState = appState;
}
