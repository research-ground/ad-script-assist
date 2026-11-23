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
  await page.waitForSelector('main-page >>> settings-modal >>> #agent-model-input', { timeout: 5000 });
  await page.waitForSelector('main-page >>> settings-modal >>> #language-select', { timeout: 5000 });

  // Change Gemini VLM model
  const agentModelInput = await page.locator('main-page >>> settings-modal >>> #agent-model-input').waitHandle();
  await agentModelInput.evaluate((node) => {
    const el = node as HTMLInputElement;
    el.value = 'gemini-2.5-pro';
    el.dispatchEvent(new Event('input'));
  });

  // Change TTS Engine to Local Kokoro
  const ttsSelect = await page.locator('main-page >>> settings-modal >>> #tts-provider-select').waitHandle();
  await ttsSelect.evaluate((node) => {
    const el = node as HTMLSelectElement;
    el.value = 'kokoro';
    el.dispatchEvent(new Event('change'));
  });

  // Change Language
  const langSelect = await page.locator('main-page >>> settings-modal >>> #language-select').waitHandle();
  await langSelect.evaluate((node) => {
    const el = node as HTMLSelectElement;
    el.value = 'es-ES';
    el.dispatchEvent(new Event('change'));
  });

  // Change Audio Ducking parameters
  const duckVolInput = await page.locator('main-page >>> settings-modal >>> #duck-volume-percent').waitHandle();
  await duckVolInput.evaluate((node) => {
    const el = node as HTMLInputElement;
    el.value = '20';
    el.dispatchEvent(new Event('input'));
  });

  const duckAttackInput = await page.locator('main-page >>> settings-modal >>> #duck-attack-ms').waitHandle();
  await duckAttackInput.evaluate((node) => {
    const el = node as HTMLInputElement;
    el.value = '80';
    el.dispatchEvent(new Event('input'));
  });

  // Change first Hotkey
  const hotkeyInput = await page.locator('main-page >>> settings-modal >>> .hotkey-input-keycombo').waitHandle();
  await hotkeyInput.evaluate((node) => {
    const el = node as HTMLInputElement;
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
  const savedAgentModel = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLInputElement>('#agent-model-input')?.value;
  });
  if (savedAgentModel !== 'gemini-2.5-pro') {
    throw new Error(`Agent model didn't persist! Got: ${savedAgentModel}`);
  }

  const savedTts = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLSelectElement>('#tts-provider-select')?.value;
  });
  if (savedTts !== 'kokoro') throw new Error(`TTS provider didn't persist! Got: ${savedTts}`);

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

  const savedDuckVol = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLInputElement>('#duck-volume-percent')?.value;
  });
  if (savedDuckVol !== '20') throw new Error(`Duck volume didn't persist! Got: ${savedDuckVol}`);

  const savedDuckAttack = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLInputElement>('#duck-attack-ms')?.value;
  });
  if (savedDuckAttack !== '80') throw new Error(`Duck attack didn't persist! Got: ${savedDuckAttack}`);
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
  const resetAgentModel = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLInputElement>('#agent-model-input')?.value;
  });
  if (resetAgentModel !== '') {
    throw new Error(`Agent model didn't reset! Got: ${resetAgentModel}`);
  }

  const resetTts = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLSelectElement>('#tts-provider-select')?.value;
  });
  if (resetTts !== 'gemini' && resetTts !== 'openai') {
    throw new Error(`TTS provider didn't reset! Got: ${resetTts}`);
  }

  const resetLang = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLSelectElement>('#language-select')?.value;
  });
  if (resetLang !== 'en-US') throw new Error(`Language didn't reset! Got: ${resetLang}`);

  const resetDuckVol = await page.evaluate(() => {
    const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal');
    return modal?.shadowRoot?.querySelector<HTMLInputElement>('#duck-volume-percent')?.value;
  });
  if (resetDuckVol !== '35') throw new Error(`Duck volume didn't reset to 35%! Got: ${resetDuckVol}`);
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

