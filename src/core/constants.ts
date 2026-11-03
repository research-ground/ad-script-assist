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

declare const __AD_SCRIPT_ASSIST_GEMINI_API_KEY__: string | undefined;

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
  GEMINI_3_8_FLASH = 'gemini-3.8-flash',
  GEMINI_3_1_FLASH_TTS = 'gemini-3.1-flash-tts-preview',
}

/** The default Gemini model to use for Text-to-Speech. Using undefined for standard Cloud TTS. */
export const DEFAULT_TTS_MODEL = undefined;
/** The default Gemini model to use for the agent chat. */
export const DEFAULT_AGENT_MODEL = ModelName.GEMINI_3_8_FLASH;
/** The default Gemini model for AD speech (used when the provider is Gemini). */
export const DEFAULT_SPEECH_MODEL = ModelName.GEMINI_3_1_FLASH_TTS;
/** The default OpenAI model to use for the agent chat. */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o';
/** The default OpenAI model for AD speech (used when the cloud TTS provider is OpenAI). */
export const DEFAULT_OPENAI_TTS_MODEL = 'tts-1';

export const SERVER_KEY_PREFIX = '__SERVER_KEY:';
export const SERVER_KEY_ENV_PREFIX = '__SERVER_KEY_ENV:';

/**
 * Returns true if the value is a server-side key placeholder served by `GET /api/config`.
 */
export function isServerKeyPlaceholder(value?: string | null): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return (
    trimmed.startsWith(SERVER_KEY_PREFIX) ||
    trimmed.startsWith(SERVER_KEY_ENV_PREFIX)
  );
}

/**
 * Routes an outbound HTTP request through the server-side `/api/proxy` endpoint
 * when running in the browser so API keys remain strictly on the server.
 */
export async function proxiedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  if (typeof window === 'undefined') {
    return fetch(url, init);
  }

  const headersObj: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headersObj[k] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) {
        headersObj[k] = v;
      }
    } else {
      Object.assign(headersObj, init.headers as Record<string, string>);
    }
  }

  const bodyStr = typeof init?.body === 'string' ? init.body : undefined;
  return fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      method: init?.method || 'GET',
      headers: headersObj,
      body: bodyStr,
    }),
    signal: init?.signal,
  });
}

/** Default local Kokoro voice used when a local voice is selected or when cloud TTS falls back. */
export const DEFAULT_KOKORO_VOICE = 'af_heart';

/** Suggestions for the free-text model fields in Settings (any model name can be typed). */
export const AGENT_MODEL_SUGGESTIONS = Object.values(ModelName).filter((m) => !m.includes('tts'));
export const SPEECH_MODEL_SUGGESTIONS = Object.values(ModelName).filter((m) => m.includes('tts'));

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

export const GEMINI_VOICES = [
  { name: 'Aoede', label: 'Aoede (Gemini Cloud)' },
  { name: 'Charon', label: 'Charon (Gemini Cloud)' },
  { name: 'Fenrir', label: 'Fenrir (Gemini Cloud)' },
  { name: 'Kore', label: 'Kore (Gemini Cloud)' },
  { name: 'Puck', label: 'Puck (Gemini Cloud)' },
];

export const OPENAI_VOICES = [
  { name: 'alloy', label: 'Alloy (OpenAI Cloud)' },
  { name: 'ash', label: 'Ash (OpenAI Cloud)' },
  { name: 'coral', label: 'Coral (OpenAI Cloud)' },
  { name: 'echo', label: 'Echo (OpenAI Cloud)' },
  { name: 'fable', label: 'Fable (OpenAI Cloud)' },
  { name: 'nova', label: 'Nova (OpenAI Cloud)' },
  { name: 'onyx', label: 'Onyx (OpenAI Cloud)' },
  { name: 'sage', label: 'Sage (OpenAI Cloud)' },
  { name: 'shimmer', label: 'Shimmer (OpenAI Cloud)' },
];

export const KOKORO_VOICES = [
  { name: 'af_heart', label: 'Heart (Kokoro Local)' },
  { name: 'af_bella', label: 'Bella (Kokoro Local)' },
  { name: 'af_nicole', label: 'Nicole (Kokoro Local)' },
  { name: 'am_fenrir', label: 'Fenrir (Kokoro Local)' },
  { name: 'am_michael', label: 'Michael (Kokoro Local)' },
  { name: 'am_puck', label: 'Puck (Kokoro Local)' },
  { name: 'bf_emma', label: 'Emma (Kokoro Local, UK)' },
  { name: 'bm_george', label: 'George (Kokoro Local, UK)' },
];

