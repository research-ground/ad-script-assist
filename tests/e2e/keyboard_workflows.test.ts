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
import path from 'path';
import puppeteer from 'puppeteer';
import 'dotenv/config';
import { setupUITest, teardownUITest } from '../ui/ui_test_utils';

// Helper to press hotkeys easily
async function pressHotkey(page: puppeteer.Page, key: string, modifier: 'Control' | 'Meta' = 'Control') {
  await page.keyboard.down(modifier);
  await page.keyboard.press(key);
  await page.keyboard.up(modifier);
}

// Debug helper to print active element shadow path
async function printActiveElement(page: puppeteer.Page) {
  const activeTree = await page.evaluate(() => {
    const path = [];
    let current: Document | ShadowRoot | Element | null = document;
    while (current) {
      const active = (current as any).activeElement;
      if (!active) break;
      path.push({
        tagName: active.tagName,
        id: active.id,
        ariaLabel: active.getAttribute('aria-label') || '',
        class: active.className
      });
      if (active.shadowRoot) {
        current = active.shadowRoot;
      } else {
        break;
      }
    }
    return path;
  });
  console.log('ACTIVE ELEMENT PATH ON FAILURE:', JSON.stringify(activeTree, null, 2));
}

// Helper to activate focus + Enter using ElementHandle.press
async function keyboardActivate(page: puppeteer.Page, selector: string) {
  try {
    const el = await page.locator(selector).waitHandle();
    await el.focus();
    await new Promise(r => setTimeout(r, 100));
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 800));
  } catch (err) {
    console.error(`Failed to keyboardActivate selector: ${selector}`);
    await printActiveElement(page);
    throw err;
  }
}

async function waitForSettingsModalToClose(page: puppeteer.Page) {
  await page.waitForFunction(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    const dialog = modal?.shadowRoot?.querySelector('dialog');
    return !dialog || !dialog.hasAttribute('open');
  }, { timeout: 5000 });
}

async function waitForAddVideoModalToClose(page: puppeteer.Page) {
  await page.waitForFunction(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('add-video-modal');
    const dialog = modal?.shadowRoot?.querySelector('dialog');
    return !dialog || !dialog.hasAttribute('open');
  }, { timeout: 5000 });
}

// Helper to wait for agent response
async function waitForAgentResponse(page: puppeteer.Page) {
  await page.waitForFunction(() => {
    const chat = document.querySelector('main-page')?.shadowRoot?.querySelector('agent-chat');
    return chat && !(chat as any).isResponding;
  }, { timeout: 120000 });
}

// Helper to wait for AD speech generation to complete
async function waitForSpeechGeneration(page: puppeteer.Page) {
  await page.waitForFunction(() => {
    const state = (window as any).appState;
    if (!state || state.get('isAdAudioGenerating')) return false;
    const segs = (state.get('adSegments') || []).filter((s: any) => s.script && s.script.trim().length > 0);
    return segs.every((s: any) => Boolean(s.audioData) || Boolean(s.generationFailed));
  }, { timeout: 120000 });
}

async function getSegmentsSummary(page: puppeteer.Page): Promise<string> {
  return page.evaluate(() => {
    const segs = (window as any).appState?.get('adSegments') || [];
    return segs.map((s: any) => s.script).join('\n');
  });
}

// Helper to clear localStorage and clean state
async function clearAppState(page: puppeteer.Page) {
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle0' });
}

const geminiKey = process.env.GEMINI_API_KEY || 'mock_gemini_key';
const openaiKey = process.env.OPENAI_API_KEY || 'mock_openai_key';

