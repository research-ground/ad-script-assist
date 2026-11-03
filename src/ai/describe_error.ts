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
 * @fileoverview Turns API errors into short, human-readable messages.
 */

/**
 * Checks whether an API key looks like it belongs to a different provider
 * (e.g. a Google Gemini `AIza...` key used with OpenAI, or an OpenAI `sk-...`
 * key used with Google Gemini) and returns a helpful error message if so.
 */
export function validateApiKeyForProvider(
  apiKey: string,
  provider: 'gemini' | 'openai',
  serviceLabel: 'VLM' | 'TTS' = 'VLM',
): string | null {
  const trimmed = (apiKey || '').trim();
  if (!trimmed || trimmed.startsWith('__SERVER_KEY')) {
    return null;
  }
  if (provider === 'gemini' && trimmed.startsWith('sk-')) {
    return `The ${serviceLabel} API key starts with "sk-", which looks like an OpenAI key rather than a Google Gemini key (Gemini keys start with "AIza"). Please check your ${serviceLabel} provider and API key in models.conf.`;
  }
  if (provider === 'openai' && trimmed.startsWith('AIza')) {
    return `The ${serviceLabel} API key starts with "AIza", which looks like a Google Gemini key rather than an OpenAI key (OpenAI keys start with "sk-"). Please check your ${serviceLabel} provider and API key in models.conf.`;
  }
  return null;
}

/**
 * Returns a readable message for an error thrown by an AI client. The Gemini
 * SDK puts a JSON body in `error.message`, e.g.
 * `{"error":{"code":503,"message":"...","status":"UNAVAILABLE"}}`.
 */
export function describeError(
  error: unknown,
  provider?: 'gemini' | 'openai' | 'none',
): string {
  const raw = error instanceof Error ? error.message : String(error);
  let extracted = raw;
  try {
    const body = JSON.parse(raw.slice(raw.indexOf('{')));
    const e = body.error ?? body;
    if (e.message) {
      const code = [e.code, e.status && `(${e.status})`].filter(Boolean).join(' ');
      extracted = code ? `${code}: ${e.message}` : e.message;
    }
  } catch {
    // Not JSON; fall through to the raw message.
  }

  const lower = extracted.toLowerCase();
  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid_api_key') ||
    lower.includes('incorrect api key') ||
    lower.includes('401') ||
    lower.includes('unauthorized')
  ) {
    if (provider === 'gemini' && !extracted.includes('OpenAI key')) {
      return `${extracted} Make sure you entered a valid Google Gemini API key (not an OpenAI key) in Settings.`;
    }
    if (provider === 'openai' && !extracted.includes('Gemini key')) {
      return `${extracted} Make sure you entered a valid OpenAI API key (not a Google Gemini key) in Settings.`;
    }
  }

  return extracted;
}
