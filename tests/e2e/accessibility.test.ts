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
import 'dotenv/config';
import { setupUITest, teardownUITest } from '../ui/ui_test_utils';

test('Accessibility: All controls are reachable via Tab key', async (t) => {
  const page = await setupUITest();
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  
  try {
    // 1. Wait for page to load
    await page.waitForSelector('main-page', { visible: true, timeout: 5000 });

    // Mock a loaded video and VLM API key so that all controls become enabled
    await page.evaluate(() => {
      (window as any).appState.set('geminiApiKey', 'test_key');
      (window as any).appState.set('currentVideoId', 'test_vid');
      (window as any).appState.set('videoType', 'local');
    });
    
    // Wait for UI to update
    await new Promise(r => setTimeout(r, 1000));

    // We want to capture the aria-label, id, or class of every element that gets focus by pressing Tab.
    const focusedElements = new Set<string>();

    // Press Tab 50 times (more than enough to cycle through the main screen)
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Tab');
      // small delay to allow focus to settle
      await new Promise(r => setTimeout(r, 50));
      
      const activeInfo = await page.evaluate(() => {
        let current: Document | ShadowRoot | Element | null = document;
        let activeEl: Element | null = null;
        
        while (current) {
          const active = (current as any).activeElement;
          if (!active || active === current || active === document.body) break;
          activeEl = active;
          if (active.shadowRoot) {
            current = active.shadowRoot;
          } else {
            break;
          }
        }
        
        if (!activeEl) return null;
        
        // Return a recognizable string for the element
        const ariaLabel = activeEl.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel;
        
        const id = activeEl.id;
        if (id) return id;
        
        if (activeEl.classList.contains('cm-content')) return 'CodeMirror Editor';
        
        const tagName = activeEl.tagName.toLowerCase();
        let parentTag = '';
        if (activeEl.getRootNode && activeEl.getRootNode() instanceof ShadowRoot) {
          parentTag = (activeEl.getRootNode() as ShadowRoot).host.tagName.toLowerCase();
        }
        
        return parentTag ? parentTag + ' ' + tagName : tagName;
      });
      
      if (activeInfo) {
        focusedElements.add(activeInfo);
      }
    }
    
    console.log('Elements reached via Tab:', Array.from(focusedElements));
    
    // Assert Top Bar controls
    assert.ok(focusedElements.has('Add Video'), 'Add Video button should be reachable via Tab');
    assert.ok(focusedElements.has('Settings'), 'Settings button should be reachable via Tab');
    assert.ok(focusedElements.has('Help'), 'Help button should be reachable via Tab');
    assert.ok(focusedElements.has('Export Menu'), 'Export Menu button should be reachable via Tab');
    assert.ok(focusedElements.has('Clear Project'), 'Clear Project button should be reachable via Tab');
    
    // Assert Video Controls
    assert.ok(focusedElements.has('Play or pause video'), 'Play/Pause button should be reachable via Tab');
    assert.ok(focusedElements.has('speakToggle'), 'Play Audio Description toggle should be reachable via Tab');
    assert.ok(focusedElements.has('Generate AD'), 'Generate AD button should be reachable via Tab');
    
    // Assert Editor and Chat
    assert.ok(focusedElements.has('Agent Command Input'), 'Agent chat input should be reachable via Tab');
    assert.ok(focusedElements.has('Ad Text Editor') || focusedElements.has('CodeMirror Editor'), 'AD Script Editor should be reachable via Tab');
    
    console.log('✅ All main controls are reachable via keyboard Tab navigation!');
    
  } finally {
    await teardownUITest();
  }
});