test('VLM default models, ChatGPT TTS, key toggle, and missing-key errors', async () => {
  const page = await setupUITest();
  try {
    // 1. Verify Use Case 1: no server key & no user key -> error in chat and Generate AD, and alert in Settings
    await page.evaluate(() => {
      const appState = (window as any).appState;
      appState.set('serverGeminiApiKey', '');
      appState.set('userGeminiApiKey', '');
      appState.set('useCustomGeminiKey', false);
      appState.set('llmProvider', 'gemini');
      appState.set('currentVideoId', 'test_missing_key_vid');
      appState.set('videoType', 'local');
    });
    await new Promise((r) => setTimeout(r, 300));

    // Click Generate AD -> should show error message in Agent Chat log and status bar
    await page.click('main-page >>> top-bar >>> button[aria-label="Generate AD"]');
    await new Promise((r) => setTimeout(r, 300));
    const genErrState = await page.evaluate(() => {
      const log = (window as any).appState.get('conversationLog') || [];
      const status = (window as any).appState.get('statusMessage') || '';
      return { lastMsg: log[log.length - 1]?.message || '', status };
    });
    if (!genErrState.lastMsg.includes('API key') || !genErrState.status.includes('API key')) {
      throw new Error(`Expected missing-key error on Generate AD, got: ${JSON.stringify(genErrState)}`);
    }

    // Talk to Chat -> should also show error message
    const chatInput = await page.locator('main-page >>> agent-input >>> input').waitHandle();
    await chatInput.evaluate((node) => {
      const el = node as HTMLInputElement;
      el.value = 'Describe this scene';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('main-page >>> agent-input >>> #agentSubmitButton');
    await new Promise((r) => setTimeout(r, 300));
    const chatErrState = await page.evaluate(() => {
      const log = (window as any).appState.get('conversationLog') || [];
      return { count: log.length, lastMsg: log[log.length - 1]?.message || '' };
    });
    if (!chatErrState.lastMsg.includes('API key')) {
      throw new Error(`Expected missing-key error on chat submit, got: ${JSON.stringify(chatErrState)}`);
    }

    // Open Settings and verify missing-key alert + default Gemini 4 Hydrogen placeholder + ChatGPT TTS option
    await page.click('main-page >>> top-bar >>> button[aria-label="Settings"]');
    await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    await page.waitForSelector('main-page >>> settings-modal >>> #vlm-api-key-input', { timeout: 5000 });

    const case1Check = await page.evaluate(() => {
      const root = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot;
      const statusEl = root?.querySelector('#vlm-key-status');
      const keyInput = root?.querySelector<HTMLInputElement>('#vlm-api-key-input');
      const modelInput = root?.querySelector<HTMLInputElement>('#agent-model-input');
      const ttsOptions = Array.from(
        root?.querySelectorAll<HTMLOptionElement>('#tts-provider-select option') || [],
      ).map((o) => o.value);
      return {
        statusRole: statusEl?.getAttribute('role'),
        statusText: statusEl?.textContent || '',
        keyInvalid: keyInput?.getAttribute('aria-invalid'),
        geminiPlaceholder: modelInput?.placeholder || '',
        ttsOptions,
      };
    });
    if (case1Check.statusRole !== 'alert' || !case1Check.statusText.includes('No Google Gemini API key')) {
      throw new Error(`Expected alert notice when no key is set, got: ${JSON.stringify(case1Check)}`);
    }
    if (case1Check.keyInvalid !== 'true') {
      throw new Error(`Expected aria-invalid="true" on empty key input, got: ${case1Check.keyInvalid}`);
    }
    if (!case1Check.geminiPlaceholder.includes('gemini-4-hydrogen')) {
      throw new Error(`Expected gemini-4-hydrogen default placeholder, got: ${case1Check.geminiPlaceholder}`);
    }
    if (!case1Check.ttsOptions.includes('openai') || !case1Check.ttsOptions.includes('gemini') || !case1Check.ttsOptions.includes('kokoro')) {
      throw new Error(`Expected gemini, openai, and kokoro TTS options, got: ${JSON.stringify(case1Check.ttsOptions)}`);
    }

    // Switch VLM provider to OpenAI ChatGPT and verify gpt-6-luna default placeholder
    const vlmSelect = await page.locator('main-page >>> settings-modal >>> #provider-select').waitHandle();
    await vlmSelect.evaluate((node) => {
      const el = node as HTMLSelectElement;
      el.value = 'openai';
      el.dispatchEvent(new Event('change'));
    });
    await page.waitForSelector('main-page >>> settings-modal >>> #openai-model-input', { timeout: 5000 });
    const openaiPlaceholder = await page.evaluate(() => {
      const root = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot;
      return root?.querySelector<HTMLInputElement>('#openai-model-input')?.placeholder || '';
    });
    if (!openaiPlaceholder.includes('gpt-6-luna')) {
      throw new Error(`Expected gpt-6-luna default placeholder, got: ${openaiPlaceholder}`);
    }

    // Switch back to Gemini and simulate Use Case 2 & 3 (server key available + toggle)
    await vlmSelect.evaluate((node) => {
      const el = node as HTMLSelectElement;
      el.value = 'gemini';
      el.dispatchEvent(new Event('change'));
    });
    await page.evaluate(() => {
      const appState = (window as any).appState;
      appState.set('serverGeminiApiKey', '__SERVER_KEY:gemini_api_key__');
      const modal = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal') as any;
      modal?.requestUpdate();
    });
    await page.waitForSelector('main-page >>> settings-modal >>> #vlm-key-source-server', { timeout: 5000 });

    const case2Check = await page.evaluate(() => {
      const root = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot;
      const serverRadio = root?.querySelector<HTMLInputElement>('#vlm-key-source-server');
      const customRadio = root?.querySelector<HTMLInputElement>('#vlm-key-source-custom');
      const keyInput = root?.querySelector<HTMLInputElement>('#vlm-api-key-input');
      const statusText = root?.querySelector('#vlm-key-status')?.textContent || '';
      return {
        serverChecked: serverRadio?.checked,
        customChecked: customRadio?.checked,
        hasKeyInput: Boolean(keyInput),
        statusText,
      };
    });
    if (!case2Check.serverChecked || case2Check.customChecked || case2Check.hasKeyInput || !case2Check.statusText.includes('server-provided')) {
      throw new Error(`Expected server-key radio selected and custom input hidden, got: ${JSON.stringify(case2Check)}`);
    }

    // Toggle to "Use your own key" (Use Case 3)
    await page.click('main-page >>> settings-modal >>> #vlm-key-source-custom');
    await page.waitForSelector('main-page >>> settings-modal >>> #vlm-api-key-input', { timeout: 5000 });

    const case3EmptyCheck = await page.evaluate(() => {
      const root = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot;
      const warning = root?.querySelector('#vlm-key-warning');
      const keyInput = root?.querySelector<HTMLInputElement>('#vlm-api-key-input');
      return {
        warningRole: warning?.getAttribute('role'),
        keyInvalid: keyInput?.getAttribute('aria-invalid'),
      };
    });
    if (case3EmptyCheck.warningRole !== 'alert' || case3EmptyCheck.keyInvalid !== 'true') {
      throw new Error(`Expected alert when custom key selected and empty, got: ${JSON.stringify(case3EmptyCheck)}`);
    }

    // Enter a custom key and select OpenAI ChatGPT TTS, then save and verify active key switched
    const keyInputHandle = await page.locator('main-page >>> settings-modal >>> #vlm-api-key-input').waitHandle();
    await keyInputHandle.evaluate((node) => {
      const el = node as HTMLInputElement;
      el.value = 'AIzaSyCustomUserKey12345';
      el.dispatchEvent(new Event('input'));
    });
    const ttsSelect = await page.locator('main-page >>> settings-modal >>> #tts-provider-select').waitHandle();
    await ttsSelect.evaluate((node) => {
      const el = node as HTMLSelectElement;
      el.value = 'openai';
      el.dispatchEvent(new Event('change'));
    });

    await page.click('main-page >>> settings-modal >>> #save-button');
    await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { hidden: true, timeout: 5000 });

    const savedKeyState = await page.evaluate(() => {
      const appState = (window as any).appState;
      return {
        useCustomGeminiKey: appState.get('useCustomGeminiKey'),
        geminiApiKey: appState.get('geminiApiKey'),
        ttsProvider: appState.get('ttsProvider'),
      };
    });
    if (
      !savedKeyState.useCustomGeminiKey ||
      savedKeyState.geminiApiKey !== 'AIzaSyCustomUserKey12345' ||
      savedKeyState.ttsProvider !== 'openai'
    ) {
      throw new Error(`Expected custom Gemini key and OpenAI TTS saved, got: ${JSON.stringify(savedKeyState)}`);
    }
    console.log('✅ All VLM key modes, default models, and ChatGPT TTS verified!');
  } finally {
    await teardownUITest();
  }
});

test('Model probing lists available Gemini and OpenAI models in Settings', async () => {
  const page = await setupUITest();
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('/api/proxy') && req.method() === 'POST') {
        const body = req.postData() || '';
        if (body.includes('generativelanguage.googleapis.com/v1beta/models')) {
          void req.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              models: [
                {
                  name: 'models/gemini-4-hydrogen',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-3.5-pro-probed',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-3.1-flash-tts-preview',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/text-embedding-004',
                  supportedGenerationMethods: ['embedContent'],
                },
              ],
            }),
          });
          return;
        }
        if (body.includes('api.openai.com/v1/models')) {
          void req.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: [
                { id: 'gpt-6-luna', created: 1790000000 },
                { id: 'gpt-6-pro-probed', created: 1790000100 },
                { id: 'tts-1-hd', created: 1700000000 },
                { id: 'whisper-1', created: 1680000000 },
              ],
            }),
          });
          return;
        }
      }
      void req.continue();
    });

    await page.evaluate(() => {
      const appState = (window as any).appState;
      appState.set('serverGeminiApiKey', '__SERVER_KEY:gemini_api_key__');
      appState.set('serverOpenaiApiKey', '__SERVER_KEY:openai_api_key__');
      appState.set('llmProvider', 'gemini');
      appState.set('ttsProvider', 'gemini');
    });

    await page.click('main-page >>> top-bar >>> button[aria-label="Settings"]');
    await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    await page.waitForFunction(() => {
      const root = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot;
      const status = root?.querySelector('#agent-model-input-probe-status')?.textContent || '';
      return status.includes('Found 2 available VLM models');
    }, { timeout: 5000 });

    const geminiProbed = await page.evaluate(() => {
      const root = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot;
      const vlmOpts = Array.from(
        root?.querySelectorAll<HTMLOptionElement>('#agent-model-input-select option') || [],
      ).map((o) => o.value);
      const ttsOpts = Array.from(
        root?.querySelectorAll<HTMLOptionElement>('#speech-model-input-select option') || [],
      ).map((o) => o.value);
      return { vlmOpts, ttsOpts };
    });

    if (
      !geminiProbed.vlmOpts.includes('gemini-4-hydrogen') ||
      !geminiProbed.vlmOpts.includes('gemini-3.5-pro-probed') ||
      geminiProbed.vlmOpts.includes('text-embedding-004') ||
      !geminiProbed.ttsOpts.includes('gemini-3.1-flash-tts-preview')
    ) {
      throw new Error(`Unexpected Gemini probed models: ${JSON.stringify(geminiProbed)}`);
    }

    // Select probed Gemini model from the dropdown and verify synced text input
    const geminiSelect = await page.locator('main-page >>> settings-modal >>> #agent-model-input-select').waitHandle();
    await geminiSelect.evaluate((node) => {
      const el = node as HTMLSelectElement;
      el.value = 'gemini-3.5-pro-probed';
      el.dispatchEvent(new Event('change'));
    });
    const syncedGeminiInput = await page.evaluate(() => {
      const root = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot;
      return root?.querySelector<HTMLInputElement>('#agent-model-input')?.value;
    });
    if (syncedGeminiInput !== 'gemini-3.5-pro-probed') {
      throw new Error(`Expected synced model input to be gemini-3.5-pro-probed, got: ${syncedGeminiInput}`);
    }

    // Switch VLM & TTS to OpenAI ChatGPT and verify probed OpenAI models appear
    const vlmSelect = await page.locator('main-page >>> settings-modal >>> #provider-select').waitHandle();
    await vlmSelect.evaluate((node) => {
      const el = node as HTMLSelectElement;
      el.value = 'openai';
      el.dispatchEvent(new Event('change'));
    });
    const ttsSelect = await page.locator('main-page >>> settings-modal >>> #tts-provider-select').waitHandle();
    await ttsSelect.evaluate((node) => {
      const el = node as HTMLSelectElement;
      el.value = 'openai';
      el.dispatchEvent(new Event('change'));
    });

    await page.waitForFunction(() => {
      const root = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot;
      const status = root?.querySelector('#openai-model-input-probe-status')?.textContent || '';
      return status.includes('Found 2 available VLM models');
    }, { timeout: 5000 });

    const openaiProbed = await page.evaluate(() => {
      const root = document.querySelector('main-page')?.shadowRoot?.querySelector('settings-modal')?.shadowRoot;
      const vlmOpts = Array.from(
        root?.querySelectorAll<HTMLOptionElement>('#openai-model-input-select option') || [],
      ).map((o) => o.value);
      const ttsOpts = Array.from(
        root?.querySelectorAll<HTMLOptionElement>('#openai-tts-model-input-select option') || [],
      ).map((o) => o.value);
      return { vlmOpts, ttsOpts };
    });

    if (
      !openaiProbed.vlmOpts.includes('gpt-6-luna') ||
      !openaiProbed.vlmOpts.includes('gpt-6-pro-probed') ||
      openaiProbed.vlmOpts.includes('whisper-1') ||
      !openaiProbed.ttsOpts.includes('tts-1-hd')
    ) {
      throw new Error(`Unexpected OpenAI probed models: ${JSON.stringify(openaiProbed)}`);
    }

    console.log('✅ Gemini & OpenAI model probing verified!');
  } finally {
    await teardownUITest();
  }
});

