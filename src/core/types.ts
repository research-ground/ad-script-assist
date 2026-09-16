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

/** Represents a single entry in the conversation history. */
export interface ConversationEntry {
  type: 'user' | 'agent' | 'system';
  message: string;
  trashed: boolean;
  timestamp: string;
  videoId: string;
}

/** Data associated with a Gemini request. */
export interface GeminiRequestPlusData {
  command?: string;
  commandText?: string;
  adTextBefore?: string;
  adTextAfter?: string;
  videoId: string;
}

/** Represents an audio description segment. */
export interface AdSegment {
  startTime: number;
  endTime: number;
  script: string;
  changed: boolean;
  audioData?: string;
  generationFailed?: boolean;
  videoId: string;
}

/**
 * The initiator of an AD script update.
 */
export type AdScriptUpdateInitiator = 'USER' | 'AGENT' | 'SYSTEM';

/** Context provided to the agent. */
export interface AgentContext {
  remoteURL?: string;
  videoFile?: File;
  videoId?: string;
  currentTime?: number;
  videoDuration?: number;
  adScriptText?: string;
  adScriptLine?: number;
}

/** Represents the structure of a response from the agent. */
export interface AgentResponse {
  response: string;
  script?: string;
  timestamp?: number;
  line?: number;
}

/**
 * Type guard to check if an object matches the AgentResponse interface.
 */
export function isAgentResponse(obj: unknown): obj is AgentResponse {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false;
  }
  const res = obj as AgentResponse;

  return typeof res.response === 'string' || typeof res.script === 'string';
}

/** Configuration for a hotkey. */
export interface HotkeyConfigEntry {
  description: string;
  command: string;
  keyCombo: string;
  preventDefault?: boolean;
}

/** Interface for a video player. */
export interface VideoPlayerApi {
  currentTime: number;
  duration: number;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

/** Generic State Listener. */
export type StateListener<T> = (newValue: T, oldValue: T) => void;

/** General application settings. */
export interface GeneralSettings {
  voiceId: string;
  playbackRate: number;
}