test('Workflow 1: Local file + Gemini (Keyboard navigation)', async (t) => {
  const page = await setupUITest();
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  try {
    await clearAppState(page);

    console.log('1. Setting up API Key in Settings');
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Settings"]');
    await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });

    const apiKeyInput = await page.locator('main-page >>> settings-modal >>> #api-key-input').waitHandle();
    await apiKeyInput.type(geminiKey);

    await keyboardActivate(page, 'main-page >>> settings-modal >>> #save-button');
    await waitForSettingsModalToClose(page);
    console.log('✅ Settings saved');

    console.log('2. Loading Local Video');
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Add Video"]');
    try {
      await page.waitForSelector('main-page >>> add-video-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    } catch (e) {
      await printActiveElement(page);
      throw e;
    }

    const fileInput = await page.locator('main-page >>> add-video-modal >>> input[type="file"]').waitHandle();
    const videoPath = path.resolve(process.cwd(), 'tests/test_data/test_video.mp4');
    await fileInput.uploadFile(videoPath);
    await fileInput.evaluate((b: any) => b.dispatchEvent(new Event('change', { bubbles: true })));

    await waitForAddVideoModalToClose(page);
    await page.waitForSelector('main-page >>> video-player', { timeout: 15000 });
    console.log('✅ Video loaded');

    console.log('3. Generating AD via Hotkey');
    await pressHotkey(page, 'm'); // ctrl+m to generate
    await new Promise(r => setTimeout(r, 1000));
    await waitForAgentResponse(page);
    console.log('✅ AD script generated');

    const script = await page.evaluate(() => {
      const adTextArea = document.querySelector('main-page')?.shadowRoot?.querySelector('ad-text-area');
      return (adTextArea as any)?.value || '';
    });
    assert.ok(script.includes('WEBVTT'), 'Generated script must contain WEBVTT');

    console.log('4. Asking visual QA');
    await pressHotkey(page, '4'); // ctrl+4 to focus chat
    await page.keyboard.type('Is there a person in this video?');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1000));
    await waitForAgentResponse(page);
    console.log('✅ Visual QA finished');

    const lastMessage = await page.evaluate(() => {
      const chat = document.querySelector('main-page')?.shadowRoot?.querySelector('agent-chat');
      const messages = chat?.shadowRoot?.querySelectorAll('.agent-message');
      return messages && messages.length > 0 ? messages[messages.length - 1].textContent : '';
    });
    assert.ok(lastMessage && lastMessage.length > 0, 'QA response must not be empty');

    console.log('5. Editing AD script via keyboard');
    await pressHotkey(page, '5'); // ctrl+5 to focus editor
    // Clear and type new script
    await page.keyboard.down('Meta');
    await page.keyboard.press('A');
    await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nKeyboard Edit Test.\n');
    await pressHotkey(page, '4'); // focus out to blur and sync
    await new Promise(r => setTimeout(r, 1000));

    console.log('6. Verifying parsed segments');
    const segsText = await getSegmentsSummary(page);
    assert.ok(segsText.includes('Keyboard Edit Test.'), 'Segments must reflect the edited segment');
    await waitForSpeechGeneration(page);

    console.log('7. Playing audio and checking events');
    await pressHotkey(page, '1'); // ctrl+1 to play
    await new Promise(r => setTimeout(r, 1500));
    
    const time = await page.evaluate(() => {
      return (window as any).appState.get('currentTime');
    });
    assert.ok(time > 0, 'Video playback currentTime must advance');
    
    await pressHotkey(page, '1'); // ctrl+1 to pause

    console.log('8. Exporting artifacts');
    // Export WebVTT
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Export Menu"]');
    await page.evaluate(() => {
      const topBar = document.querySelector('main-page')?.shadowRoot?.querySelector('top-bar');
      const btn = Array.from(topBar?.shadowRoot?.querySelectorAll('.dropdown-menu button') || [])
        .find(b => b.textContent?.includes('WebVTT')) as HTMLButtonElement;
      btn?.focus();
    });
    await page.keyboard.press('Enter');
    console.log('✅ WebVTT exported');

    // Export Audio
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Export Menu"]');
    await page.evaluate(() => {
      const topBar = document.querySelector('main-page')?.shadowRoot?.querySelector('top-bar');
      const btn = Array.from(topBar?.shadowRoot?.querySelectorAll('.dropdown-menu button') || [])
        .find(b => b.textContent?.includes('Audio')) as HTMLButtonElement;
      btn?.focus();
    });
    await page.keyboard.press('Enter');
    console.log('✅ Audio exported');

    // Export Mixed Video
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Export Menu"]');
    await page.evaluate(() => {
      const topBar = document.querySelector('main-page')?.shadowRoot?.querySelector('top-bar');
      const btn = Array.from(topBar?.shadowRoot?.querySelectorAll('.dropdown-menu button') || [])
        .find(b => b.textContent?.includes('Video')) as HTMLButtonElement;
      btn?.focus();
    });
    await page.keyboard.press('Enter');
    console.log('✅ Video exported');

    console.log('✅ Workflow 1 Passed!');
  } finally {
    await teardownUITest();
  }
});

