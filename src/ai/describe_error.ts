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

/**
 * @fileoverview Turns API errors into short, human-readable messages.
 */

/**
 * Returns a readable message for an error thrown by an AI client. The Gemini
 * SDK puts a JSON body in `error.message`, e.g.
 * `{"error":{"code":503,"message":"...","status":"UNAVAILABLE"}}`.
 */
export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const body = JSON.parse(raw.slice(raw.indexOf('{')));
    const e = body.error ?? body;
    if (e.message) {
      const code = [e.code, e.status && `(${e.status})`].filter(Boolean).join(' ');
      return code ? `${code}: ${e.message}` : e.message;
    }
  } catch {
    // Not JSON; fall through to the raw message.
  }
  return raw;
}
