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
import {getAI} from './gemini_client';
import {getOpenAIApiKey} from './openai_client';
import {appState} from '../core/app_state';
import {DEFAULT_SPEECH_MODEL} from '../core/constants';

/**
 * Generates Text-to-Speech audio from the provided text.
 * @param text The text to convert to speech.
 */
export async function generateTTS(
  text: string,
  voiceName: string = 'en-US-Journey-F',
  speed: number = 1.0,
  provider?: string,
): Promise<string> {
  const llmProvider = provider || (typeof window !== 'undefined' ? appState.get('llmProvider') : 'gemini') || 'gemini';

  const cachedBlob = await ttsCache.get(text, voiceName, speed);
  if (cachedBlob) {
    return blobToBase64(cachedBlob);
  }

  const ai = await getAI();
  const maxRetries = 2;
  let delay = 1000;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      if (i > 0) {
        console.log(`[TTS Cloud] Retry attempt ${i}/${maxRetries} for text: "${text}"...`);
      } else {
        console.log(`[TTS Cloud] Requesting cloud audio generation for text: "${text}"`);
      }
      
      if (llmProvider === 'openai') {
        const apiKey = getOpenAIApiKey();
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            voice: 'alloy',
            input: text,
          }),
        });

        if (!response.ok) {
          throw new Error(`OpenAI TTS request failed: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        await ttsCache.add(text, voiceName, speed, audioBlob);
        console.log(`[TTS Cloud] Successfully generated and cached audio for: "${text}"`);
        return blobToBase64(audioBlob);
      } else {
        const ai = await getAI();
        const response = await ai.models.generateContent({
          model: appState.get('speechModel') || DEFAULT_SPEECH_MODEL,
          contents: text,
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
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
      console.error(`[TTS Cloud] Error on attempt ${i} for text: "${text}":`, error);
      if (i === maxRetries) {
        console.error('[TTS Cloud] Final error after all retries:', error);
        throw error;
      }
      console.warn(`[TTS Cloud] Attempt ${i} failed, retrying...`, error);
      const jitter = Math.random() * 200;
      await new Promise((resolve) => {
        setTimeout(resolve, delay + jitter);
      });
      delay *= 2;
    }
  }
  throw new Error('Failed to generate TTS after all retries');
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

function base64ToBlob(base64: string, mimeType = 'audio/wav'): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], {type: mimeType});
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
