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
 * @fileoverview Downloads the shared test video into tests/test_data
 * (gitignored) if it isn't cached already. The video is a public-domain NASA
 * clip (Apollo 11 "Buzz Descends" comparison, ~60 s, H.264 + AAC).
 */

import fs from 'fs';
import path from 'path';

const TEST_DATA_DIR = 'tests/test_data';
const TEST_VIDEO_URL =
  'https://images-assets.nasa.gov/video/Buzz_Descends_Comparison__720p/Buzz_Descends_Comparison__720p~medium.mp4';
const LOCAL_VIDEO = path.join(TEST_DATA_DIR, 'test_video.mp4');

async function setup() {
  if (fs.existsSync(LOCAL_VIDEO)) {
    console.log(`✅ Test video already cached at ${LOCAL_VIDEO}`);
    return;
  }
  console.log(`Downloading test video from ${TEST_VIDEO_URL}...`);
  const res = await fetch(TEST_VIDEO_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  fs.mkdirSync(TEST_DATA_DIR, {recursive: true});
  fs.writeFileSync(LOCAL_VIDEO, Buffer.from(await res.arrayBuffer()));
  console.log(`✅ Test video saved to ${LOCAL_VIDEO}`);
}

setup();
