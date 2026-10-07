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

import test from 'node:test';
import * as assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {ALL_FORMATS, BufferSource, Input} from 'mediabunny';
import {setupUITest, teardownUITest, uploadLocalVideo} from './ui_test_utils';

const LOCAL_VIDEO = 'tests/test_data/test_video.mp4';
const OUT_DIR = path.resolve('tests/ui/output_mixed_video_export');
const OUT_FILE = path.join(OUT_DIR, 'local_test_video.mp4_mixed.mp4');

/** A 2 s, 48 kHz mono 440 Hz tone as a WAV file, standing in for the AD track. */
function makeToneWav(): Buffer {
  const sampleRate = 48000;
  const samples = sampleRate * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), 44 + i * 2);
  }
  return wav;
}

async function probe(data: Uint8Array) {
  const input = new Input({source: new BufferSource(data), formats: ALL_FORMATS});
  return {
    videoCodec: (await input.getPrimaryVideoTrack())?.codec,
    audioCodec: (await input.getPrimaryAudioTrack())?.codec,
    duration: await input.computeDuration(),
  };
}

test('Export Mixed Video produces an MP4 with the original video and an AAC mix', async () => {
  fs.rmSync(OUT_DIR, {recursive: true, force: true});
  fs.mkdirSync(OUT_DIR, {recursive: true});

  const page = await setupUITest();
  try {
    const cdp = await page.browser().target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: OUT_DIR});

    await uploadLocalVideo(page, LOCAL_VIDEO);
    await page.waitForFunction(() => (window as any).appState.get('videoType') === 'local', {timeout: 15000});

    // Stand in a generated AD track so we don't need an AI key.
    await page.evaluate((wavBase64: string) => {
      const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], {type: 'audio/wav'}));
      (window as any).appState.set('compiledAdTrackUrl', url);
      (window as any).appState.set('isExportEnabled', true);
    }, makeToneWav().toString('base64'));

    await page.locator('main-page >>> top-bar >>> button[aria-label="Export Menu"]').click();
    const exportButton = await page.waitForFunction(() => {
      const topBar = document.querySelector('main-page')?.shadowRoot?.querySelector('top-bar');
      const buttons = [...(topBar?.shadowRoot?.querySelectorAll('button') ?? [])];
      const button = buttons.find((b) => b.textContent?.trim() === 'Export Mixed Video');
      return button && !button.disabled ? button : null;
    }, {timeout: 10000});
    await exportButton.evaluate((b: any) => b.click());

    const deadline = Date.now() + 60000;
    while (!fs.existsSync(OUT_FILE) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(fs.existsSync(OUT_FILE), `Expected download at ${OUT_FILE}`);

    const original = await probe(fs.readFileSync(LOCAL_VIDEO));
    const mixed = await probe(fs.readFileSync(OUT_FILE));
    console.log('original:', original, 'mixed:', mixed);
    assert.strictEqual(mixed.videoCodec, original.videoCodec);
    assert.strictEqual(mixed.audioCodec, 'aac');
    assert.ok(Math.abs(mixed.duration - original.duration) < 0.5, 'duration should match the original');
  } finally {
    await teardownUITest();
  }
});
