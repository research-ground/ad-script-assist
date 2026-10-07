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
import { Page } from 'puppeteer';

async function runPanelsTest(page: Page, useKeyboard: boolean) {
  console.log(`--- Testing Interactions (${useKeyboard ? 'Keyboard' : 'Mouse'}) ---`);
  
  // Helper to click or press enter
  const activate = async (selector: string) => {
    if (useKeyboard) {
      const el = await page.locator(selector).waitHandle();
      await el.focus();
      await page.keyboard.press('Enter');
    } else {
      await page.click(selector);
    }
  };

  // Verify Export Button is disabled initially
  console.log('Verifying Export Button is disabled initially...');
  const isExportDisabled = await page.evaluate(() => {
    const btn = document.querySelector('main-page')?.shadowRoot?.querySelector('top-bar')?.shadowRoot?.querySelector('button[aria-label="Export Menu"]');
    return btn?.hasAttribute('disabled');
  });
  if (!isExportDisabled) throw new Error('Export button should be disabled initially!');
  console.log('✅ Export button is disabled');

  // Add Video Modal
  console.log('Opening Add Video Modal...');
  await activate('main-page >>> top-bar >>> button[aria-label="Add Video"]');
  await page.waitForSelector('main-page >>> add-video-modal >>> .modal', { visible: true, timeout: 5000 });
  console.log('✅ Add Video Modal opened');
  await activate('main-page >>> add-video-modal >>> .close-btn');
  console.log('✅ Add Video Modal closed');

  // Help Modal
  console.log('Opening Help Modal...');
  await activate('main-page >>> top-bar >>> button[aria-label="Help"]');
  await page.waitForSelector('main-page >>> help-modal >>> dialog[open]', { visible: true, timeout: 5000 });
  console.log('✅ Help Modal opened');
  await activate('main-page >>> help-modal >>> .close-button');
  console.log('✅ Help Modal closed');
}

test('UI Panels Work (Mouse)', async () => {
  const page = await setupUITest();
  try {
    await runPanelsTest(page, false);
  } finally {
    await teardownUITest();
  }
});

test('UI Panels Work (Keyboard)', async () => {
  const page = await setupUITest();
  try {
    await runPanelsTest(page, true);
  } finally {
    await teardownUITest();
  }
});
