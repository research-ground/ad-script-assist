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

/**
 * @fileoverview VideoExporter backed by Mediabunny (MPL-2.0).
 *
 * The original video stream is copied without re-encoding. The soundtrack is
 * the original audio plus the AD track, mixed with the Web Audio API and
 * encoded to AAC by the browser's own WebCodecs encoder (no bundled encoder).
 */

import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
} from 'mediabunny';
import type {InputAudioTrack} from 'mediabunny';

import {
  DEFAULT_AUDIO_DUCKING_ENABLED,
  DEFAULT_DUCK_ATTACK_MS,
  DEFAULT_DUCK_HOLD_MS,
  DEFAULT_DUCK_RELEASE_MS,
  DEFAULT_DUCK_VOLUME_PERCENT,
} from '../core/constants';
import type {AudioDuckingOptions, MixedVideoExportRequest, VideoExporter} from './video_exporter';

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const QUALITY = new Quality({bitrate: 192_000});

export class MediabunnyVideoExporter implements VideoExporter {
  readonly fileExtension = 'mp4';

  isSupported(): Promise<boolean> {
    return canEncodeAudio('aac', {numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE, quality: QUALITY});
  }

  async exportMixedVideo({video, adTrack, ducking, onProgress}: MixedVideoExportRequest): Promise<Blob> {
    const input = new Input({source: new BlobSource(video), formats: ALL_FORMATS});
    const output = new Output({format: new Mp4OutputFormat(), target: new BufferTarget()});

    // The conversion copies the video track; we supply the soundtrack ourselves.
    const conversion = await Conversion.init({input, output, audio: {discard: true}, composable: true});
    if (onProgress) conversion.onProgress = onProgress;

    const soundtrack = await mixSoundtrack(input, adTrack, ducking);
    const audioSource = new AudioBufferSource({codec: 'aac', quality: QUALITY});
    output.addAudioTrack(audioSource);

    await output.start();
    await Promise.all([conversion.execute(), audioSource.add(soundtrack).then(() => audioSource.close())]);
    await output.finalize();
    input.dispose();

    return new Blob([output.target.buffer!], {type: 'video/mp4'});
  }
}

/**
 * Detects non-silent AD speech intervals (in seconds) within `adBuffer`,
 * merging adjacent spans separated by less than `mergeGapSec`.
 * @visibleForTesting
 */
export function detectSpeechSpans(
  adBuffer: Pick<AudioBuffer, 'sampleRate' | 'length' | 'numberOfChannels' | 'getChannelData'>,
  mergeGapSec = 0.3,
): Array<{start: number; end: number}> {
  const sr = adBuffer.sampleRate;
  const numFrames = adBuffer.length;
  const numChannels = adBuffer.numberOfChannels;
  if (sr <= 0 || numFrames <= 0 || numChannels <= 0) return [];

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(adBuffer.getChannelData(c));
  }

  const winFrames = Math.max(1, Math.floor(0.02 * sr)); // 20ms analysis window
  const numWins = Math.ceil(numFrames / winFrames);
  const spans: Array<{start: number; end: number}> = [];
  let inSpan = false;
  let startT = 0;

  for (let w = 0; w < numWins; w++) {
    const fStart = w * winFrames;
    const fEnd = Math.min(numFrames, fStart + winFrames);
    let peak = 0;
    for (let c = 0; c < numChannels; c++) {
      const chData = channels[c];
      for (let f = fStart; f < fEnd; f++) {
        const abs = Math.abs(chData[f]);
        if (abs > peak) peak = abs;
      }
    }
    const active = peak > 0.005;
    const t = fStart / sr;
    if (active && !inSpan) {
      inSpan = true;
      startT = t;
    } else if (!active && inSpan) {
      inSpan = false;
      const endT = t;
      if (spans.length > 0 && startT - spans[spans.length - 1].end < mergeGapSec) {
        spans[spans.length - 1].end = endT;
      } else {
        spans.push({start: startT, end: endT});
      }
    }
  }

  if (inSpan) {
    const endT = numFrames / sr;
    if (spans.length > 0 && startT - spans[spans.length - 1].end < mergeGapSec) {
      spans[spans.length - 1].end = endT;
    } else {
      spans.push({start: startT, end: endT});
    }
  }

  return spans;
}

/**
 * Applies a smooth attack/hold/release ducking gain envelope to `bgBuffer` in-place
 * wherever `adBuffer` contains active speech.
 * @visibleForTesting
 */
