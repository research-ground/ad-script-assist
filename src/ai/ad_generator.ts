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

import {appState} from '../core/app_state';
import {createAudioUrlFromBase64} from '../av/audio_utils';
import {generateTTS} from './tts_client';

/**
 * Service to generate audio for AD segments.
 */
export class AdGenerator {
  private static instance: AdGenerator;

  private constructor() {}

  /**
   * Returns the singleton instance of AdGenerator.
   * @return The AdGenerator instance.
   */
  static getInstance(): AdGenerator {
    if (!AdGenerator.instance) {
      AdGenerator.instance = new AdGenerator();
    }
    return AdGenerator.instance;
  }

  async generateAudioForSegment(script: string, voiceOverride?: string): Promise<string | null> {
    const voiceName = voiceOverride || (appState.get('ttsVoice') as string) || 'Aoede';
    const base64PcmData = await generateTTS(script, voiceName);
    if (base64PcmData) {
      const waveFile = createAudioUrlFromBase64(base64PcmData);
      return waveFile;
    }
    return null;
  }
}
