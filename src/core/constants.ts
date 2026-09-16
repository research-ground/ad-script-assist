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

/** Defines the available Gemini model names. */
export enum ModelName {
  GEMINI_2_5_PRO = 'gemini-2.5-pro',
  GEMINI_2_5_FLASH = 'gemini-2.5-flash',
  GEMINI_2_5_FLASH_LITE = 'gemini-2.5-flash-lite',
  GEMINI_2_5_FLASH_TTS = 'gemini-2.5-flash-tts',
  GEMINI_3_FLASH = 'gemini-3-flash-preview',
  GEMINI_3_PRO = 'gemini-3-pro-preview',
  GEMINI_3_1_PRO = 'gemini-3.1-pro-preview',
  GEMINI_3_1_FLASH_LITE = 'gemini-3.1-flash-lite-preview',
  GEMINI_3_5_FLASH = 'gemini-3.5-flash',
}

/** The default Gemini model to use for Text-to-Speech. Using undefined for standard Cloud TTS. */
export const DEFAULT_TTS_MODEL = undefined;
/** The default Gemini model to use for the agent chat. */
export const DEFAULT_AGENT_MODEL = ModelName.GEMINI_3_5_FLASH;

export const TTS_LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'en-AU', label: 'English (AU)' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'ja-JP', label: 'Japanese' },
];

const GEMINI_VOICES = [
  { name: 'Aoede', label: 'Aoede' },
  { name: 'Charon', label: 'Charon' },
  { name: 'Fenrir', label: 'Fenrir' },
  { name: 'Kore', label: 'Kore' },
  { name: 'Puck', label: 'Puck' },
];

export const TTS_VOICES: Record<string, {name: string, label: string}[]> = {
  'en-US': GEMINI_VOICES,
  'en-GB': GEMINI_VOICES,
  'en-AU': GEMINI_VOICES,
  'es-ES': GEMINI_VOICES,
  'fr-FR': GEMINI_VOICES,
  'de-DE': GEMINI_VOICES,
  'it-IT': GEMINI_VOICES,
  'ja-JP': GEMINI_VOICES,
};

/** Threshold for audio speed adjustment. If the required speed is higher than this, it's considered high speed. */
export const HIGH_SPEED_SCALE_THRESHOLD = 4;
/** The assumed number of words spoken per second, used for estimating audio duration. */
export const WORDS_PER_SECOND_RATE = 3;
/** The assumed number of words spoken per minute. */
export const WORDS_PER_MINUTE_RATE = WORDS_PER_SECOND_RATE * 60;
/** The amount of time (in seconds) to play before and after a segment during playback. */
export const SEGMENT_PLAYBACK_PRE_POST_ROLL_TIME = 0.7;
/** The interval (in milliseconds) at which to announce waiting messages when waiting for a Gemini response. */
export const GEMINI_WAITING_ANNOUNCEMENT_INTERVAL_MS = 5000;
/** The timeout (in milliseconds) for MP3 generation. */
export const MP3_GENERATION_TIMEOUT_MS = 10000;

/** The command to reset the entire application state. */
export const RESET_ALL_COMMAND = '/reset-all';

/** A list of messages to be displayed or announced when waiting for a Gemini response. */
export const GEMINI_WAITING_MESSAGES = [
  'Still waiting for Gemini to respond.',
  'Still waiting on Gemini.',
  'Awaiting Gemini response.',
  'Gemini is still processing.',
];