test('Workflow 2: Local file + ChatGPT (Keyboard navigation)', async (t) => {
  const page = await setupUITest();
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  try {
    await clearAppState(page);

    console.log('1. Setting up ChatGPT Provider and Key');
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Settings"]');
    await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });

    // Select OpenAI provider
    await page.evaluate(() => {
      const select = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot?.querySelector('#provider-select') as HTMLSelectElement;
      select.value = 'openai';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const openaiInput = await page.locator('main-page >>> settings-modal >>> #api-key-input').waitHandle();
    await openaiInput.type(openaiKey);

    await keyboardActivate(page, 'main-page >>> settings-modal >>> #save-button');
    await waitForSettingsModalToClose(page);
    console.log('✅ Settings saved');

    console.log('2. Loading Local Video');
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Add Video"]');
    try {
      await page.waitForSelector('main-page >>> add-video-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    } catch (e) {
      await printActiveElement(page);
      throw e;
    }

    const fileInput = await page.locator('main-page >>> add-video-modal >>> input[type="file"]').waitHandle();
    const videoPath = path.resolve(process.cwd(), 'tests/test_data/test_video.mp4');
    await fileInput.uploadFile(videoPath);
    await fileInput.evaluate((b: any) => b.dispatchEvent(new Event('change', { bubbles: true })));

    await waitForAddVideoModalToClose(page);
    await page.waitForSelector('main-page >>> video-player', { timeout: 15000 });
    console.log('✅ Video loaded');

    console.log('3. Generating AD via Hotkey');
    await pressHotkey(page, 'm');
    await new Promise(r => setTimeout(r, 1000));
    await waitForAgentResponse(page);
    console.log('✅ AD script generated');

    const script = await page.evaluate(() => {
      const adTextArea = document.querySelector('main-page')?.shadowRoot?.querySelector('ad-text-area');
      return (adTextArea as any)?.value || '';
    });
    assert.ok(script.includes('WEBVTT'), 'Generated script must contain WEBVTT');

    console.log('4. Asking visual QA');
    await pressHotkey(page, '4');
    await page.keyboard.type('Is there a person in this video?');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1000));
    await waitForAgentResponse(page);
    console.log('✅ Visual QA finished');

    const lastMessage = await page.evaluate(() => {
      const chat = document.querySelector('main-page')?.shadowRoot?.querySelector('agent-chat');
      const messages = chat?.shadowRoot?.querySelectorAll('.agent-message');
      return messages && messages.length > 0 ? messages[messages.length - 1].textContent : '';
    });
    assert.ok(lastMessage && lastMessage.length > 0, 'QA response must not be empty');

    console.log('5. Editing AD script via keyboard');
    await pressHotkey(page, '5');
    await page.keyboard.down('Meta');
    await page.keyboard.press('A');
    await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nKeyboard ChatGPT Edit.\n');
    await pressHotkey(page, '4');
    await new Promise(r => setTimeout(r, 1000));

    console.log('6. Verifying parsed segments');
    const segsText = await getSegmentsSummary(page);
    assert.ok(segsText.includes('Keyboard ChatGPT Edit.'), 'Segments must reflect the edited segment');
    await waitForSpeechGeneration(page);

    console.log('7. Playing audio and checking events');
    await pressHotkey(page, '1');
    await new Promise(r => setTimeout(r, 1500));
    
    const time = await page.evaluate(() => {
      return (window as any).appState.get('currentTime');
    });
    assert.ok(time > 0, 'Video playback currentTime must advance');
    
    await pressHotkey(page, '1');

    console.log('✅ Workflow 2 Passed!');
  } finally {
    await teardownUITest();
  }
});

