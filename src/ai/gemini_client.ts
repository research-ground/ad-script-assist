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
import {DEFAULT_AGENT_MODEL, ModelName} from '../core/constants';
import {GeminiRequestPlusData} from '../core/types';
import {appState} from '../core/app_state';


let aiInstance: GoogleGenAI | null = null;
let backendUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
if (typeof window !== 'undefined') {
  const urlParams = new URLSearchParams(window.location.search);
  const override = urlParams.get('backend');
  if (override) {
    backendUrl = override.replace(/\/$/, ''); // strip trailing slash
  }
}

export async function getAI(): Promise<GoogleGenAI> {
  if (!aiInstance) {
    let apiKey = '';
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlKey = urlParams.get('api_key') || urlParams.get('key');
      if (urlKey) {
        apiKey = urlKey;
        // Optionally save it so it persists on reload
        appState.set('geminiApiKey', apiKey);
      } else {
        // A key saved in Settings wins; otherwise use the key embedded at
        // build time (e.g. the GitHub Pages deploy). Empty in local builds.
        apiKey = appState.get('geminiApiKey') || import.meta.env.VITE_GEMINI_API_KEY || '';
      }
    } else if (typeof process !== 'undefined' && process.env) {
      // Node.js environment
      apiKey = process.env.GEMINI_API_KEY || '';
    }
    
    if (!apiKey) {
      apiKey = 'dummy-key-for-tests'; // Fallback for tests
    }
    aiInstance = new GoogleGenAI({
      apiKey: apiKey,
    });
  }

  return aiInstance;
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
    modelName: ModelName,
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
      const ai = await getAI();
      // We explicitly do NOT enforce JSON schema or use responseMimeType: 'application/json'
      // because it can sometimes cause the model to perform poorly, hallucinate, or fail
      // on complex multimodal inputs. Instead, we use a robust client-side parser
      // (parseGeminiJsonResponse) to extract JSON from the raw text response.
      const response: GenerateContentResponse = await ai.models.generateContent(
        {
          model: modelName,
          contents: [{role: 'user', parts}],
          config: {
            maxOutputTokens: 16384,
          },
        },
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
        }
      } else {
        console.warn(
          'Gemini response received, but no candidates or parts found.',
          response,
        );
        if (response.promptFeedback?.blockReason) {
          console.error(
            `Request was blocked: ${response.promptFeedback.blockReason}`,
          );
        }
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
    model: ModelName = DEFAULT_AGENT_MODEL,
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
    model: ModelName = DEFAULT_AGENT_MODEL,
    data?: GeminiRequestPlusData,
  ) {
    const arrayBuffer = await videoBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const CHUNK_SIZE = 0x8000;
    let binary = '';
    for (let i = 0; i < uint8.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK_SIZE) as any);
    }
    const base64 = btoa(binary);

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
