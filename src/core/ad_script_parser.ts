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

import {parseTimestampVtt} from './time_utils';
import {AdSegment} from './types';

/**
 * Parser for AD scripts.
 */
export class AdScriptParser {
  /**
   * Parses a timestamp string into seconds.
   * Supports "MM:SS", "HH:MM:SS", "HH:MM:SS.mmm" formats.
   */
  parseTimestamp(timeStr: string): number {
    return parseTimestampVtt(timeStr);
  }

  /**
   * Parses the script text into AdSegments.
   */
  parse(scriptText: string, videoId: string): AdSegment[] {
    const segments: AdSegment[] = [];
    if (!scriptText) {
      return segments;
    }
    const scriptBlocks = scriptText.trim().split(/\n\s*\n/);

    for (const block of scriptBlocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 1) continue;

      let timeLine = lines[0];
      let scriptLinesOffset = 1;

      // Handle optional cue identifiers
      if (!timeLine.includes('-->') && lines.length > 1 && lines[1].includes('-->')) {
        timeLine = lines[1];
        scriptLinesOffset = 2;
      }

      // Note: Multi-line descriptions are joined with a space, flattening any
      // intentional line breaks. This is intended to treat the block as a single
      // continuous script segment for TTS generation.
      const script = lines.length > scriptLinesOffset ? lines.slice(scriptLinesOffset).join(' ').trim() : '';

      // Support "-->" delimiter
      let startStr = '';
      let endStr = '';

      if (timeLine.includes('-->')) {
        [startStr, endStr] = timeLine.split('-->');
      }

      if (startStr && endStr) {
        const startTime = this.parseTimestamp(startStr);
        const endTime = this.parseTimestamp(endStr);
        if (!isNaN(startTime) && !isNaN(endTime)) {
          segments.push({
            startTime,
            endTime,
            script,
            changed: false,
            videoId,
          });
        }
      }
    }
    return segments;
  }

  /**
   * Compares old and new segments to identify changes.
   */
  compare(oldSegments: AdSegment[], newSegments: AdSegment[]): AdSegment[] {
    return newSegments.map((newSegment, index) => {
      const oldSegment = oldSegments[index];
      if (
        oldSegment &&
        newSegment.startTime === oldSegment.startTime &&
        newSegment.endTime === oldSegment.endTime &&
        newSegment.script === oldSegment.script &&
        oldSegment.audioData
      ) {
        // Unchanged
        return {
          ...newSegment,
          changed: false,
          audioData: oldSegment.audioData,
          generationFailed: oldSegment.generationFailed,
        };
      } else if (
        oldSegment &&
        newSegment.startTime === oldSegment.startTime &&
        newSegment.endTime === oldSegment.endTime &&
        newSegment.script === oldSegment.script &&
        oldSegment.generationFailed
      ) {
        // Failed before, and script didn't change - don't retry yet
        return {
          ...newSegment,
          changed: false,
          generationFailed: true,
        };
      } else {
        // Changed or new
        return {...newSegment, changed: true};
      }
    });
  }
}

/**
 * Validates that a string is a non-empty, valid WebVTT string.
 */
export function isValidWebVtt(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith('WEBVTT')) {
    return false;
  }

  // Need at least one valid timestamp segment
  const parser = new AdScriptParser();
  const segments = parser.parse(text, 'validation');
  
  // Must have at least one valid segment
  if (segments.length === 0) return false;
  
  // Script must not be empty for segments
  for (const seg of segments) {
    if (!seg.script || seg.script.trim().length === 0) return false;
  }
  
  return true;
}
