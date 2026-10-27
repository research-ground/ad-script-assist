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

import { DEFAULT_KOKORO_VOICE, isKokoroVoice } from '../core/constants';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

interface KokoroAudioResult {
  pcmBytes: Uint8Array;
  sampleRate: number;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextJobId = 0;
const pendingCalls = new Map<
  number,
  { resolve: (res: { audio: Float32Array; sampleRate: number }) => void; reject: (err: Error) => void }
>();

let directModelPromise: Promise<any> | null = null;
let directQueuePromise: Promise<void> = Promise.resolve();

function resolveKokoroVoice(voiceName: string): string {
  return isKokoroVoice(voiceName) ? voiceName : DEFAULT_KOKORO_VOICE;
}

function float32ToPcm16Bytes(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

function getWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || workerFailed) {
    return null;
  }
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./kokoro_worker.ts', import.meta.url), {
      type: 'module',
      name: 'kokoro-tts',
    });
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      const pending = pendingCalls.get(msg?.id);
      if (!pending) return;
      pendingCalls.delete(msg.id);
      if (msg.type === 'error') {
        pending.reject(new Error(`Kokoro TTS error: ${msg.message}`));
      } else if (msg.type === 'audio') {
        pending.resolve({ audio: msg.audio, sampleRate: msg.sampleRate || 24000 });
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault?.();
      workerFailed = true;
      const err = new Error(`Kokoro worker failed: ${e.message || 'unknown error'}`);
      for (const pending of pendingCalls.values()) {
        pending.reject(err);
      }
      pendingCalls.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

async function generateInMainOrNode(
  text: string,
  voice: string,
  speed: number,
): Promise<{ audio: Float32Array; sampleRate: number }> {
  if (!directModelPromise) {
    directModelPromise = (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      const isNode = typeof window === 'undefined';
      return await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: isNode ? 'cpu' : 'wasm',
      });
    })();
    directModelPromise.catch(() => {
      directModelPromise = null;
    });
  }

  let result!: { audio: Float32Array; sampleRate: number };
  const run = directQueuePromise.then(async () => {
    const tts = await directModelPromise;
    const out = await tts.generate(text, { voice, speed });
    result = {
      audio: new Float32Array(out.audio),
      sampleRate: out.sampling_rate || 24000,
    };
  });
  directQueuePromise = run.catch(() => {});
  await run;
  return result;
}

/**
 * Generates 16-bit mono PCM audio bytes using the local Kokoro-82M model.
 */
export async function generateKokoroPcm(
  text: string,
  voiceName: string = DEFAULT_KOKORO_VOICE,
  speed: number = 1.0,
): Promise<KokoroAudioResult> {
  const voice = resolveKokoroVoice(voiceName);
  const w = getWorker();
  if (w) {
    try {
      const id = ++nextJobId;
      const { audio, sampleRate } = await new Promise<{ audio: Float32Array; sampleRate: number }>(
        (resolve, reject) => {
          pendingCalls.set(id, { resolve, reject });
          w.postMessage({ type: 'generate', id, text, voice, speed });
        },
      );
      return { pcmBytes: float32ToPcm16Bytes(audio), sampleRate };
    } catch (err) {
      console.warn('[KokoroTTS] Worker synthesis failed, trying direct fallback:', err);
    }
  }

  const { audio, sampleRate } = await generateInMainOrNode(text, voice, speed);
  return { pcmBytes: float32ToPcm16Bytes(audio), sampleRate };
}
