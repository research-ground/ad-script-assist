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

import assert from 'node:assert/strict';
import test from 'node:test';
import { createWavHeader } from '../../src/av/audio_utils';
import { compileWavTrack, isWavBuffer, parseWavBuffer } from '../../src/cli/wav_utils';

function makeTestWav(
  samples: number[],
  sampleRate: number,
  numChannels = 1,
): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), i * 2);
  }
  const headerView = createWavHeader(sampleRate, numChannels, 16, pcm.length);
  const header = Buffer.from(
    headerView.buffer,
    headerView.byteOffset,
    headerView.byteLength,
  );
  return Buffer.concat([header, pcm]);
}

test('compileWavTrack places timed segments on a single WAV timeline', () => {
  const sampleRate = 1000;
  // 0.1s clip of +0.5 at t=0.2s, and 0.1s clip of +0.25 at t=0.5s
  const seg1 = makeTestWav(new Array(100).fill(0.5), sampleRate);
  const seg2 = makeTestWav(new Array(100).fill(0.25), sampleRate);

  const compiled = compileWavTrack([
    { wavBuffer: seg1, startTime: 0.2, endTime: 0.3 },
    { wavBuffer: seg2, startTime: 0.5, endTime: 0.8 },
  ]);

  assert.ok(isWavBuffer(compiled));
  const parsed = parseWavBuffer(compiled);
  assert.equal(parsed.sampleRate, sampleRate);
  assert.equal(parsed.numChannels, 1);
  // Total duration should extend to endTime = 0.8s (800 samples)
  assert.equal(parsed.samples.length, 800);

  // Silence before t=0.2s
  assert.equal(parsed.samples[50], 0);
  // First clip at t=0.25s (~0.5)
  assert.ok(Math.abs(parsed.samples[250] - 0.5) < 0.001);
  // Silence between clips at t=0.4s
  assert.equal(parsed.samples[400], 0);
  // Second clip at t=0.55s (~0.25)
  assert.ok(Math.abs(parsed.samples[550] - 0.25) < 0.001);
  // Trailing silence at t=0.75s
  assert.equal(parsed.samples[750], 0);
});

test('compileWavTrack mixes overlapping segments and resamples mismatched rates', () => {
  const seg1 = makeTestWav(new Array(200).fill(0.4), 1000);
  // Same 0.2s duration at 2000 Hz
  const seg2 = makeTestWav(new Array(400).fill(0.3), 2000);

  const compiled = compileWavTrack([
    { wavBuffer: seg1, startTime: 0 },
    { wavBuffer: seg2, startTime: 0.1 },
  ]);

  const parsed = parseWavBuffer(compiled);
  assert.equal(parsed.sampleRate, 1000);
  assert.equal(parsed.samples.length, 300);

  // Only seg1 at t=0.05s
  assert.ok(Math.abs(parsed.samples[50] - 0.4) < 0.002);
  // Overlap of seg1 + seg2 at t=0.15s (~0.7)
  assert.ok(Math.abs(parsed.samples[150] - 0.7) < 0.002);
  // Only seg2 at t=0.25s (~0.3)
  assert.ok(Math.abs(parsed.samples[250] - 0.3) < 0.002);
});
