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

import {proxiedFetch} from '../core/constants';
import {describeError, validateApiKeyForProvider} from './describe_error';

export interface ProbedModels {
  vlmModels: string[];
  ttsModels: string[];
}

interface GeminiModelEntry {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface OpenAIModelEntry {
  id?: string;
  created?: number;
}

const GEMINI_EXCLUDED_PATTERN =
  /embedding|aqa|imagen|veo|lyria|robotics|computer-use|learnlm/i;
const OPENAI_TTS_PATTERN = /^tts-|-tts\b/i;
const OPENAI_CHAT_INCLUDE_PATTERN = /^(gpt-|chatgpt-|o[1-9])/i;
const OPENAI_CHAT_EXCLUDE_PATTERN =
  /tts|audio|realtime|transcribe|instruct|search|whisper|dall-e|embedding|moderation|image|sora|codex/i;

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

async function probeGeminiModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ProbedModels> {
  const allModels: GeminiModelEntry[] = [];
  let pageToken = '';

  for (let page = 0; page < 3; page++) {
    const tokenParam = pageToken
      ? `&pageToken=${encodeURIComponent(pageToken)}`
      : '';
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${tokenParam}&key=${encodeURIComponent(apiKey)}`;
    const res = await proxiedFetch(url, {method: 'GET', signal});
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(
        errText ||
          `Gemini models request failed (${res.status}): ${res.statusText}`,
      );
    }
    const json = (await res.json()) as {
      models?: GeminiModelEntry[];
      nextPageToken?: string;
    };
    if (Array.isArray(json.models)) {
      allModels.push(...json.models);
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }

  const vlmModels: string[] = [];
  const ttsModels: string[] = [];

  for (const entry of allModels) {
    const rawName = (entry.name || '').trim();
    if (!rawName) continue;
    const id = rawName.replace(/^models\//, '');
    const methods = entry.supportedGenerationMethods;
    if (
      Array.isArray(methods) &&
      methods.length > 0 &&
      !methods.includes('generateContent')
    ) {
      continue;
    }

    if (/tts/i.test(id)) {
      ttsModels.push(id);
    } else if (/^(gemini|gemma)-/i.test(id) && !GEMINI_EXCLUDED_PATTERN.test(id)) {
      vlmModels.push(id);
    }
  }

  // Sort reverse-alphanumerically so newer major/minor versions appear first.
  const sortNewestFirst = (a: string, b: string) =>
    b.localeCompare(a, undefined, {numeric: true, sensitivity: 'base'});

  return {
    vlmModels: dedupe(vlmModels).sort(sortNewestFirst),
    ttsModels: dedupe(ttsModels).sort(sortNewestFirst),
  };
}

async function probeOpenAIModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ProbedModels> {
  const res = await proxiedFetch('https://api.openai.com/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      errText
        ? `OpenAI models request failed (${res.status}): ${errText}`
        : `OpenAI models request failed (${res.status}): ${res.statusText}`,
    );
  }

  const json = (await res.json()) as {data?: OpenAIModelEntry[]};
  const entries = Array.isArray(json.data) ? json.data : [];

  const vlmEntries: Array<{id: string; created: number}> = [];
  const ttsEntries: Array<{id: string; created: number}> = [];

  for (const entry of entries) {
    const id = (entry.id || '').trim();
    if (!id) continue;
    const created = typeof entry.created === 'number' ? entry.created : 0;

    if (OPENAI_TTS_PATTERN.test(id)) {
      ttsEntries.push({id, created});
    } else if (
      OPENAI_CHAT_INCLUDE_PATTERN.test(id) &&
      !OPENAI_CHAT_EXCLUDE_PATTERN.test(id)
    ) {
      vlmEntries.push({id, created});
    }
  }

  const sortByCreatedDesc = (
    a: {id: string; created: number},
    b: {id: string; created: number},
  ) =>
    b.created - a.created ||
    b.id.localeCompare(a.id, undefined, {numeric: true, sensitivity: 'base'});

  return {
    vlmModels: dedupe(vlmEntries.sort(sortByCreatedDesc).map((e) => e.id)),
    ttsModels: dedupe(ttsEntries.sort(sortByCreatedDesc).map((e) => e.id)),
  };
}

/**
 * Probes the configured AI provider's models endpoint and returns available
 * Vision-Language (VLM) and Text-to-Speech (TTS) model IDs.
 */
export async function probeAvailableModels(
  provider: 'gemini' | 'openai',
  apiKey: string,
  signal?: AbortSignal,
): Promise<ProbedModels> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error(
      `No ${provider === 'openai' ? 'OpenAI ChatGPT' : 'Google Gemini'} API key configured.`,
    );
  }

  const keyMismatch = validateApiKeyForProvider(trimmedKey, provider, 'VLM');
  if (keyMismatch) {
    throw new Error(keyMismatch);
  }

  try {
    if (provider === 'openai') {
      return await probeOpenAIModels(trimmedKey, signal);
    }
    return await probeGeminiModels(trimmedKey, signal);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    throw new Error(describeError(err, provider));
  }
}
