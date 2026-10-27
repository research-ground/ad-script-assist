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

import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

env.allowLocalModels = false;
env.useBrowserCache = true;

const IS_PTHREAD = typeof self !== 'undefined' && Boolean((self as unknown as { name?: string }).name?.startsWith('em-pthread'));

let modelPromise: Promise<KokoroTTS> | null = null;

async function hasUsableWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: (opts?: object) => Promise<any> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return false;
    if (adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter) return false;
    return true;
  } catch {
    return false;
  }
}

function getModel(): Promise<KokoroTTS> {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const useWebGpu = await hasUsableWebGpu();
    if (useWebGpu) {
      try {
        return await KokoroTTS.from_pretrained(MODEL_ID, {
          device: 'webgpu',
          dtype: 'fp32',
        });
      } catch (err) {
        console.warn('[KokoroWorker] WebGPU init failed, falling back to WASM q8:', err);
      }
    }
    return await KokoroTTS.from_pretrained(MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
    });
  })();
  modelPromise.catch(() => {
    modelPromise = null;
  });
  return modelPromise;
}

interface GenerateJob {
  id: number;
  text: string;
  voice: string;
  speed: number;
}

const queue: GenerateJob[] = [];
let busy = false;

async function processQueue() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        const tts = await getModel();
        const out = await tts.generate(job.text, {
          voice: job.voice as any,
          speed: job.speed,
        });
        const audio = new Float32Array(out.audio);
        (self as unknown as Worker).postMessage(
          {
            type: 'audio',
            id: job.id,
            audio,
            sampleRate: out.sampling_rate || 24000,
          },
          [audio.buffer],
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        (self as unknown as Worker).postMessage({
          type: 'error',
          id: job.id,
          message,
        });
      }
    }
  } finally {
    busy = false;
  }
}

if (!IS_PTHREAD && typeof self !== 'undefined') {
  self.addEventListener('message', (e: MessageEvent) => {
    const data = e.data;
    if (data?.type === 'generate') {
      queue.push({
        id: data.id,
        text: data.text,
        voice: data.voice || 'af_heart',
        speed: typeof data.speed === 'number' && data.speed > 0 ? data.speed : 1.0,
      });
      void processQueue();
    }
  });
}