const ALL_VOICES = [...GEMINI_VOICES, ...OPENAI_VOICES, ...KOKORO_VOICES];

const KOKORO_VOICE_SET = new Set(KOKORO_VOICES.map((v) => v.name));
const OPENAI_VOICE_SET = new Set(OPENAI_VOICES.map((v) => v.name));
const GEMINI_VOICE_SET = new Set(GEMINI_VOICES.map((v) => v.name));

/** Returns true if the given voice identifier is a local Kokoro neural TTS voice. */
export function isKokoroVoice(voiceName: string): boolean {
  return KOKORO_VOICE_SET.has(voiceName) || /^(af|am|bf|bm)_/.test(voiceName);
}

/** Returns true if the given voice identifier is an OpenAI TTS voice. */
export function isOpenAIVoice(voiceName: string): boolean {
  return OPENAI_VOICE_SET.has(voiceName);
}

/** Returns true if the given voice identifier is a Google Gemini TTS voice. */
export function isGeminiVoice(voiceName: string): boolean {
  return GEMINI_VOICE_SET.has(voiceName);
}

/** Returns the default voice for the given TTS engine. */
export function getDefaultVoiceForTtsProvider(provider: 'gemini' | 'openai' | 'kokoro'): string {
  if (provider === 'openai') return 'alloy';
  if (provider === 'kokoro') return DEFAULT_KOKORO_VOICE;
  return 'Aoede';
}

/** Returns the available voice options for the selected TTS engine. */
export function getVoicesForTtsProvider(
  provider: 'gemini' | 'openai' | 'kokoro',
): {name: string; label: string}[] {
  if (provider === 'kokoro') {
    return KOKORO_VOICES;
  }
  if (provider === 'openai') {
    return [...OPENAI_VOICES, ...KOKORO_VOICES];
  }
  return [...GEMINI_VOICES, ...KOKORO_VOICES];
}

export const TTS_VOICES: Record<string, {name: string, label: string}[]> = {
  'en-US': ALL_VOICES,
  'en-GB': ALL_VOICES,
  'en-AU': ALL_VOICES,
  'es-ES': ALL_VOICES,
  'fr-FR': ALL_VOICES,
  'de-DE': ALL_VOICES,
  'it-IT': ALL_VOICES,
  'ja-JP': ALL_VOICES,
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

/**
 * Reads an environment variable injected by the host runtime (e.g. Google AI
 * Studio `process.env.GEMINI_API_KEY` or `process.env.API_KEY`) or a global
 * `__AD_SCRIPT_ASSIST_<KEY>__` shim.
 */
function readInjectedEnv(key: string): string {
  const g = globalThis as Record<string, unknown>;
  const winVal = g[`__AD_SCRIPT_ASSIST_${key}__`];
  if (typeof winVal === 'string' && winVal.trim() !== '') {
    return winVal.trim();
  }
  if (typeof window === 'undefined') {
    const proc = g['process'] as { env?: Record<string, unknown> } | undefined;
    const fromProc = proc?.env?.[key];
    if (typeof fromProc === 'string' && fromProc.trim() !== '') {
      return fromProc.trim();
    }
  }
  return '';
}

/**
 * Returns the Gemini API key injected by the environment or host (Google AI
 * Studio, `.env`, or `VITE_GEMINI_API_KEY`). When non-empty, the UI locks the
 * provider to Gemini and hides API key and model settings.
 */
export function getInjectedGeminiApiKey(): string {
  const fromVite = (
    import.meta.env?.VITE_GEMINI_API_KEY ||
    (typeof __AD_SCRIPT_ASSIST_GEMINI_API_KEY__ !== 'undefined' ? __AD_SCRIPT_ASSIST_GEMINI_API_KEY__ : '') ||
    ''
  ).trim();
  if (fromVite) {
    return fromVite;
  }
  return readInjectedEnv('GEMINI_API_KEY') || readInjectedEnv('API_KEY');
}

/**
 * Gemini API key embedded at build time or injected by the host environment
 * (e.g. Google AI Studio). When set, the app is locked to Gemini with this key:
 * users can't change the key, models, or switch providers.
 */
export const EMBEDDED_GEMINI_API_KEY: string = getInjectedGeminiApiKey();
