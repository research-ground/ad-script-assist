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


import {AdSegment} from '../core/types';

/** Standard sample rate for audio processing (44.1kHz). */
const SAMPLE_RATE = 44100;
/** Standard channel count for audio processing (Stereo). */
const CHANNEL_COUNT = 2;

/**
 * Creates a WAV file header.
 * @visibleForTesting
 */
export function createWavHeader(
  sampleRate: number,
  numChannels: number,
  bitDepth: number,
  dataLength: number,
): DataView {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const bufferLength = 44; // Header only

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  return view;
}

/**
 * Converts an AudioBuffer to a WAV formatted ArrayBuffer.
 * @visibleForTesting
 */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;

  const headerView = createWavHeader(
    sampleRate,
    numChannels,
    bitDepth,
    dataLength,
  );

  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // Copy header
  new Uint8Array(arrayBuffer).set(new Uint8Array(headerView.buffer));

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = channels[channel][i];
      sample = Math.max(-1, Math.min(1, sample));
      // Convert float to 16-bit PCM
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
  }

  return arrayBuffer;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Creates a blob URL from base64 audio data.
 */
export function createAudioUrlFromBase64(
  base64Data: string,
  mimeType = 'audio/wav',
): string {
  const arrayBuffer = base64ToArrayBuffer(base64Data);
  const blob = new Blob([arrayBuffer], {type: mimeType});
  return URL.createObjectURL(blob);
}

/**
 * Creates a WAV file URL from base64 PCM data.
 */
export async function createWaveFile(base64PcmData: string): Promise<string> {
  // Convert base64 PCM (16-bit mono 24kHz usually from Gemini) to WAV
  const pcmData = base64ToArrayBuffer(base64PcmData);
  const sampleRate = 24000;
  const channels = 1;
  const bitDepth = 16;

  const headerView = createWavHeader(
    sampleRate,
    channels,
    bitDepth,
    pcmData.byteLength,
  );

  const blob = new Blob([headerView.buffer as ArrayBuffer, pcmData], {
    type: 'audio/wav',
  });
  return URL.createObjectURL(blob);
}

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

/**
 * Compiles multiple AD segments into a single WAV file URL.
 */
export async function compileADAudioTrack(
  entries: AdSegment[],
  videoDuration?: number,
): Promise<string | null> {
  console.log(
    `[compileADAudioTrack] Starting with ${entries.length} entries. Video duration: ${videoDuration}`,
  );
  const validEntries = entries
    .filter((entry) => entry.audioData)
    .sort((a, b) => a.startTime - b.startTime);

  console.log(
    `[compileADAudioTrack] Found ${validEntries.length} valid segments with audioData.`,
  );

  if (validEntries.length === 0) {
    console.warn(
      '[compileADAudioTrack] No valid entries with audioData found.',
    );
    return null;
  }

  const audioContext = getAudioContext();
  const buffers: Array<{buffer: AudioBuffer; startTime: number; endTime?: number}> =
    await Promise.all(
      validEntries.map(async (entry) => {
        try {
          console.log(
            `[compileADAudioTrack] Fetching and decoding segment at ${entry.startTime}s...`,
          );
          const response = await fetch(entry.audioData!);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch audio data: ${response.statusText}`,
            );
          }
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          return {
            buffer: audioBuffer,
            startTime: entry.startTime,
            endTime: entry.endTime,
          };
        } catch (err) {
          console.error(
            `[compileADAudioTrack] Error processing segment at ${entry.startTime}s:`,
            err,
          );
          throw err;
        }
      }),
    );

  if (buffers.length === 0) return null;

  // Calculate total duration to cover all segments and gaps.
  // Use max duration from all segments to avoid clipping if a segment starts earlier
  // but ends later than the last started segment.
  const lastSegmentEnd = validEntries.reduce(
    (max, entry) => Math.max(max, entry.endTime || 0),
    0,
  );

  // Ensure we have a valid finite number for duration
  const sanitizedVideoDuration =
    typeof videoDuration === 'number' && isFinite(videoDuration)
      ? videoDuration
      : 0;
  const finalDuration = Math.max(sanitizedVideoDuration, lastSegmentEnd);
  console.log(`[compileADAudioTrack] Final track duration: ${finalDuration}s`);

  const numSamples = Math.max(1, Math.ceil(finalDuration * SAMPLE_RATE));
  console.log(
    `[compileADAudioTrack] Creating OfflineAudioContext for ${numSamples} samples...`,
  );

  const offlineCtx = new OfflineAudioContext(
    CHANNEL_COUNT,
    numSamples,
    SAMPLE_RATE,
  );

  for (const {buffer, startTime, endTime} of buffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    if (endTime !== undefined && endTime > startTime) {
      const slotDuration = endTime - startTime;
      if (buffer.duration > slotDuration && slotDuration > 0.2) {
        source.playbackRate.value = Math.min(1.5, buffer.duration / slotDuration);
      }
    }
    source.connect(offlineCtx.destination);
    source.start(startTime);
  }

  console.log('[compileADAudioTrack] Rendering audio...');
  const startRenderTime = performance.now();
  const renderedBuffer = await offlineCtx.startRendering();
  console.log(
    `[compileADAudioTrack] Rendering complete in ${(performance.now() - startRenderTime).toFixed(2)}ms.`,
  );

  const wavData = audioBufferToWav(renderedBuffer);
  const blob = new Blob([wavData], {type: 'audio/wav'});
  const url = URL.createObjectURL(blob);
  console.log('[compileADAudioTrack] Generated final WAV Blob URL.');
  return url;
}
