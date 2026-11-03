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

import {ttsCache} from '../web/storage/tts_cache';
import {callGeminiGenerateContent, resolveGeminiApiKey} from './gemini_client';
import {getOpenAIApiKey} from './openai_client';
import {generateKokoroPcm} from './kokoro_tts';
import {appState} from '../core/app_state';
import {
  DEFAULT_KOKORO_VOICE,
  DEFAULT_OPENAI_TTS_MODEL,
  DEFAULT_SPEECH_MODEL,
  isGeminiVoice,
  isKokoroVoice,
  isOpenAIVoice,
  proxiedFetch,
} from '../core/constants';
import {describeError, validateApiKeyForProvider} from './describe_error';

export interface TtsFallbackListener {
  (reason: unknown, fallbackVoice: string): void;
}

let onCloudFallbackListener: TtsFallbackListener | null = null;

/** Registers a listener invoked when cloud TTS fails and falls back to local Kokoro TTS. */
export function setTtsFallbackListener(listener: TtsFallbackListener | null) {
  onCloudFallbackListener = listener;
}

async function synthesizeWithKokoro(
  text: string,
  voiceName: string,
  speed: number,
): Promise<string> {
  const kokoroVoice = isKokoroVoice(voiceName) ? voiceName : DEFAULT_KOKORO_VOICE;
  const cachedBlob = await ttsCache.get(text, kokoroVoice, speed);
  if (cachedBlob) {
    return blobToBase64(cachedBlob);
  }

  console.log(`[TTS Local] Generating Kokoro audio (${kokoroVoice}) for text: "${text}"`);
  const {pcmBytes, sampleRate} = await generateKokoroPcm(text, kokoroVoice, speed);
  const wavBlob = pcmToWavBlob(pcmBytes, sampleRate, 1);
  await ttsCache.add(text, kokoroVoice, speed, wavBlob);
  return blobToBase64(wavBlob);
}

/**
 * Generates Text-to-Speech audio from the provided text.
 * Supports local Kokoro voices directly and automatically falls back to
 * `DEFAULT_KOKORO_VOICE` (`af_heart`) if cloud TTS is unconfigured or fails.
 */
