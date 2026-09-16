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

import {css} from 'lit';

/** Styles for the SettingsModal component. */
export const styles = css`
  :host {
    display: block;
    font-family: sans-serif;
    color: #333;
  }

  .container {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: 80vh;
    background: white;
    border-radius: 8px;
    overflow: hidden;
    min-width: 600px;
  }

  .header {
    padding: 24px;
    border-bottom: 1px solid #dadce0;
    display: flex;
    justify-content: flex-start;
    gap: 24px;
    align-items: center;
    flex-shrink: 0;
  }

  .header h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 400;
  }

  .actions {
    display: flex;
    gap: 12px;
  }

  .section {
    padding: 24px;
    border-bottom: 1px solid #f1f3f4;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .section h2 {
    margin: 0 0 16px 0;
    font-size: 18px;
    font-weight: 500;
    color: #202124;
  }

  .setting-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .setting-item label {
    font-weight: 500;
    font-size: 14px;
  }

  .setting-item input[type='password'],
  .setting-item input[type='text'] {
    padding: 10px 12px;
    border: 1px solid #dadce0;
    border-radius: 4px;
    font-size: 14px;
    width: 100%;
    box-sizing: border-box;
  }

  .help-text {
    font-size: 12px;
    color: #5f6368;
  }

  .hotkey-list-container {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid #dadce0;
    border-radius: 4px;
    overflow: hidden;
  }

  .hotkey-header {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    padding: 12px 16px;
    background-color: #f8f9fa;
    font-weight: 500;
    font-size: 13px;
    color: #5f6368;
    border-bottom: 1px solid #dadce0;
  }

  .content-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .hotkey-item {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    padding: 12px 16px;
    align-items: center;
    border-bottom: 1px solid #f1f3f4;
    font-size: 14px;
  }

  .hotkey-item:last-child {
    border-bottom: none;
  }

  .hotkey-item.row-changed {
    background-color: #e8f0fe;
  }

  .hotkey-input-keycombo {
    padding: 6px 8px;
    border: 1px solid #dadce0;
    border-radius: 4px;
    font-size: 13px;
    width: 100%;
    box-sizing: border-box;
  }

  .hotkey-default-combo {
    color: #5f6368;
    font-family: monospace;
  }

  .footer {
    padding: 16px 24px;
    border-top: 1px solid #dadce0;
    display: flex;
    justify-content: flex-end;
    background-color: #f8f9fa;
    flex-shrink: 0;
  }

  button {
    padding: 8px 16px;
    border-radius: 4px;
    border: 1px solid #dadce0;
    background-color: white;
    color: #3c4043;
    font-weight: 500;
    font-size: 14px;
    cursor: pointer;
  }

  button:hover {
    background-color: #f1f3f4;
    border-color: #dadce0;
  }

  button.primary {
    background-color: #1a73e8;
    color: white;
    border: 1px solid #1a73e8;
  }

  button.primary:hover {
    background-color: #1765cc;
    box-shadow: 0 1px 2px rgba(60, 64, 67, 0.3);
  }

  button.primary:disabled {
    background-color: #ccc;
    border-color: #ccc;
    cursor: not-allowed;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
    background-color: #f1f3f4;
    color: #3c4043;
    border: 1px solid #f1f3f4;
    box-shadow: none;
  }

  .reset-button {
    font-size: 13px;
    padding: 6px 12px;
  }

  .action-button {
    font-size: 13px;
  }
`;
