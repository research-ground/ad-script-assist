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

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

export const CLI_SCRIPT = 'npx tsx src/cli/index.ts';
const TEST_VIDEO_URL = process.env.TEST_VIDEO_URL || 'https://www.youtube.com/watch?v=W85oD8FEF78';

export let YT_VIDEO = 'W85oD8FEF78';
const match = TEST_VIDEO_URL.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/);
if (match) {
  YT_VIDEO = match[1];
}

export const LOCAL_VIDEO = 'tests/test_data/test_video.mp4';
export function runCliCommand(testDir: string, name: string, args: string, checkFiles: string[], expectedOutput?: RegExp) {
  const safeName = name.split(' ').join('_');
  const outPath = path.join(testDir, `output_${safeName}`);
  
  if (fs.existsSync(outPath)) {
    fs.rmSync(outPath, { recursive: true, force: true });
  }
  
  const cmd = `${CLI_SCRIPT} ${args} -o "${outPath}"`;
  const output = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
  
  // Verify files
  for (const file of checkFiles) {
    const fullPath = path.join(outPath, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Expected file missing: ${file}`);
    } else {
      const stats = fs.statSync(fullPath);
      if (stats.size === 0) {
        throw new Error(`File is empty: ${file}`);
      }
    }
  }

  if (expectedOutput) {
    if (!expectedOutput.test(output)) {
       throw new Error(`Expected output to match ${expectedOutput}`);
    }
  }
}
