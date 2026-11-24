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
import { hasFfmpeg, hasYtDlp } from '../../../../src/cli/video_utils';
import { runCliCommand, YT_VIDEO } from '../../test_utils';

test('WebVTT to AD audio / mixed MP4 (YouTube + Kokoro)', () => {
  // Generates WebVTT and a single pure-Node compiled ad_track.wav, plus
  // mixed_output.mp4 when yt-dlp and ffmpeg are available.
  const expectedFiles =
    hasYtDlp() && hasFfmpeg()
      ? ['script.vtt', 'ad_track.wav', 'mixed_output.mp4']
      : ['script.vtt', 'ad_track.wav'];
  runCliCommand(
    __dirname,
    'youtube_webvtt_to_mp3',
    `-v ${YT_VIDEO} --mix --tts kokoro`,
    expectedFiles,
  );
});