test('Accessible error modal appears on 503 Service Unavailable and 429 Quota Exceeded', async () => {
  const page = await setupUITest();
  try {
    let nextStatus = 503;
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('/api/proxy') && req.method() === 'POST') {
        if (nextStatus === 503) {
          void req.respond({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 503,
                status: 'UNAVAILABLE',
                message: 'The model is overloaded. Please try again later.',
              },
            }),
          });
          return;
        }
        if (nextStatus === 429) {
          void req.respond({
            status: 429,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 429,
                status: 'RESOURCE_EXHAUSTED',
                message: 'You exceeded your current quota.',
              },
            }),
          });
          return;
        }
      }
      void req.continue();
    });

    await page.evaluate(() => {
      const appState = (window as any).appState;
      appState.set('serverGeminiApiKey', '__SERVER_KEY:gemini_api_key__');
      appState.set('useCustomGeminiKey', false);
      appState.set('llmProvider', 'gemini');
      appState.set('currentVideoId', 'dQw4w9WgXcQ');
      appState.set('videoType', 'youtube');
    });
    await new Promise((r) => setTimeout(r, 300));

    // 1. Trigger a 503 error via Generate AD
    await page.click('main-page >>> top-bar >>> button[aria-label="Generate AD"]');
    await page.waitForSelector('error-modal >>> dialog[open]', { visible: true, timeout: 5000 });

    const modal503 = await page.evaluate(() => {
      const dialog = document.querySelector('error-modal')?.shadowRoot?.querySelector('dialog');
      const title = dialog?.querySelector('#error-dialog-title')?.textContent || '';
      const details = dialog?.querySelector('#error-dialog-details')?.textContent || '';
      return {
        role: dialog?.getAttribute('role'),
        ariaModal: dialog?.getAttribute('aria-modal'),
        ariaLabelledBy: dialog?.getAttribute('aria-labelledby'),
        ariaDescribedBy: dialog?.getAttribute('aria-describedby'),
        title,
        details,
      };
    });
    if (
      modal503.role !== 'alertdialog' ||
      modal503.ariaModal !== 'true' ||
      modal503.ariaLabelledBy !== 'error-dialog-title' ||
      !modal503.ariaDescribedBy?.includes('error-dialog-summary') ||
      !modal503.title.includes('503') ||
      !modal503.details.includes('503')
    ) {
      throw new Error(`Unexpected 503 error modal attributes/content: ${JSON.stringify(modal503)}`);
    }

    // Dismiss via Escape key
    await page.keyboard.press('Escape');
    await page.waitForSelector('error-modal >>> dialog[open]', { hidden: true, timeout: 5000 });

    // 2. Trigger a 429 quota error via chat and click "Open Settings"
    nextStatus = 429;
    const chatInput = await page.locator('main-page >>> agent-input >>> input').waitHandle();
    await chatInput.evaluate((node) => {
      const el = node as HTMLInputElement;
      el.value = 'Summarize this video';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('main-page >>> agent-input >>> #agentSubmitButton');
    await page.waitForSelector('error-modal >>> dialog[open]', { visible: true, timeout: 5000 });

    const modal429Title = await page.evaluate(() => {
      return (
        document
          .querySelector('error-modal')
          ?.shadowRoot?.querySelector('#error-dialog-title')?.textContent || ''
      );
    });
    if (!modal429Title.toLowerCase().includes('quota')) {
      throw new Error(`Expected quota error modal title, got: ${modal429Title}`);
    }

    await page.click('error-modal >>> #error-open-settings-button');
    await page.waitForSelector('error-modal >>> dialog[open]', { hidden: true, timeout: 5000 });
    await page.waitForSelector('main-page >>> settings-modal >>> dialog[open]', { visible: true, timeout: 5000 });
    console.log('✅ Accessible 503 & 429 error modals verified!');
  } finally {
    await teardownUITest();
  }
});
