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

import { createWavHeader } from '../av/audio_utils';

export interface ParsedWav {
  samples: Float32Array;
  sampleRate: number;
  numChannels: number;
}

export interface TimedWavSegment {
  wavBuffer: Buffer;
  startTime: number;
  endTime?: number;
}

/** Returns true if the buffer begins with a RIFF/WAVE header. */
export function isWavBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE'
  );
}

/**
 * Parses an uncompressed PCM or IEEE-float WAV buffer into mono Float32 samples
 * in the range [-1, 1]. Pure Node implementation with no external dependencies.
 */
export function parseWavBuffer(buf: Buffer): ParsedWav {
  if (!isWavBuffer(buf)) {
    throw new Error('Input buffer is not a valid RIFF/WAVE file.');
  }

  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkDataStart + 16 <= buf.length) {
      audioFormat = buf.readUInt16LE(chunkDataStart);
      numChannels = buf.readUInt16LE(chunkDataStart + 2);
      sampleRate = buf.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = buf.readUInt16LE(chunkDataStart + 14);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataStart;
      dataLength = Math.min(chunkSize, buf.length - chunkDataStart);
      break;
    }

    // RIFF chunks are padded to even byte boundaries.
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset === -1 || numChannels === 0 || sampleRate === 0 || bitsPerSample === 0) {
    throw new Error('WAV file is missing required fmt or data chunks.');
  }

  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Unsupported WAV audio format: ${audioFormat} (only PCM and IEEE float are supported).`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * numChannels;
  const frameCount = Math.floor(dataLength / frameSize);
  const mono = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    const frameStart = dataOffset + i * frameSize;
    for (let ch = 0; ch < numChannels; ch++) {
      const sampleOffset = frameStart + ch * bytesPerSample;
      let sample = 0;
      if (audioFormat === 3 && bitsPerSample === 32) {
        sample = buf.readFloatLE(sampleOffset);
      } else if (bitsPerSample === 16) {
        sample = buf.readInt16LE(sampleOffset) / 0x8000;
      } else if (bitsPerSample === 8) {
        sample = (buf.readUInt8(sampleOffset) - 128) / 128;
      } else if (bitsPerSample === 24) {
        const b0 = buf.readUInt8(sampleOffset);
        const b1 = buf.readUInt8(sampleOffset + 1);
        const b2 = buf.readInt8(sampleOffset + 2);
        const val = (b2 << 16) | (b1 << 8) | b0;
        sample = val / 0x800000;
      } else if (bitsPerSample === 32) {
        sample = buf.readInt32LE(sampleOffset) / 0x80000000;
      } else {
        throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
      }
      sum += sample;
    }
    mono[i] = sum / numChannels;
  }

  return { samples: mono, sampleRate, numChannels };
}

function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || samples.length === 0) {
    return samples;
  }
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = srcIdx - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/**
 * Compiles multiple timed WAV segments into a single time-aligned mono 16-bit
 * PCM WAV buffer in pure Node (no ffmpeg or browser Web Audio API required).
 */
export function compileWavTrack(segments: TimedWavSegment[]): Buffer {
  if (segments.length === 0) {
    throw new Error('Cannot compile an empty list of WAV segments.');
  }

  const parsed = segments.map((seg) => ({
    ...parseWavBuffer(seg.wavBuffer),
    startTime: Math.max(0, seg.startTime),
    endTime: seg.endTime,
  }));

  const targetSampleRate = parsed[0].sampleRate;
  const resampled = parsed.map((item) => ({
    samples: resampleLinear(item.samples, item.sampleRate, targetSampleRate),
    startTime: item.startTime,
    endTime: item.endTime,
  }));

  let totalSamples = 1;
  const positioned = resampled.map((item) => {
    const startSample = Math.round(item.startTime * targetSampleRate);
    const audioEndSample = startSample + item.samples.length;
    const segEndSample =
      item.endTime !== undefined ? Math.round(item.endTime * targetSampleRate) : 0;
    totalSamples = Math.max(totalSamples, audioEndSample, segEndSample);
    return { samples: item.samples, startSample };
  });

  const mixed = new Float32Array(totalSamples);

  for (const item of positioned) {
    for (let i = 0; i < item.samples.length; i++) {
      const dst = item.startSample + i;
      if (dst >= 0 && dst < totalSamples) {
        mixed[dst] += item.samples[i];
      }
    }
  }

  const pcmBytes = Buffer.allocUnsafe(totalSamples * 2);
  for (let i = 0; i < totalSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, mixed[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    pcmBytes.writeInt16LE(int16, i * 2);
  }

  const headerView = createWavHeader(targetSampleRate, 1, 16, pcmBytes.length);
  const headerBuf = Buffer.from(
    headerView.buffer,
    headerView.byteOffset,
    headerView.byteLength,
  );

  return Buffer.concat([headerBuf, pcmBytes]);
}
