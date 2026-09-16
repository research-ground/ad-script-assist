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
 * Extracts visual frames from a local video file (Blob) in the browser
 * by rendering it to an offscreen canvas at specific time intervals.
 */
export async function extractFramesFromVideoBlob(
  videoBlob: Blob,
  numFrames: number = 10,
): Promise<string[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  
  const objectUrl = URL.createObjectURL(videoBlob);
  video.src = objectUrl;

  try {
    // Wait for video metadata to load so we know the duration
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video metadata'));
    });

    const duration = video.duration;
    if (isNaN(duration) || duration <= 0) {
      throw new Error('Invalid video duration');
    }

    const frames: string[] = [];
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }

    // Capture frames at evenly spaced intervals
    for (let i = 0; i < numFrames; i++) {
      const targetTime = (i / numFrames) * duration;
      video.currentTime = targetTime;
      
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error('Failed to seek video'));
      });

      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64 = dataUrl.split(',')[1];
      if (base64) {
        frames.push(base64);
      }
    }

    return frames;
  } finally {
    // Cleanup
    video.src = '';
    URL.revokeObjectURL(objectUrl);
  }
}
