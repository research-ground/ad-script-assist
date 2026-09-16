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

import { DEFAULT_AGENT_MODEL, ModelName } from '../core/constants';
import { GeminiRequestPlusData } from '../core/types';
import { appState } from '../core/app_state';

export function getOpenAIApiKey(): string {
  let apiKey = '';
  if (typeof window !== 'undefined') {
    apiKey = appState.get('openaiApiKey');
  } else if (typeof process !== 'undefined' && process.env) {
    apiKey = process.env.OPENAI_API_KEY || '';
  }
  if (!apiKey) {
    apiKey = 'dummy-key-for-tests'; // Fallback for tests
  }
  return apiKey;
}

enum RequestState {
  NOT_STARTED,
  REQUEST_SENT,
  COMPLETED,
}

export class OpenAIRequest {
  startTime = -1;
  duration = -1;
  state: RequestState = RequestState.NOT_STARTED;
  isAborted = false;
  private readonly abortController = new AbortController();

  abort() {
    this.isAborted = true;
    this.abortController.abort();
    this.state = RequestState.COMPLETED;
  }

  private async callOpenAI(
    messages: any[],
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
      throw new Error('videoId is required');
    }

    try {
      const apiKey = getOpenAIApiKey();
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: messages,
          max_tokens: 4096,
          response_format: { type: "json_object" },
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI API request failed: ${response.statusText}`);
      }

      const json = await response.json();
      this.duration = (performance.now() - this.startTime) / 1000;

      const choice = json.choices?.[0];
      if (choice && choice.message && choice.message.content) {
        if (this.isAborted) return;
        this.state = RequestState.COMPLETED;
        callback(choice.message.content);
      } else {
        console.warn('OpenAI response empty.', json);
      }
    } catch (error) {
      if (this.isAborted) return;
      this.duration = (performance.now() - this.startTime) / 1000;
      console.error('Error calling OpenAI API:', error);
      this.state = RequestState.COMPLETED;
      onError(error);
    }
  }

  async callOpenAIWithYouTubeURL(
    prompt: string,
    ytUrl: string,
    callback: (response: string) => void,
    onError: (error: unknown) => void,
    model: string = 'gpt-4o',
    data?: GeminiRequestPlusData,
  ) {
    throw new Error('OpenAI API does not natively support YouTube videos. Please use local videos or process YouTube videos externally.');
  }

  async callOpenAIWithFrames(
    prompt: string,
    frames: string[],
    callback: (response: string) => void,
    onError: (error: unknown) => void,
    model: string = 'gpt-4o',
    data?: GeminiRequestPlusData,
  ) {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...frames.map(b64 => ({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${b64}` }
          }))
        ]
      }
    ];

    await this.callOpenAI(messages, model, callback, onError, data);
  }
}