export function applyDuckingEnvelope(
  bgBuffer: Pick<AudioBuffer, 'sampleRate' | 'length' | 'numberOfChannels' | 'getChannelData'>,
  adBuffer: Pick<AudioBuffer, 'sampleRate' | 'length' | 'numberOfChannels' | 'getChannelData'>,
  options?: AudioDuckingOptions,
): void {
  const enabled = options?.enabled ?? DEFAULT_AUDIO_DUCKING_ENABLED;
  if (!enabled) return;

  const duckVolume = Math.max(
    0,
    Math.min(1, (options?.duckVolumePercent ?? DEFAULT_DUCK_VOLUME_PERCENT) / 100),
  );
  if (duckVolume >= 1) return;

  const attackSec = Math.max(0, (options?.attackMs ?? DEFAULT_DUCK_ATTACK_MS) / 1000);
  const releaseSec = Math.max(0, (options?.releaseMs ?? DEFAULT_DUCK_RELEASE_MS) / 1000);
  const holdSec = Math.max(0, (options?.holdMs ?? DEFAULT_DUCK_HOLD_MS) / 1000);

  const spans = detectSpeechSpans(adBuffer, Math.max(0.3, holdSec));
  if (spans.length === 0) return;

  const sr = bgBuffer.sampleRate;
  const numFrames = bgBuffer.length;
  const env = new Float32Array(numFrames);
  env.fill(1.0);

  const attackFrames = Math.round(attackSec * sr);
  const releaseFrames = Math.round(releaseSec * sr);
  const holdFrames = Math.round(holdSec * sr);

  for (const span of spans) {
    const sIdx = Math.max(0, Math.min(numFrames, Math.round(span.start * sr)));
    const eIdx = Math.max(sIdx, Math.min(numFrames, Math.round(span.end * sr) + holdFrames));

    for (let f = sIdx; f < eIdx; f++) {
      if (duckVolume < env[f]) env[f] = duckVolume;
    }

    if (attackFrames > 0) {
      const aStart = Math.max(0, sIdx - attackFrames);
      const aLen = Math.max(1, sIdx - aStart);
      for (let f = aStart; f < sIdx; f++) {
        const g = 1.0 - (1.0 - duckVolume) * ((f - aStart) / aLen);
        if (g < env[f]) env[f] = g;
      }
    }

    if (releaseFrames > 0) {
      const rEnd = Math.min(numFrames, eIdx + releaseFrames);
      const rLen = Math.max(1, rEnd - eIdx);
      for (let f = eIdx; f < rEnd; f++) {
        const g = duckVolume + (1.0 - duckVolume) * ((f - eIdx) / rLen);
        if (g < env[f]) env[f] = g;
      }
    }
  }

  for (let c = 0; c < bgBuffer.numberOfChannels; c++) {
    const chData = bgBuffer.getChannelData(c);
    for (let f = 0; f < numFrames; f++) {
      chData[f] *= env[f];
    }
  }
}

/** Renders the original audio (if any) and the AD track into one buffer. */
async function mixSoundtrack(
  input: Input,
  adTrack: Blob,
  ducking?: AudioDuckingOptions,
): Promise<AudioBuffer> {
  const duration = await input.computeDuration();
  const ctx = new OfflineAudioContext(CHANNELS, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);

  const adBuffer = await ctx.decodeAudioData(await adTrack.arrayBuffer());
  const audioTrack = await input.getPrimaryAudioTrack();
  if (audioTrack) {
    const bgBuffer = await decodeTrack(audioTrack);
    applyDuckingEnvelope(bgBuffer, adBuffer, ducking);
    play(ctx, bgBuffer);
  }
  play(ctx, adBuffer);

  return ctx.startRendering();
}

function play(ctx: OfflineAudioContext, buffer: AudioBuffer) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
}

/** Decodes an audio track into one AudioBuffer so it's resampled in one piece. */
async function decodeTrack(track: InputAudioTrack): Promise<AudioBuffer> {
  const sampleRate = await track.getSampleRate();
  const numberOfChannels = await track.getNumberOfChannels();
  const length = Math.ceil((await track.computeDuration()) * sampleRate);
  const out = new AudioBuffer({length, sampleRate, numberOfChannels});

  for await (const {buffer, timestamp} of new AudioBufferSink(track).buffers()) {
    const offset = Math.round(timestamp * sampleRate);
    for (let c = 0; c < numberOfChannels; c++) {
      out.copyToChannel(buffer.getChannelData(c).subarray(0, length - offset), c, offset);
    }
  }
  return out;
}
