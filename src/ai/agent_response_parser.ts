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

import {isAgentResponse, AgentResponse} from '../core/types';

/**
 * Robustly parses a JSON string from a model response.
 */
export function parseAgentResponse(response: string): AgentResponse {
  const cleanedResponse = response
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/g, '') // Strip <think> blocks
    .trim();

  let parsed: unknown = null;

  // Try parsing directly (fast path for strict JSON mode)
  try {
    const directParsed = JSON.parse(cleanedResponse);
    parsed = typeof directParsed === 'string'
      ? JSON.parse(directParsed)
      : directParsed;
  } catch {
    // Fallback: extract from markdown blocks or braces
    const match =
      cleanedResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
      cleanedResponse.match(/\{[\s\S]*\}/);

    if (match) {
      try {
        const fallbackParsed = JSON.parse(match[1] || match[0]);
        parsed = typeof fallbackParsed === 'string'
          ? JSON.parse(fallbackParsed)
          : fallbackParsed;
      } catch (e) {
        console.error('parseAgentResponse: Fallback parse failed', e);
      }
    }
  }

  if (!parsed) {
    console.error(
      'parseAgentResponse: All parsing attempts failed on:',
      cleanedResponse,
    );
    throw new Error('Failed to parse Agent JSON response');
  }

  const raw = parsed as Record<string, unknown>;
  const normalizedResponse: AgentResponse = {
    response: String(raw['response'] || raw['textResponse'] || raw['text_response'] || ''),
    timestamp: Number(raw['timestamp'] || raw['newTimestamp'] || raw['newTimeStamp'] || raw['new_timestamp'] || 0),
    script:
      raw['script'] !== undefined
        ? String(raw['script'])
        : raw['newScript'] !== undefined
          ? String(raw['newScript'])
          : undefined,
    line: Number(raw['line'] || raw['adLineNumber'] || raw['ad_line_number'] || 0),
  };

  if (!isAgentResponse(normalizedResponse)) {
    console.error(
      'parseAgentResponse: Normalized response does not match AgentResponse schema',
      {normalizedResponse, original: raw},
    );
    throw new Error('Parsed response does not conform to AgentResponse');
  }

  return normalizedResponse;
}