export async function generateTTS(
  text: string,
  voiceName: string = DEFAULT_KOKORO_VOICE,
  speed: number = 1.0,
  provider?: string,
): Promise<string> {
  const ttsProvider =
    (provider as 'gemini' | 'openai' | 'kokoro' | undefined) ||
    (typeof window !== 'undefined' ? appState.get('ttsProvider') : 'kokoro') ||
    'kokoro';

  if (ttsProvider === 'kokoro' || isKokoroVoice(voiceName)) {
    return synthesizeWithKokoro(text, voiceName, speed);
  }

  const cachedBlob = await ttsCache.get(text, voiceName, speed);
  if (cachedBlob) {
    return blobToBase64(cachedBlob);
  }

  const explicitTtsKey =
    typeof window !== 'undefined' ? (appState.get('ttsApiKey') || '').trim() : '';
  const resolvedTtsKey =
    explicitTtsKey ||
    (ttsProvider === 'openai'
      ? (getOpenAIApiKey() || '').trim()
      : (resolveGeminiApiKey() || '').trim());

  // If no API key is configured for the selected cloud TTS provider, immediately fall back to local Kokoro TTS.
  if (!resolvedTtsKey) {
    console.info(`[TTS] No ${ttsProvider} TTS API key configured; using local Kokoro voice (${DEFAULT_KOKORO_VOICE}).`);
    onCloudFallbackListener?.(new Error(`No ${ttsProvider} TTS API key configured`), DEFAULT_KOKORO_VOICE);
    return synthesizeWithKokoro(text, DEFAULT_KOKORO_VOICE, speed);
  }

  const keyMismatch = validateApiKeyForProvider(resolvedTtsKey, ttsProvider, 'TTS');
  if (keyMismatch) {
    console.warn(`[TTS] ${keyMismatch}`);
    if (typeof window !== 'undefined') {
      appState.set('statusMessage', `${keyMismatch} Falling back to local Kokoro voice.`);
    }
    onCloudFallbackListener?.(new Error(keyMismatch), DEFAULT_KOKORO_VOICE);
    return synthesizeWithKokoro(text, DEFAULT_KOKORO_VOICE, speed);
  }

  const maxRetries = 2;
  let delay = 1000;
  let lastCloudError: unknown = null;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      if (i > 0) {
        console.log(`[TTS Cloud] Retry attempt ${i}/${maxRetries} for text: "${text}"...`);
      } else {
        console.log(`[TTS Cloud] Requesting cloud audio generation for text: "${text}"`);
      }

      if (ttsProvider === 'openai') {
        const openAiVoice = isOpenAIVoice(voiceName) ? voiceName : 'alloy';
        const openAiTtsModel =
          (typeof window !== 'undefined' ? appState.get('openaiTtsModel') : '') ||
          DEFAULT_OPENAI_TTS_MODEL;
        const response = await proxiedFetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resolvedTtsKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: openAiTtsModel,
            voice: openAiVoice,
            input: text,
          }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(
            errText
              ? `OpenAI TTS request failed (${response.status}): ${errText}`
              : `OpenAI TTS request failed (${response.status}): ${response.statusText}`,
          );
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        await ttsCache.add(text, voiceName, speed, audioBlob);
        console.log(`[TTS Cloud] Successfully generated and cached audio for: "${text}"`);
        return blobToBase64(audioBlob);
      } else {
        const geminiVoice = isGeminiVoice(voiceName) ? voiceName : 'Aoede';
        const response = await callGeminiGenerateContent(resolvedTtsKey, {
          model:
            (typeof window !== 'undefined' ? appState.get('speechModel') : '') ||
            DEFAULT_SPEECH_MODEL,
          contents: text,
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: geminiVoice },
              },
            },
          },
        });

        const candidate = response.candidates?.[0];
        const data = candidate?.content?.parts?.[0]?.inlineData;

        if (data && data.data) {
          const binaryString = atob(data.data);
          const pcmBytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            pcmBytes[j] = binaryString.charCodeAt(j);
          }

          const wavBlob = pcmToWavBlob(pcmBytes, 24000, 1);
          await ttsCache.add(text, voiceName, speed, wavBlob);
          console.log(`[TTS Cloud] Successfully generated and cached audio for: "${text}"`);
          return blobToBase64(wavBlob);
        }
      }

      throw new Error('No audio data received from API');
    } catch (error) {
      lastCloudError = error;
      console.error(`[TTS Cloud] Error on attempt ${i} for text: "${text}":`, error);
      if (i === maxRetries) {
        break;
      }
      console.warn(`[TTS Cloud] Attempt ${i} failed, retrying...`, error);
      const jitter = Math.random() * 200;
      await new Promise((resolve) => {
        setTimeout(resolve, delay + jitter);
      });
      delay *= 2;
    }
  }

  console.warn(
    `[TTS Cloud] Cloud TTS failed after retries; falling back to local Kokoro voice (${DEFAULT_KOKORO_VOICE}):`,
    lastCloudError,
  );
  if (typeof window !== 'undefined' && lastCloudError) {
    const errText = describeError(lastCloudError, ttsProvider);
    appState.set('statusMessage', `Cloud TTS failed (${errText}). Using local Kokoro voice.`);
  }
  onCloudFallbackListener?.(lastCloudError, DEFAULT_KOKORO_VOICE);
  return synthesizeWithKokoro(text, DEFAULT_KOKORO_VOICE, speed);
}

function pcmToWavBlob(pcmData: Uint8Array, sampleRate: number, numChannels: number): Blob {
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  // "RIFF" chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true); // ChunkSize
  writeString(view, 8, 'WAVE');

  // "fmt " sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
  view.setUint16(32, numChannels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // "data" sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length, true); // Subchunk2Size

  return new Blob([view as any, pcmData as any], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < uint8.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK_SIZE) as any);
  }
  return btoa(binary);
}
