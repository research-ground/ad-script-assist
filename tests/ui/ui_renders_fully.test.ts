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
import { setupUITest, teardownUITest } from './ui_test_utils';

test('UI Renders Fully', async () => {
  const page = await setupUITest();
  try {
    console.log('--- Verifying UI Elements ---');
    
    // Wait for the main app element
    await page.waitForSelector('main-page', { timeout: 5000 });
    console.log('✅ main-page found');

    // Check for AD Text Area
    await page.waitForSelector('main-page >>> ad-text-area', { timeout: 5000 });
    console.log('✅ ad-text-area found');
    
    // Check for Agent Chat
    await page.waitForSelector('main-page >>> agent-chat', { timeout: 5000 });
    console.log('✅ agent-chat found');

    // Check for Add Video Modal
    await page.waitForSelector('main-page >>> add-video-modal', { timeout: 5000 });
    console.log('✅ add-video-modal found');

    // Check for Video Controls
    await page.waitForSelector('main-page >>> video-controls', { timeout: 5000 });
    console.log('✅ video-controls found');
    
    // Check for Top Bar
    await page.waitForSelector('main-page >>> top-bar', { timeout: 5000 });
    console.log('✅ top-bar found');
  } finally {
    await teardownUITest();
  }
});