test('Workflow 3: YouTube + Gemini (Keyboard navigation)', async (t) => {
  const page = await setupUITest();
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  try {
    await clearAppState(page);

    console.log('1. Setting up API Key in Settings');
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Settings"]');
    await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });

    const apiKeyInput = await page.locator('main-page >>> settings-modal >>> #api-key-input').waitHandle();
    await apiKeyInput.type(geminiKey);

    await keyboardActivate(page, 'main-page >>> settings-modal >>> #save-button');
    await waitForSettingsModalToClose(page);
    console.log('✅ Settings saved');

    console.log('2. Loading YouTube Video');
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Add Video"]');
    try {
      await page.waitForSelector('main-page >>> add-video-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    } catch (e) {
      await printActiveElement(page);
      throw e;
    }

    const urlInput = await page.locator('main-page >>> add-video-modal >>> input[type="text"]').waitHandle();
    await urlInput.type('https://www.youtube.com/watch?v=W85oD8FEF78');
    await urlInput.press('Enter');

    await waitForAddVideoModalToClose(page);
    await page.waitForSelector('main-page >>> video-player', { timeout: 15000 });
    console.log('✅ YouTube Video loaded');

    console.log('3. Generating AD via Hotkey');
    await pressHotkey(page, 'm');
    await new Promise(r => setTimeout(r, 1000));
    await waitForAgentResponse(page);
    console.log('✅ AD script generated');

    const script = await page.evaluate(() => {
      const adTextArea = document.querySelector('main-page')?.shadowRoot?.querySelector('ad-text-area');
      return (adTextArea as any)?.value || '';
    });
    assert.ok(script.includes('WEBVTT'), 'Generated script must contain WEBVTT');

    console.log('4. Asking visual QA');
    await pressHotkey(page, '4');
    await page.keyboard.type('Is there a person in this video?');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1000));
    await waitForAgentResponse(page);
    console.log('✅ Visual QA finished');

    console.log('5. Editing AD script');
    await pressHotkey(page, '5');
    await page.keyboard.down('Meta');
    await page.keyboard.press('A');
    await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nKeyboard YouTube Edit.\n');
    await pressHotkey(page, '4');
    await new Promise(r => setTimeout(r, 1000));

    console.log('6. Verifying parsed segments');
    const segsText = await getSegmentsSummary(page);
    assert.ok(segsText.includes('Keyboard YouTube Edit.'), 'Segments must reflect the edited segment');

    console.log('✅ Workflow 3 Passed!');
  } finally {
    await teardownUITest();
  }
});

