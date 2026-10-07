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
import puppeteer from 'puppeteer';
import path from 'path';

let previewProcess: any = null;
let browser: puppeteer.Browser | null = null;

// Cleanup preview server process when test runner exits
const cleanupServer = () => {
  if (previewProcess) {
    try {
      process.kill(-previewProcess.pid);
    } catch (e) {}
    previewProcess = null;
  }
};
process.on('exit', cleanupServer);
process.on('SIGINT', () => {
  cleanupServer();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupServer();
  process.exit(0);
});

export async function setupUITest() {
  console.log('--- Building UI ---');
  execSync('npm run build', { stdio: 'inherit' });

  console.log('--- Starting Preview Server ---');
  let serverAlreadyRunning = false;
  try {
    const res = await fetch('http://localhost:5173');
    if (res.ok) {
      serverAlreadyRunning = true;
      console.log('Using existing preview server running on port 5173');
    }
  } catch (e) {}

  if (!serverAlreadyRunning) {
    const { spawn } = require('child_process');
    previewProcess = spawn('npm', ['run', 'preview', '--', '--port', '5173', '--strictPort'], {
      stdio: 'ignore',
      detached: true
    });
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('--- Launching Browser ---');
  browser = await puppeteer.launch({
    headless: 'shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  return page;
}

export async function teardownUITest() {
  if (browser) {
    await browser.close();
    browser = null;
  }
  // The detached preview server otherwise keeps the test process alive.
  cleanupServer();
}

export async function activate(page: puppeteer.Page, selector: string) {
    const el = await page.locator(selector).waitHandle();
    await el.evaluate((e: any) => e.click());
}

export async function uploadLocalVideo(page: puppeteer.Page, relPath: string) {
    const fileInput = await page.locator('main-page >>> add-video-modal >>> input[type="file"]').waitHandle();
    const videoPath = path.resolve(process.cwd(), relPath);
    await fileInput.uploadFile(videoPath);
    await fileInput.evaluate((b: any) => b.dispatchEvent(new Event('change', { bubbles: true })));
}
