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

export type ServiceErrorKind = 'service_unavailable' | 'quota_exceeded';

export interface ServiceErrorAlert {
  kind: ServiceErrorKind;
  title: string;
  summary: string;
  details: string;
  suggestions: string[];
}

/**
 * Classifies transient service outages (HTTP 503 / UNAVAILABLE / overloaded)
 * and quota or rate-limit errors (HTTP 429 / RESOURCE_EXHAUSTED / quota) so
 * the UI can present an accessible modal alert with recovery steps.
 * Returns `null` for all other error types.
 */
export function classifyServiceError(
  error: unknown,
  provider?: 'gemini' | 'openai' | 'none',
  serviceLabel: 'VLM' | 'TTS' = 'VLM',
): ServiceErrorAlert | null {
  const details = describeError(error, provider);
  const raw = error instanceof Error ? error.message : String(error);
  const combined = `${details}\n${raw}`.toLowerCase();

  const isQuotaError =
    /\b429\b/.test(combined) ||
    combined.includes('resource_exhausted') ||
    combined.includes('quota') ||
    combined.includes('rate limit') ||
    combined.includes('rate_limit') ||
    combined.includes('too many requests') ||
    combined.includes('billing hard limit');

  if (isQuotaError) {
    const isTts = serviceLabel === 'TTS';
    return {
      kind: 'quota_exceeded',
      title: isTts
        ? 'Text-to-Speech Quota or Rate Limit Reached'
        : 'AI Service Quota or Rate Limit Reached',
      summary: isTts
        ? 'The cloud Text-to-Speech service reached its usage quota or rate limit. Narration fell back to local Kokoro speech.'
        : 'The AI service has reached its usage quota or rate limit, so this request could not be completed right now.',
      details,
      suggestions: isTts
        ? [
            'Wait a moment before regenerating cloud speech.',
            'Open Settings to switch TTS Engine to Kokoro (Local Browser TTS), choose another speech model, or enter your own API key.',
          ]
        : [
            'Wait a moment and try your request again.',
            'Open Settings to switch to a different model or provider, or enter your own personal API key.',
          ],
    };
  }

  const isServiceUnavailable =
    /\b503\b/.test(combined) ||
    combined.includes('service unavailable') ||
    combined.includes('status":"unavailable') ||
    combined.includes('(unavailable)') ||
    combined.includes('high demand') ||
    combined.includes('overloaded') ||
    combined.includes('temporarily unavailable');

  if (isServiceUnavailable) {
    const isTts = serviceLabel === 'TTS';
    return {
      kind: 'service_unavailable',
      title: isTts
        ? 'Text-to-Speech Service Temporarily Unavailable (503)'
        : 'AI Service Temporarily Unavailable (503)',
      summary: isTts
        ? 'The cloud Text-to-Speech service is temporarily overloaded or unavailable (HTTP 503). Narration fell back to local Kokoro speech.'
        : 'The AI model service is temporarily overloaded or unavailable (HTTP 503).',
      details,
      suggestions: isTts
        ? [
            'Wait a few seconds and retry cloud speech generation.',
            'Open Settings to switch to Kokoro (Local Browser TTS) or another speech model while the service recovers.',
          ]
        : [
            'Wait a few seconds and try your request again.',
            'Open Settings to try a different model or provider while this service recovers.',
          ],
    };
  }

  return null;
}

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
  const braceIdx = raw.indexOf('{');
  if (braceIdx !== -1) {
    const prefix = raw.slice(0, braceIdx).trim().replace(/:\s*$/, '');
    try {
      const body = JSON.parse(raw.slice(braceIdx));
      let e = body.error ?? body;
      if (typeof e === 'string') {
        try {
          const inner = JSON.parse(e);
          e = inner.error ?? inner;
        } catch {
          extracted = prefix ? `${prefix}: ${e}` : e;
        }
      } else if (e && typeof e === 'object' && typeof e.message === 'string') {
        try {
          const inner = JSON.parse(e.message);
          if (inner?.error) {
            e = inner.error;
          }
        } catch {
          // e.message is plain text
        }
      }
      if (e && typeof e === 'object' && e.message) {
        const codeLabel = [
          e.code ? `HTTP ${e.code}` : '',
          e.status ? `(${e.status})` : '',
        ]
          .filter(Boolean)
          .join(' ');
        extracted = codeLabel ? `${codeLabel}: ${e.message}` : e.message;
      }
    } catch {
      // Not JSON; fall through
    }
  } else if (raw.includes('<!DOCTYPE') || raw.includes('<html')) {
    const statusMatch = raw.match(/\b([45]\d{2})\b/);
    extracted = statusMatch
      ? `HTTP ${statusMatch[1]}: Upstream service returned an HTML error page.`
      : 'Upstream service returned an HTML error page.';
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
      return `${extracted} Make sure you configured a valid Google Gemini API key (not an OpenAI key) in models.conf.`;
    }
    if (provider === 'openai' && !extracted.includes('Gemini key')) {
      return `${extracted} Make sure you configured a valid OpenAI API key (not a Google Gemini key) in models.conf.`;
    }
  }

  return extracted;
}
