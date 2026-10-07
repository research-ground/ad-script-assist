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

async function runSettingsTest(page: Page, useKeyboard: boolean) {
  console.log(`--- Testing Settings Persistence (${useKeyboard ? 'Keyboard' : 'Mouse'}) ---`);
  
  const activate = async (selector: string) => {
    if (useKeyboard) {
      const el = await page.locator(selector).waitHandle();
      await el.focus();
      await page.keyboard.press('Enter');
    } else {
      await page.click(selector);
    }
  };

  // Open Settings Modal
  await activate('main-page >>> top-bar >>> button[aria-label="Settings"]');
  await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });
  await page.waitForSelector('main-page >>> settings-modal >>> #language-select', { timeout: 5000 });
  
  // Change API Keys
  const apiKeyInput = await page.locator('main-page >>> settings-modal >>> #api-key-input').waitHandle();
  await apiKeyInput.evaluate((el: HTMLInputElement) => el.value = ''); // clear it
  await apiKeyInput.type('TEST_API_KEY_123');
  
  const openaiApiKeyInput = await page.locator('main-page >>> settings-modal >>> #openai-api-key-input').waitHandle();
  await openaiApiKeyInput.evaluate((el: HTMLInputElement) => el.value = ''); // clear it
  await openaiApiKeyInput.type('TEST_OPENAI_KEY_456');
  
  // Change Language
  const langSelect = await page.locator('main-page >>> settings-modal >>> #language-select').waitHandle();
  await langSelect.evaluate((el: HTMLSelectElement) => {
    el.value = 'es-ES';
    el.dispatchEvent(new Event('change'));
  });
  
  // Change first Hotkey
  const hotkeyInput = await page.locator('main-page >>> settings-modal >>> .hotkey-input-keycombo').waitHandle();
  await hotkeyInput.evaluate((el: HTMLInputElement) => {
    el.value = 'Ctrl+Shift+Z';
    el.dispatchEvent(new Event('input'));
  });
  
  // Save Changes
  await activate('main-page >>> settings-modal >>> #save-button');
  await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { hidden: true, timeout: 5000 });
  console.log('✅ Settings saved and modal closed');
  
  // Reload page
  await page.reload({ waitUntil: 'load' });
  console.log('✅ Page reloaded');
  
  await page.waitForSelector('main-page >>> top-bar', { timeout: 15000 });
  
  // Open Settings Modal again
  await activate('main-page >>> top-bar >>> button[aria-label="Settings"]');
  await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });
  await page.waitForSelector('main-page >>> settings-modal >>> #language-select', { timeout: 5000 });
  
  // Verify changes persisted
  const savedApiKey = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLInputElement>('#api-key-input')?.value;
  });
  if (savedApiKey !== 'TEST_API_KEY_123') throw new Error(`API Key didn't persist! Got: ${savedApiKey}`);
  
  const savedOpenaiKey = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLInputElement>('#openai-api-key-input')?.value;
  });
  if (savedOpenaiKey !== 'TEST_OPENAI_KEY_456') throw new Error(`OpenAI Key didn't persist! Got: ${savedOpenaiKey}`);
  
  const savedLang = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLSelectElement>('#language-select')?.value;
  });
  if (savedLang !== 'es-ES') throw new Error(`Language didn't persist! Got: ${savedLang}`);
  
  const savedHotkey = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLInputElement>('.hotkey-input-keycombo')?.value;
  });
  if (savedHotkey !== 'Ctrl+Shift+Z') throw new Error(`Hotkey didn't persist! Got: ${savedHotkey}`);
  console.log('✅ Settings persisted successfully');
  
  // Reset Settings
  console.log('Testing Settings Reset...');
  if (useKeyboard) {
    const resetBtn = await page.locator('main-page >>> settings-modal >>> #reset-all-button').waitHandle();
    await resetBtn.focus();
    await page.keyboard.press('Enter');
  } else {
    await page.evaluate(() => {
      const btn = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot?.querySelector<HTMLButtonElement>('#reset-all-button');
      btn?.click();
    });
  }
  
  await page.waitForSelector('confirm-modal >>> dialog[open]', { visible: true, timeout: 5000 });
  if (useKeyboard) {
    const confirmBtn = await page.locator('confirm-modal >>> .footer button.destructive').waitHandle();
    await confirmBtn.focus();
    await page.keyboard.press('Enter');
  } else {
    await page.evaluate(() => {
      document.querySelector('confirm-modal')?.shadowRoot?.querySelector<HTMLButtonElement>('.footer button.destructive')?.click();
    });
  }
  // Wait a bit for processing
  await new Promise(r => setTimeout(r, 500));
  
  // Verify default settings
  const resetApiKey = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLInputElement>('#api-key-input')?.value;
  });
  if (resetApiKey !== '') throw new Error(`API Key didn't reset! Got: ${resetApiKey}`);
  
  const resetOpenaiKey = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLInputElement>('#openai-api-key-input')?.value;
  });
  if (resetOpenaiKey !== '') throw new Error(`OpenAI Key didn't reset! Got: ${resetOpenaiKey}`);
  
  const resetLang = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLSelectElement>('#language-select')?.value;
  });
  if (resetLang !== 'en-US') throw new Error(`Language didn't reset! Got: ${resetLang}`);
  console.log('✅ Settings reset successfully');
}

test('UI Settings Persist (Mouse)', async () => {
  const page = await setupUITest();
  try {
    await runSettingsTest(page, false);
  } finally {
    await teardownUITest();
  }
});

test('UI Settings Persist (Keyboard)', async () => {
  const page = await setupUITest();
  try {
    await runSettingsTest(page, true);
  } finally {
    await teardownUITest();
  }
});
