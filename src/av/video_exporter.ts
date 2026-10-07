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
 * @fileoverview Interface for exporting a video with the AD track mixed into
 * its soundtrack. Callers depend only on this file, so the implementation
 * (currently Mediabunny) can be swapped without touching the rest of the app.
 */

/** Inputs for a mixed-video export. */
export interface MixedVideoExportRequest {
  /** The original local video file. */
  video: Blob;
  /** The compiled AD audio track (e.g. from compileADAudioTrack), aligned to t=0. */
  adTrack: Blob;
  /** Called with export progress from 0 to 1. */
  onProgress?: (fraction: number) => void;
}

/** Produces a video file whose soundtrack is the original audio mixed with the AD track. */
export interface VideoExporter {
  /** File extension of the produced file, without the dot (e.g. 'mp4'). */
  readonly fileExtension: string;
  /** Whether this exporter can run in the current browser. */
  isSupported(): Promise<boolean>;
  /** Returns the mixed video file. */
  exportMixedVideo(request: MixedVideoExportRequest): Promise<Blob>;
}

/**
 * Returns the app's video exporter. The implementation is loaded lazily so
 * its dependencies are only downloaded when export is actually used.
 */
export async function getVideoExporter(): Promise<VideoExporter> {
  const {MediabunnyVideoExporter} = await import('./mediabunny_video_exporter');
  return new MediabunnyVideoExporter();
}
