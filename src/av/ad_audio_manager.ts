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

import { AdSegment } from '../core/types';
import { appState } from '../core/app_state';
import { AdGenerator } from '../ai/ad_generator';
import { compileADAudioTrack } from './audio_utils';
import { storeAdSegmentsToDB } from '../web/storage/db';

export class AdAudioManager {
  private adGenerator = AdGenerator.getInstance();
  private audioGenerationPromise: Promise<void> | null = null;
  private hasPendingChange = false;
  private isProcessingAudio = false;

  constructor() {
    appState.subscribe('isAgentResponding', (isResponding) => {
      // When agent finishes, auto-regenerate
      if (!isResponding && appState.get('currentVideoId')) {
        void this.regenerateAdAudio();
      }
    });

    appState.subscribe('videoDuration', async (duration) => {
      if (duration > 0 && appState.get('currentVideoId')) {
        const segments = appState.get('adSegments') || [];
        if (segments.length > 0) {
          const track = await compileADAudioTrack(segments, duration);
          if (track) {
            appState.set('compiledAdTrackUrl', track);
          }
        }
      }
    });
  }

  public regenerateAdAudio(force = false): Promise<void> {
    if (force) {
      const segments = appState.get('adSegments') || [];
      segments.forEach(seg => {
        seg.audioData = undefined;
        seg.generationFailed = false;
        seg.changed = true;
      });
      this.hasPendingChange = true;
    }

    if (this.audioGenerationPromise) {
      this.hasPendingChange = true;
      return this.audioGenerationPromise;
    }

    this.audioGenerationPromise = this.performAudioRegenerationLoop();
    return this.audioGenerationPromise;
  }

  private async performAudioRegenerationLoop() {
    try {
      do {
        this.hasPendingChange = false;
        await this.performAudioRegeneration();
      } while (this.hasPendingChange);
    } finally {
      this.audioGenerationPromise = null;
    }
  }

  private async performAudioRegeneration() {
    const currentVideoId = appState.get('currentVideoId');
    if (!currentVideoId) return;

    this.isProcessingAudio = true;
    appState.set('isAdAudioGenerating', true);
    appState.set('statusMessage', 'Generating audio segments...');
    this.hasPendingChange = false;

    try {
      // Fetch latest segments from appState here to avoid stale closures
      const segments = appState.get('adSegments') || [];
      const workingSegments = [...segments];

      const hasChanges = workingSegments.some(seg => seg.changed || !seg.audioData);
      if (hasChanges) {
        appState.set('compiledAdTrackUrl', null);
      }

      // Process segments in small batches
      const CONCURRENCY_LIMIT = 3;
      for (let i = 0; i < workingSegments.length; i += CONCURRENCY_LIMIT) {
        const batch = workingSegments.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map((seg) => this.generateAudioForSingleSegment(seg)));
      }

      appState.set('adSegments', workingSegments);
      await storeAdSegmentsToDB(currentVideoId, workingSegments);

      // Compile track
      const videoApi = appState.get('videoPlayerApi');
      const duration = videoApi?.duration || 0;
      const newTrack = await compileADAudioTrack(workingSegments, duration);
      
      if (newTrack) {
        appState.set('compiledAdTrackUrl', newTrack);
      }
      
      // Dispatch custom event on window for compatibility with older code, or they can just listen to compiledAdTrackUrl
      window.dispatchEvent(new CustomEvent('ad-audio-updated', {
        detail: { segments: workingSegments, trackUrl: newTrack }
      }));

    } finally {
      this.isProcessingAudio = false;
      appState.set('isAdAudioGenerating', false);
      if (!this.hasPendingChange) {
        appState.set('statusMessage', 'Audio generation complete.');
      }
    }
  }

  private async generateAudioForSingleSegment(seg: AdSegment) {
    if (seg.script.trim().length === 0) {
      return;
    }
    if (!seg.changed && seg.audioData) {
      return;
    }

    try {
      const audioData = await this.adGenerator.generateAudioForSegment(seg.script);

      Object.assign(seg, {
        audioData: audioData || undefined,
        generationFailed: !audioData,
        changed: false,
      });
    } catch (error) {
      console.error('[AdAudioManager] Failed to generate audio for segment:', error);
      Object.assign(seg, {
        audioData: undefined,
        generationFailed: true,
        changed: false,
      });
    }
  }
}

export const adAudioManager = new AdAudioManager();
(window as any).adAudioManager = adAudioManager;
