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

import {Type} from '@google/genai';
import {instructionsMd} from './instructions';

/**
 * Schema for the user command response.
 */
export const userCommandResponseSchema = {
  'type': Type.OBJECT,
  'properties': {
    'response': {'type': Type.STRING},
    'timestamp': {'type': Type.NUMBER},
    'script': {'type': Type.STRING},
    'line': {'type': Type.NUMBER},
  },
  'required': ['response'],
};

function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

/**
 * Collection of prompts and guidelines for the AI.
 */
export const PROMPTS = {
  /**
   * Command to process user input.
   */
  userCommand(
    command: string,
    conversationHistory: string,
    youtubeURL: string,
    timestamp: string,
    adScriptText: string,
    adScriptLine: number,
    scriptNotes?: string,
  ): string {
    const customScriptNotes = scriptNotes 
      ? `\n# Custom Script Notes / Guidelines\n${scriptNotes}\n` 
      : '';

    return renderTemplate(instructionsMd, {
      command,
      conversationHistory,
      youtubeURL,
      timestamp,
      adScriptLine: String(adScriptLine),
      adScriptText,
      customScriptNotes,
    });
  },
};