test('Workflow 4: Reload test (YT + Gemini only) (Keyboard navigation)', async (t) => {
  const page = await setupUITest();
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  try {
    await clearAppState(page);

    console.log('1. Setting up API Key and loading YouTube Video');
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Settings"]');
    await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    const apiKeyInput = await page.locator('main-page >>> settings-modal >>> #api-key-input').waitHandle();
    await apiKeyInput.type(geminiKey);
    await keyboardActivate(page, 'main-page >>> settings-modal >>> #save-button');
    await waitForSettingsModalToClose(page);

    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Add Video"]');
    try {
      await page.waitForSelector('main-page >>> add-video-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    } catch (e) {
      await printActiveElement(page);
      throw e;
    }
    const urlInput = await page.locator('main-page >>> add-video-modal >>> input[type="text"]').waitHandle();
    await urlInput.type('https://www.youtube.com/watch?v=W85oD8FEF78');
    await urlInput.press('Enter');
    await waitForAddVideoModalToClose(page);
    await page.waitForSelector('main-page >>> video-player', { timeout: 15000 });

    console.log('2. Generating AD');
    await pressHotkey(page, 'm');
    await new Promise(r => setTimeout(r, 1000));
    await waitForAgentResponse(page);

    // Edit script text so it is unique and we can verify it persisted
    await pressHotkey(page, '5');
    await page.keyboard.down('Meta');
    await page.keyboard.press('A');
    await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('WEBVTT\n\n00:00:02.000 --> 00:00:06.000\nReload Persistence Test.\n');
    await pressHotkey(page, '4');
    await new Promise(r => setTimeout(r, 1500)); // wait for db save

    console.log('3. Reloading page');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('main-page >>> video-player', { timeout: 15000 });

    console.log('4. Verifying loaded state after reload');
    const loadedVideoId = await page.evaluate(() => (window as any).appState.get('currentVideoId'));
    assert.ok(loadedVideoId && loadedVideoId.length > 0, 'Video must still be loaded');

    const editorText = await page.evaluate(() => {
      const adTextArea = document.querySelector('main-page')?.shadowRoot?.querySelector('ad-text-area');
      return (adTextArea as any)?.value || '';
    });
    assert.ok(editorText.includes('Reload Persistence Test.'), 'Script must persist after reload');

    // Verify segments loaded after reload
    const segsText = await getSegmentsSummary(page);
    assert.ok(segsText.includes('Reload Persistence Test.'), 'Segments must load correctly after reload');
    await waitForSpeechGeneration(page);

    // Playback verification
    await pressHotkey(page, '1');
    await new Promise(r => setTimeout(r, 1500));
    const time = await page.evaluate(() => (window as any).appState.get('currentTime'));
    assert.ok(time > 0, 'Video must play after reload');
    await pressHotkey(page, '1');

    console.log('✅ Workflow 4 Passed!');
  } finally {
    await teardownUITest();
  }
});

test('Workflow 5: Script editing test (YT + Gemini only) (Keyboard navigation)', async (t) => {
  const page = await setupUITest();
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  try {
    await clearAppState(page);

    console.log('1. Setting up API Key and loading YouTube Video');
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Settings"]');
    await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    const apiKeyInput = await page.locator('main-page >>> settings-modal >>> #api-key-input').waitHandle();
    await apiKeyInput.type(geminiKey);
    await keyboardActivate(page, 'main-page >>> settings-modal >>> #save-button');
    await waitForSettingsModalToClose(page);

    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Add Video"]');
    try {
      await page.waitForSelector('main-page >>> add-video-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    } catch (e) {
      await printActiveElement(page);
      throw e;
    }
    const urlInput = await page.locator('main-page >>> add-video-modal >>> input[type="text"]').waitHandle();
    await urlInput.type('https://www.youtube.com/watch?v=W85oD8FEF78');
    await urlInput.press('Enter');
    await waitForAddVideoModalToClose(page);
    await page.waitForSelector('main-page >>> video-player', { timeout: 15000 });

    console.log('2. Editing script: inserting initial WebVTT');
    await pressHotkey(page, '5');
    await page.keyboard.down('Meta');
    await page.keyboard.press('A');
    await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nLine 1\n\n00:00:06.000 --> 00:00:10.000\nLine 2\n');
    await pressHotkey(page, '4'); // blur to sync
    await new Promise(r => setTimeout(r, 1000));

    let segsText = await getSegmentsSummary(page);
    assert.ok(segsText.includes('Line 1') && segsText.includes('Line 2'), 'Must show 2 segments');

    console.log('4. Editing script: adding Line 3 at the end');
    await pressHotkey(page, '5');
    // Move to end of file and type
    await page.keyboard.down('Meta');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Meta');
    await page.keyboard.type('\n00:00:11.000 --> 00:00:15.000\nLine 3\n');
    await pressHotkey(page, '4'); // blur
    await new Promise(r => setTimeout(r, 1000));

    segsText = await getSegmentsSummary(page);
    assert.ok(segsText.includes('Line 3'), 'Must show Line 3');

    console.log('5. Editing script: modifying Line 2 text');
    await pressHotkey(page, '5');
    // Move up to Line 2 line, delete text, type Line 2 Edited
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Home');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('Line 2 Edited');
    await pressHotkey(page, '4'); // blur
    await new Promise(r => setTimeout(r, 1000));

    segsText = await getSegmentsSummary(page);
    assert.ok(segsText.includes('Line 2 Edited'), 'Must show Line 2 Edited');

    console.log('6. Editing script: breaking syntax of Line 1');
    await pressHotkey(page, '5');
    // Move up to Line 1 timestamp, break it
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Home');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('00:00:01.000'); // missing end time and -->
    await pressHotkey(page, '4'); // blur
    await new Promise(r => setTimeout(r, 1000));

    segsText = await getSegmentsSummary(page);
    assert.ok(!segsText.includes('Line 1'), 'Line 1 must be removed from segments list due to syntax error');
    assert.ok(segsText.includes('Line 2 Edited') && segsText.includes('Line 3'), 'Other segments must remain');

    console.log('✅ Workflow 5 Passed!');
  } finally {
    await teardownUITest();
  }
});

test('Workflow 6: Keyboard focus test (YT + Gemini only) (Keyboard navigation)', async (t) => {
  const page = await setupUITest();
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  try {
    await clearAppState(page);

    console.log('1. Setting up API Key and loading YouTube Video');
    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Settings"]');
    await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    const apiKeyInput = await page.locator('main-page >>> settings-modal >>> #api-key-input').waitHandle();
    await apiKeyInput.type(geminiKey);
    await keyboardActivate(page, 'main-page >>> settings-modal >>> #save-button');
    await waitForSettingsModalToClose(page);

    await keyboardActivate(page, 'main-page >>> top-bar >>> button[aria-label="Add Video"]');
    try {
      await page.waitForSelector('main-page >>> add-video-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    } catch (e) {
      await printActiveElement(page);
      throw e;
    }
    const urlInput = await page.locator('main-page >>> add-video-modal >>> input[type="text"]').waitHandle();
    await urlInput.type('https://www.youtube.com/watch?v=W85oD8FEF78');
    await urlInput.press('Enter');
    await waitForAddVideoModalToClose(page);
    await page.waitForSelector('main-page >>> video-player', { timeout: 15000 });

    console.log('2. Setting script in editor');
    await pressHotkey(page, '5');
    await page.keyboard.down('Meta');
    await page.keyboard.press('A');
    await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nLine 1 Text.\n\n00:00:06.000 --> 00:00:10.000\nLine 2 Text.\n');
    await pressHotkey(page, '4'); // blur to sync
    await new Promise(r => setTimeout(r, 1000));
    await waitForSpeechGeneration(page);

    console.log('3. Navigating editor cursor');
    await pressHotkey(page, '5'); // focus editor
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    
    const lineBefore = await page.evaluate(() => {
      const adTextArea = document.querySelector('main-page')?.shadowRoot?.querySelector('ad-text-area') as any;
      return adTextArea?.getLineNumber();
    });

    console.log('4. Switching to Chat with Hotkey');
    await pressHotkey(page, '4'); // focus chat input
    const isChatFocused = await page.evaluate(() => {
      const mainPage = document.querySelector('main-page')?.shadowRoot;
      const agentInput = mainPage?.querySelector('agent-input')?.shadowRoot;
      const input = agentInput?.querySelector('input');
      return document.activeElement === document.querySelector('main-page') && agentInput?.activeElement === input;
    });
    assert.ok(isChatFocused, 'Focus must move to chat input');

    console.log('5. Switching back to Editor with Hotkey');
    await pressHotkey(page, '5'); // focus editor
    const lineAfter = await page.evaluate(() => {
      const adTextArea = document.querySelector('main-page')?.shadowRoot?.querySelector('ad-text-area') as any;
      return adTextArea?.getLineNumber();
    });
    assert.strictEqual(lineAfter, lineBefore, 'Focus must arrive on the same line as before');

    console.log('6. Play current segment via ctrl+o');
    await pressHotkey(page, 'o');
    await new Promise(r => setTimeout(r, 500));

    console.log('7. Start/Stop Video with Hotkey and verify focus stays in editor');
    await pressHotkey(page, '1'); // start play
    await new Promise(r => setTimeout(r, 500));
    
    let isEditorStillFocused = await page.evaluate(() => {
      const mainPage = document.querySelector('main-page')?.shadowRoot;
      const adTextArea = mainPage?.querySelector('ad-text-area')?.shadowRoot;
      const textarea = adTextArea?.querySelector('textarea');
      return adTextArea?.activeElement === textarea;
    });
    assert.ok(isEditorStillFocused, 'Focus must remain in editor when starting playback');

    await pressHotkey(page, '1'); // stop play
    await new Promise(r => setTimeout(r, 500));
    
    isEditorStillFocused = await page.evaluate(() => {
      const mainPage = document.querySelector('main-page')?.shadowRoot;
      const adTextArea = mainPage?.querySelector('ad-text-area')?.shadowRoot;
      const textarea = adTextArea?.querySelector('textarea');
      return adTextArea?.activeElement === textarea;
    });
    assert.ok(isEditorStillFocused, 'Focus must remain in editor when pausing playback');

    console.log('✅ Workflow 6 Passed!');
  } finally {
    await teardownUITest();
  }
});
