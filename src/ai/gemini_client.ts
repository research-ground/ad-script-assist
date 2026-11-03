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

import {GenerateContentResponse, GoogleGenAI, Part} from '@google/genai';
import {
  DEFAULT_AGENT_MODEL,
  getInjectedGeminiApiKey,
  isServerKeyPlaceholder,
  proxiedFetch,
} from '../core/constants';
import {GeminiRequestPlusData} from '../core/types';
import {appState} from '../core/app_state';
import {validateApiKeyForProvider} from './describe_error';


let aiInstance: GoogleGenAI | null = null;
let aiInstanceKey = '';
let backendUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
if (typeof window !== 'undefined') {
  const urlParams = new URLSearchParams(window.location.search);
  const override = urlParams.get('backend');
  if (override) {
    backendUrl = override.replace(/\/$/, ''); // strip trailing slash
  }
}

export function resolveGeminiApiKey(): string {
  const injectedKey = getInjectedGeminiApiKey();
  if (injectedKey) {
    return injectedKey;
  }
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const urlKey = urlParams.get('api_key') || urlParams.get('key');
    if (urlKey) {
      appState.set('geminiApiKey', urlKey);
      return urlKey;
    }
    return appState.get('geminiApiKey') || '';
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  }
  return '';
}

export async function getAI(apiKeyOverride?: string): Promise<GoogleGenAI> {
  const resolvedKey = (apiKeyOverride?.trim() || resolveGeminiApiKey()) || 'dummy-key-for-tests';
  if (!aiInstance || aiInstanceKey !== resolvedKey) {
    aiInstanceKey = resolvedKey;
    aiInstance = new GoogleGenAI({
      apiKey: resolvedKey,
    });
  }

  return aiInstance;
}

/**
 * Executes a Gemini `generateContent` request through `/api/proxy` in the browser
 * (where `src/server.ts` executes `@google/genai` on the server with the real key)
 * or directly via `@google/genai` in Node CLI mode.
 */
export async function callGeminiGenerateContent(
  apiKey: string,
  params: {
    model: string;
    contents: unknown;
    config?: Record<string, unknown>;
  },
  signal?: AbortSignal,
): Promise<GenerateContentResponse> {
  if (typeof window !== 'undefined' || isServerKeyPlaceholder(apiKey)) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await proxiedFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: params.contents,
        config: params.config,
      }),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(
        errText || `Gemini API request failed (${res.status}): ${res.statusText}`,
      );
    }
    return (await res.json()) as GenerateContentResponse;
  }

  const ai = await getAI(apiKey);
  return ai.models.generateContent({
    model: params.model,
    contents: params.contents as never,
    config: params.config as never,
  });
}

// Track request lifecycle to prevent reuse
enum RequestState {
  NOT_STARTED,
  REQUEST_SENT,
  COMPLETED,
}

/**
 * Handles requests to the Gemini AI model.
 */
class GeminiRequest {
  /** Timestamp when the request was sent (performance.now()). */
  startTime = -1;
  /** Duration of the request in seconds. */
  duration = -1;
  /** Current state of the request. */
  state: RequestState = RequestState.NOT_STARTED;
  /** Whether the request has been aborted. */
  isAborted = false;
  /** Controller to abort the underlying network request. */
  private readonly abortController = new AbortController();

  /** Aborts the current request and ignores any subsequent responses. */
  abort() {
    this.isAborted = true;
    this.abortController.abort();
    // Aborted is same as completed for all intents and purposes.
    this.state = RequestState.COMPLETED;
  }

