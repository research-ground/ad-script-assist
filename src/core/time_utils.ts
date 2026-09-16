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
 * @fileoverview Shared time formatting utilities.
 */

/**
 * Formats seconds into MM:SS for display in video overlays.
 * @param seconds The time in seconds.
 * @return The formatted string (e.g., "01:23").
 */
export function formatTimeForOverlay(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${secs}`;
}

/**
 * Formats seconds into a human-readable string for screen readers.
 * @param seconds The time in seconds.
 * @return The formatted string (e.g., "1 minutes 23 seconds").
 */
export function formatTimeForScreenReader(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes} minutes ${remainingSeconds} seconds`;
}

/**
 * Formats seconds into HH:MM:SS for VTT/AD script display.
 * @param totalSeconds The time in seconds.
 * @return The formatted string (e.g., "00:01:23").
 */
export function formatTimeForVtt(totalSeconds: number): string {
  const date = new Date(totalSeconds * 1000);
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Formats seconds into HH:MM:SS.mmm for full WebVTT compliance.
 * @param totalSeconds The time in seconds.
 * @return The formatted string (e.g., "00:01:23.000").
 */
export function formatTimeForVttFull(totalSeconds: number): string {
  const date = new Date(totalSeconds * 1000);
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Parses a timestamp string into seconds.
 * Supports "MM:SS", "HH:MM:SS", "HH:MM:SS.mmm" formats.
 * @param timeStr The timestamp string.
 * @return The time in seconds, or NaN if invalid.
 */
export function parseTimestampVtt(timeStr: string): number {
  if (!timeStr || !timeStr.trim()) {
    return NaN;
  }

  const parts = timeStr.trim().split(':');
  let seconds = 0;

  if (parts.length === 1) {
    seconds = Number(parts[0]);
  } else if (parts.length === 2) {
    seconds = Number(parts[0]) * 60 + Number(parts[1]);
  } else if (parts.length === 3) {
    seconds =
      Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  } else {
    return NaN;
  }

  return isNaN(seconds) ? NaN : seconds;
}
