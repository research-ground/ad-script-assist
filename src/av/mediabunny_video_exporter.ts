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

import type {MixedVideoExportRequest, VideoExporter} from './video_exporter';

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const QUALITY = new Quality({bitrate: 192_000});

export class MediabunnyVideoExporter implements VideoExporter {
  readonly fileExtension = 'mp4';

  isSupported(): Promise<boolean> {
    return canEncodeAudio('aac', {numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE, quality: QUALITY});
  }

  async exportMixedVideo({video, adTrack, onProgress}: MixedVideoExportRequest): Promise<Blob> {
    const input = new Input({source: new BlobSource(video), formats: ALL_FORMATS});
    const output = new Output({format: new Mp4OutputFormat(), target: new BufferTarget()});

    // The conversion copies the video track; we supply the soundtrack ourselves.
    const conversion = await Conversion.init({input, output, audio: {discard: true}, composable: true});
    if (onProgress) conversion.onProgress = onProgress;

    const soundtrack = await mixSoundtrack(input, adTrack);
    const audioSource = new AudioBufferSource({codec: 'aac', quality: QUALITY});
    output.addAudioTrack(audioSource);

    await output.start();
    await Promise.all([conversion.execute(), audioSource.add(soundtrack).then(() => audioSource.close())]);
    await output.finalize();
    input.dispose();

    return new Blob([output.target.buffer!], {type: 'video/mp4'});
  }
}

/** Renders the original audio (if any) and the AD track into one buffer. */
async function mixSoundtrack(input: Input, adTrack: Blob): Promise<AudioBuffer> {
  const duration = await input.computeDuration();
  const ctx = new OfflineAudioContext(CHANNELS, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);

  const audioTrack = await input.getPrimaryAudioTrack();
  if (audioTrack) play(ctx, await decodeTrack(audioTrack));
  play(ctx, await ctx.decodeAudioData(await adTrack.arrayBuffer()));

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
