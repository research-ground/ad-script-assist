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

import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/** Exits with install instructions if ffmpeg isn't on the PATH. */
export function requireFfmpeg(reason: string) {
  if (!spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error) return;
  console.error(`ffmpeg is required ${reason}, but it wasn't found on your PATH.
Install it, then try again:
  macOS:   brew install ffmpeg
  Ubuntu:  sudo apt install ffmpeg
  Windows: winget install ffmpeg
Or use the web app, which doesn't need ffmpeg.`);
  process.exit(1);
}

/**
 * Extracts 10 visual frames from a local video file using ffmpeg.
 * Returns an array of base64-encoded JPEG images.
 */
export function extractFrames(videoPath: string): string[] {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frames-'));
  const outPattern = path.join(outDir, 'frame-%03d.jpg');
  
  try {
    execSync(`ffmpeg -i "${videoPath}" -vf fps=1/10 -vframes 10 -s 640x360 "${outPattern}"`, { stdio: 'ignore' });
    const frames = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg')).sort();
    return frames.map(f => {
      const data = fs.readFileSync(path.join(outDir, f));
      return data.toString('base64');
    });
  } catch (e) {
    console.warn('Failed to extract frames with ffmpeg, trying alternative select filter...', e);
    try {
      execSync(`ffmpeg -i "${videoPath}" -vf "select=not(mod(n\\,100))" -vframes 10 -s 640x360 "${outPattern}"`, { stdio: 'ignore' });
      const frames = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg')).sort();
      return frames.map(f => {
        const data = fs.readFileSync(path.join(outDir, f));
        return data.toString('base64');
      });
    } catch (e2) {
      console.error('Failed to extract frames completely.');
      return [];
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}