  private async callGemini(
    parts: Part[],
    modelName: string,
    callback: (response: string) => void,
    onError: (error: unknown) => void,
    data?: GeminiRequestPlusData,
  ) {
    if (this.state !== RequestState.NOT_STARTED) {
      throw new Error('Request object has already been used');
    }

    this.state = RequestState.REQUEST_SENT;
    this.startTime = performance.now();
    if (!data || !data.videoId) {
      throw new Error('videoId is required to make a Gemini request');
    }


    try {
      const resolvedKey = resolveGeminiApiKey();
      if (!resolvedKey.trim()) {
        throw new Error('No Gemini API key configured. Please add gemini_api_key in models.conf.');
      }
      const keyMismatch = validateApiKeyForProvider(resolvedKey, 'gemini', 'VLM');
      if (keyMismatch) {
        throw new Error(keyMismatch);
      }
      // We explicitly do NOT enforce JSON schema or use responseMimeType: 'application/json'
      // because it can sometimes cause the model to perform poorly, hallucinate, or fail
      // on complex multimodal inputs. Instead, we use a robust client-side parser
      // (parseGeminiJsonResponse) to extract JSON from the raw text response.
      const response: GenerateContentResponse = await callGeminiGenerateContent(
        resolvedKey,
        {
          model: modelName,
          contents: [{role: 'user', parts}],
          config: {
            maxOutputTokens: 16384,
          },
        },
        this.abortController.signal,
      );

      this.duration = (performance.now() - this.startTime) / 1000;


      const candidate = response.candidates?.[0];
      if (
        candidate &&
        candidate.content?.parts &&
        candidate.content.parts.length > 0
      ) {
        if (this.isAborted) {
          console.log('GeminiRequest was aborted, dropping response.');
          return;
        }

        const text = candidate.content.parts[0].text;
        this.state = RequestState.COMPLETED;
        if (text) {
          if (candidate.finishReason === 'MAX_TOKENS') {
            console.warn('Gemini response was truncated due to max tokens.');
          }
          callback(text);
        } else {
          console.warn(
            'Gemini response received, but text was empty.',
            response,
          );
          onError(new Error(`Gemini returned an empty response (finish reason: ${candidate.finishReason ?? 'unknown'}).`));
        }
      } else {
        console.warn(
          'Gemini response received, but no candidates or parts found.',
          response,
        );
        const blockReason = response.promptFeedback?.blockReason;
        if (blockReason) {
          console.error(
            `Request was blocked: ${blockReason}`,
          );
        }
        this.state = RequestState.COMPLETED;
        onError(new Error(blockReason ? `Gemini blocked the request (${blockReason}).` : 'Gemini returned no response.'));
      }
    } catch (error) {
      if (this.isAborted) {
        console.log('GeminiRequest was aborted, ignoring error:', error);
        return;
      }

      this.duration = (performance.now() - this.startTime) / 1000;

      console.error('Error calling Gemini API:', error);
      this.state = RequestState.COMPLETED;
      onError(error);
    }
  }

  /**
   * Calls Gemini with a YouTube video URL and a prompt.
   * @param prompt The prompt to send.
   * @param ytUrl The YouTube URL.
   * @param callback Function to handle the response text.
   * @param onError Function to handle errors.
   * @param model The model to use.
   * @param data Additional data for logging.
   */
  async callGeminiWithYouTubeURL(
    prompt: string,
    ytUrl: string,
    callback: (response: string) => void,
    onError: (error: unknown) => void,
    model: string = DEFAULT_AGENT_MODEL,
    data?: GeminiRequestPlusData,
  ) {
    const parts: Part[] = [
      {text: prompt},
      {
        fileData: {
          fileUri: ytUrl,
          mimeType: 'video/mp4',
        },
      },
    ];

    await this.callGemini(parts, model, callback, onError, data);
  }

  /**
   * Calls Gemini with a local video Blob and a prompt.
   */
  async callGeminiWithLocalVideo(
    prompt: string,
    videoBlob: Blob,
    callback: (response: string) => void,
    onError: (error: unknown) => void,
    model: string = DEFAULT_AGENT_MODEL,
    data?: GeminiRequestPlusData,
  ) {
    const arrayBuffer = await videoBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    // Use a chunk size divisible by 3 (30,720 bytes = 3 * 10,240) so each chunk
    // can be base64-encoded independently without intermediate '=' padding or
    // allocating a single giant binary string for 1 GB+ video blobs.
    const CHUNK_SIZE = 30720;
    const base64Chunks: string[] = [];
    for (let i = 0; i < uint8.length; i += CHUNK_SIZE) {
      const sub = uint8.subarray(i, i + CHUNK_SIZE);
      base64Chunks.push(btoa(String.fromCharCode.apply(null, sub as any)));
    }
    const base64 = base64Chunks.join('');

    const parts: Part[] = [
      {text: prompt},
      {
        inlineData: {
          data: base64,
          mimeType: videoBlob.type || 'video/mp4',
        },
      },
    ];

    await this.callGemini(parts, model, callback, onError, data);
  }
}

export {GeminiRequest};
