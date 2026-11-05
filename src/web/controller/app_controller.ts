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
 * @fileoverview AppController class for encapsulating application state, playback,
 * settings, and AI request orchestration.
 */

import { appState } from '../../core/app_state';
import { adAudioManager } from '../../av/ad_audio_manager';
import { AdScriptParser } from '../../core/ad_script_parser';
import { HotkeyManager } from '../hotkeys';
import {
  addConversationEntryToDB,
  clearAllDataForVideo,
  retrieveAdSegmentsForVideoFromDB,
  retrieveConversationHistoryForVideoFromDB,
  retrieveHotkeyConfigsFromDB,
  retrieveLatestAdScriptForVideoFromDB,
  storeLatestAdScriptToDB,
  storeAdSegmentsToDB,
  resetHotkeyConfigsInDB,
  storeHotkeyConfigsToDB,
} from '../storage/db';
import { formatTimeForScreenReader, formatTimeForVttFull } from '../../core/time_utils';
import { GeminiRequest } from '../../ai/gemini_client';
import { OpenAIRequest } from '../../ai/openai_client';
import { parseAgentResponse } from '../../ai/agent_response_parser';
import { describeError } from '../../ai/describe_error';
import { PROMPTS } from '../../ai/prompts';
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_AUDIO_DUCKING_ENABLED,
  DEFAULT_DUCK_ATTACK_MS,
  DEFAULT_DUCK_HOLD_MS,
  DEFAULT_DUCK_RELEASE_MS,
  DEFAULT_DUCK_VOLUME_PERCENT,
  DEFAULT_OPENAI_MODEL,
  getDefaultVoiceForTtsProvider,
  getInjectedGeminiApiKey,
  getVoicesForTtsProvider,
} from '../../core/constants';
import { extractFramesFromVideoBlob } from '../utils/video_frame_extractor';
import { getVideoExporter } from '../../av/video_exporter';
import { showConfirm } from '../components/confirm_modal';
import type { AdSegment, AgentContext, AgentResponse, ConversationEntry, GeminiRequestPlusData, HotkeyConfigEntry } from '../../core/types';

export class AppController {
  private static instance: AppController | null = null;

  // Playback audio elements
  private readonly adAudio = new Audio();
  private readonly segmentAudio = new Audio();
  private segmentBlobUrl: string | null = null;
  private compiledAdTrackUrl: string | null = null;
  private lastSpokenSegmentIndex = -1;
  private isWebSpeechActive = false;

  // Audio ducking state
  private currentVideoVolume = 1.0;
  private speakingIntervals: Array<{start: number; end: number}> = [];
  private speakingIntervalsGeneration = 0;

  private hotkeyManager = new HotkeyManager();
  private hotkeysUpdatedListener?: () => void;
  private adParser = new AdScriptParser();

  // Active AI requests
  private activeRequest: GeminiRequest | OpenAIRequest | null = null;

  // Unsubscribe handlers
  private unsubscribes: Array<() => void> = [];

  // References to UI components (we can drive them via events or callbacks)
  private onScriptUpdateCallback?: (script: string) => void;
  private onGoToLineCallback?: (line: number) => void;

  private constructor() {
    this.adAudio.muted = false;
  }

  public static getInstance(): AppController {
    if (!AppController.instance) {
      AppController.instance = new AppController();
    }
    return AppController.instance;
  }

  public registerUICallbacks(callbacks: {
    onScriptUpdate?: (script: string) => void;
    onGoToLine?: (line: number) => void;
  }) {
    if (callbacks.onScriptUpdate) this.onScriptUpdateCallback = callbacks.onScriptUpdate;
    if (callbacks.onGoToLine) this.onGoToLineCallback = callbacks.onGoToLine;
  }

  public async initialize() {
    // 0. Ensure server config (providers, models, key placeholders) is loaded first
    await appState.loadServerConfig();

    // 1. Hotkeys Init
    const configs = await retrieveHotkeyConfigsFromDB();
    this.hotkeyManager.setConfigs(configs);

    this.hotkeysUpdatedListener = async () => {
      const updatedConfigs = await retrieveHotkeyConfigsFromDB();
      this.hotkeyManager.setConfigs(updatedConfigs);
    };
    window.addEventListener('hotkeys-updated', this.hotkeysUpdatedListener);

    // 2. Playback Synced Audio subscriptions
    this.unsubscribes.push(
      appState.subscribe('compiledAdTrackUrl', (url) => {
        this.compiledAdTrackUrl = url as string | null;
        if (this.compiledAdTrackUrl) {
          this.adAudio.src = this.compiledAdTrackUrl;
          this.adAudio.load();
          const speak = appState.get('speakAdText') ?? true;
          const player = appState.get('videoPlayerApi');
          if (speak && player && !player.paused && !this.isFallbackSpeaking()) {
            this.adAudio.currentTime = player.currentTime;
            void this.adAudio.play().catch(() => {});
          }
        } else {
          this.adAudio.pause();
          this.adAudio.src = '';
        }
      })
    );

    // Subscribe to speakAdText toggle
    this.unsubscribes.push(
      appState.subscribe('speakAdText', (speak) => {
        if (!speak) {
          this.adAudio.pause();
          this.stopSegmentPlayback();
          this.setVideoVolume(1.0);
        } else {
          const player = appState.get('videoPlayerApi');
          if (player && !player.paused) {
            this.syncAdAudioWithVideo();
          }
        }
      })
    );

    // Subscribe to adSegments and ducking settings to keep ducking intervals & volume updated
    this.unsubscribes.push(
      appState.subscribe('adSegments', () => {
        void this.recomputeSpeakingIntervals();
      }),
      appState.subscribe('audioDuckingEnabled', () => {
        const player = appState.get('videoPlayerApi');
        if (player) this.updateVideoDucking(player.currentTime);
      }),
      appState.subscribe('duckVolumePercent', () => {
        const player = appState.get('videoPlayerApi');
        if (player) this.updateVideoDucking(player.currentTime);
      }),
      appState.subscribe('duckAttackMs', () => {
        const player = appState.get('videoPlayerApi');
        if (player) this.updateVideoDucking(player.currentTime);
      }),
      appState.subscribe('duckReleaseMs', () => {
        const player = appState.get('videoPlayerApi');
        if (player) this.updateVideoDucking(player.currentTime);
      }),
      appState.subscribe('duckHoldMs', () => {
        const player = appState.get('videoPlayerApi');
        if (player) this.updateVideoDucking(player.currentTime);
      }),
    );

    // Sync state: when video resumes play
    this.unsubscribes.push(
      appState.subscribe('isVideoPaused', (paused) => {
        if (paused) {
          this.adAudio.pause();
          this.stopSegmentPlayback();
          this.setVideoVolume(1.0);
        } else {
          this.syncAdAudioWithVideo();
        }
      })
    );

    // Track active video and load database configs
    this.unsubscribes.push(
      appState.subscribe('currentVideoId', async (id) => {
        if (id) {
          await this.loadForVideo(id);
        } else {
          this.resetVideoState();
        }
      })
    );

    // Button states update loop
    this.unsubscribes.push(
      appState.subscribe('currentVideoId', () => this.updateButtonStates()),
      appState.subscribe('isAdAudioGenerating', () => this.updateButtonStates()),
      appState.subscribe('isAgentResponding', () => this.updateButtonStates()),
      appState.subscribe('llmProvider', () => this.updateButtonStates()),
      appState.subscribe('geminiApiKey', () => this.updateButtonStates()),
      appState.subscribe('openaiApiKey', () => this.updateButtonStates()),
    );
  }

  public destroy() {
    this.hotkeyManager.destroy();
    if (this.hotkeysUpdatedListener) {
      window.removeEventListener('hotkeys-updated', this.hotkeysUpdatedListener);
    }
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    this.adAudio.pause();
    this.adAudio.src = '';
    this.stopSegmentPlayback();
  }

  // --- Playback Sync ---

  private setVideoVolume(level: number) {
    const clamped = Math.max(0, Math.min(1, level));
    if (Math.abs(clamped - this.currentVideoVolume) < 0.005) return;
    const player = appState.get('videoPlayerApi');
    if (!player || typeof player.setVolume !== 'function') return;
    this.currentVideoVolume = clamped;
    try {
      player.setVolume(clamped);
    } catch {
      // Ignore if player is not yet ready
    }
  }

  private async recomputeSpeakingIntervals() {
    const generation = ++this.speakingIntervalsGeneration;
    const segments = (appState.get('adSegments') || []).filter(
      (s) => s.script.trim().length > 0,
    );
    const intervals = await Promise.all(
      segments.map(
        (seg) =>
          new Promise<{start: number; end: number}>((resolve) => {
            const slotDuration = Math.max(0, seg.endTime - seg.startTime);
            if (!seg.audioData || typeof Audio === 'undefined') {
              resolve({start: seg.startTime, end: seg.endTime});
              return;
            }
            let settled = false;
            const finish = (rawDur: number) => {
              if (settled) return;
              settled = true;
              let effectiveDur = slotDuration;
              if (Number.isFinite(rawDur) && rawDur > 0) {
                if (slotDuration > 0.2 && rawDur > slotDuration) {
                  const rate = Math.min(1.5, rawDur / slotDuration);
                  effectiveDur = rawDur / rate;
                } else {
                  effectiveDur = rawDur;
                }
              }
              resolve({
                start: seg.startTime,
                end: seg.startTime + Math.max(slotDuration, effectiveDur),
              });
            };
            try {
              const audio = new Audio();
              audio.preload = 'metadata';
              audio.onloadedmetadata = () => finish(audio.duration);
              audio.onerror = () => finish(NaN);
              setTimeout(() => finish(audio.duration), 1500);
              audio.src = seg.audioData;
            } catch {
              finish(NaN);
            }
          }),
      ),
    );
    if (generation !== this.speakingIntervalsGeneration) return;
    this.speakingIntervals = intervals.sort((a, b) => a.start - b.start);
  }

  public computeTargetVideoVolume(currentTime: number): number {
    const speakAdText = appState.get('speakAdText') ?? true;
    const duckingEnabled =
      appState.get('audioDuckingEnabled') ?? DEFAULT_AUDIO_DUCKING_ENABLED;
    const player = appState.get('videoPlayerApi');
    const isPlaying =
      Boolean(player) && !player!.paused && !appState.get('isVideoPaused');

    if (!speakAdText || !duckingEnabled || !isPlaying) {
      return 1.0;
    }

    const duckPct =
      appState.get('duckVolumePercent') ?? DEFAULT_DUCK_VOLUME_PERCENT;
    const duckLevel = Math.max(0, Math.min(1, duckPct / 100));
    if (duckLevel >= 1) {
      return 1.0;
    }

    if (this.isFallbackSpeaking()) {
      return duckLevel;
    }

    const attackSec = Math.max(
      0,
      (appState.get('duckAttackMs') ?? DEFAULT_DUCK_ATTACK_MS) / 1000,
    );
    const releaseSec = Math.max(
      0,
      (appState.get('duckReleaseMs') ?? DEFAULT_DUCK_RELEASE_MS) / 1000,
    );
    const holdSec = Math.max(
      0,
      (appState.get('duckHoldMs') ?? DEFAULT_DUCK_HOLD_MS) / 1000,
    );

    const rawIntervals =
      this.speakingIntervals.length > 0
        ? this.speakingIntervals
        : (appState.get('adSegments') || [])
            .filter((s) => s.script.trim().length > 0)
            .map((s) => ({start: s.startTime, end: s.endTime}));

    let target = 1.0;
    for (const iv of rawIntervals) {
      const start = iv.start;
      const holdEnd = iv.end + holdSec;
      if (currentTime >= start && currentTime <= holdEnd) {
        target = Math.min(target, duckLevel);
      } else if (
        attackSec > 0 &&
        currentTime >= start - attackSec &&
        currentTime < start
      ) {
        const frac = (currentTime - (start - attackSec)) / attackSec;
        const g = 1.0 - (1.0 - duckLevel) * frac;
        target = Math.min(target, g);
      } else if (
        releaseSec > 0 &&
        currentTime > holdEnd &&
        currentTime <= holdEnd + releaseSec
      ) {
        const frac = (currentTime - holdEnd) / releaseSec;
        const g = duckLevel + (1.0 - duckLevel) * frac;
        target = Math.min(target, g);
      }
    }

    return target;
  }

  private updateVideoDucking(currentTime: number) {
    this.setVideoVolume(this.computeTargetVideoVolume(currentTime));
  }

  private isFallbackSpeaking(): boolean {
    return (
      this.isWebSpeechActive ||
      (!this.segmentAudio.paused && !this.segmentAudio.ended)
    );
  }

  private stopSegmentPlayback() {
    this.lastSpokenSegmentIndex = -1;
    this.isWebSpeechActive = false;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.segmentAudio.pause();
    this.segmentAudio.src = '';
    if (this.segmentBlobUrl) {
      URL.revokeObjectURL(this.segmentBlobUrl);
      this.segmentBlobUrl = null;
    }
  }

  private speakFallbackForTime(currentTime: number) {
    const segments = appState.get('adSegments') || [];
    const activeIdx = segments.findIndex(
      (s) =>
        s.script.trim().length > 0 &&
        currentTime >= s.startTime &&
        currentTime < s.endTime,
    );

    if (activeIdx === -1) {
      this.lastSpokenSegmentIndex = -1;
      return;
    }

    if (activeIdx === this.lastSpokenSegmentIndex) {
      return;
    }

    this.lastSpokenSegmentIndex = activeIdx;
    const seg = segments[activeIdx];

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.isWebSpeechActive = false;
    this.segmentAudio.pause();
    if (this.segmentBlobUrl) {
      URL.revokeObjectURL(this.segmentBlobUrl);
      this.segmentBlobUrl = null;
    }

    if (typeof seg.audioData === 'string' && seg.audioData.length > 0) {
      this.segmentAudio.src = seg.audioData;
      const offset = Math.max(0, currentTime - seg.startTime);
      this.segmentAudio.currentTime = offset;
      void this.segmentAudio.play().catch(() => {});
      return;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(seg.script);
      utterance.lang = appState.get('ttsLanguage') || 'en-US';
      this.isWebSpeechActive = true;
      utterance.onend = () => {
        this.isWebSpeechActive = false;
      };
      utterance.onerror = () => {
        this.isWebSpeechActive = false;
      };
      window.speechSynthesis.speak(utterance);
    }
  }

  public syncAdAudioWithVideo() {
    const speakAdText = appState.get('speakAdText') ?? true;
    if (!speakAdText) {
      this.adAudio.pause();
      this.stopSegmentPlayback();
      this.setVideoVolume(1.0);
      return;
    }
    const player = appState.get('videoPlayerApi');
    if (!player) return;
    const targetTime = player.currentTime;
    const isPlaying = !player.paused && !appState.get('isVideoPaused');

    if (this.compiledAdTrackUrl) {
      this.stopSegmentPlayback();
      if (Math.abs(this.adAudio.currentTime - targetTime) > 0.2) {
        try {
          this.adAudio.currentTime = targetTime;
        } catch (e) {}
      }
      if (isPlaying) {
        void this.adAudio.play().catch(() => {});
        this.updateVideoDucking(targetTime);
      } else {
        this.adAudio.pause();
        this.setVideoVolume(1.0);
      }
      return;
    }

    if (!isPlaying) {
      this.stopSegmentPlayback();
      this.setVideoVolume(1.0);
      return;
    }

    const segments = appState.get('adSegments') || [];
    const activeIdx = segments.findIndex(
      (s) =>
        s.script.trim().length > 0 &&
        targetTime >= s.startTime &&
        targetTime < s.endTime,
    );
    if (activeIdx === -1 || activeIdx !== this.lastSpokenSegmentIndex) {
      this.stopSegmentPlayback();
    }
    this.speakFallbackForTime(targetTime);
    this.updateVideoDucking(targetTime);
  }

  public handleTimeUpdate(currentTime: number) {
    const speakAdText = appState.get('speakAdText') ?? true;
    if (!speakAdText) {
      this.adAudio.pause();
      this.stopSegmentPlayback();
      this.setVideoVolume(1.0);
      return;
    }
    const player = appState.get('videoPlayerApi');
    if (!player) return;

    // Sync compiled ad track if ready and no fallback speech is mid-utterance
    if (this.compiledAdTrackUrl && !player.paused) {
      if (this.isFallbackSpeaking()) {
        this.updateVideoDucking(currentTime);
        return;
      }
      if (Math.abs(this.adAudio.currentTime - currentTime) > 0.3) {
        this.adAudio.currentTime = currentTime;
      }
      if (this.adAudio.paused) {
        void this.adAudio.play().catch(() => {});
      }
      this.updateVideoDucking(currentTime);
      return;
    }

    if (!player.paused) {
      this.speakFallbackForTime(currentTime);
    }
    this.updateVideoDucking(currentTime);
  }

  // --- Database Loads ---

  private async loadForVideo(videoId: string) {
    appState.set('statusMessage', 'Loading cached project data...');
    
    // Load Script
    const latestScriptHistory = await retrieveLatestAdScriptForVideoFromDB(videoId);
    let scriptText = '';
    if (latestScriptHistory) {
      scriptText = latestScriptHistory.script;
      if (this.onScriptUpdateCallback) {
        this.onScriptUpdateCallback(scriptText);
      }
    }

    // Load and parse Segments
    const parsedSegments = this.adParser.parse(scriptText, videoId);
    const cachedSegments = await retrieveAdSegmentsForVideoFromDB(videoId);
    const comparedSegments = this.adParser.compare(cachedSegments || [], parsedSegments);

    if (comparedSegments.length > 0) {
      appState.set('adSegments', comparedSegments);
      void adAudioManager.regenerateAdAudio();
    } else {
      appState.set('adSegments', []);
    }

    // Load Conversation history
    const history = await retrieveConversationHistoryForVideoFromDB(videoId);
    appState.set('conversationLog', history || []);

    appState.set('statusMessage', 'Project loaded.');
  }

  private resetVideoState() {
    this.adAudio.pause();
    this.adAudio.src = '';
    this.stopSegmentPlayback();
    this.speakingIntervals = [];
    this.setVideoVolume(1.0);
    appState.set('adSegments', []);
    appState.set('conversationLog', []);
    if (this.onScriptUpdateCallback) {
      this.onScriptUpdateCallback('');
    }
  }

  // --- Script Updating ---

  public syncScriptSegments(scriptText: string, regenerateAudio = true) {
    const videoId = appState.get('currentVideoId');
    if (!videoId) return;

    // Parse and compare segments
    const oldSegments = appState.get('adSegments') || [];
    const newSegments = this.adParser.parse(scriptText, videoId);
    const comparedSegments = this.adParser.compare(oldSegments, newSegments);

    const hasUnrendered = comparedSegments.some(
      (s) => s.changed || (s.script.trim() !== '' && !s.audioData),
    );
    if (hasUnrendered) {
      appState.set('compiledAdTrackUrl', null);
    }

    appState.set('adSegments', comparedSegments);
    void storeLatestAdScriptToDB(videoId, scriptText);
    if (regenerateAudio) {
      void adAudioManager.regenerateAdAudio();
    }
  }

  // --- Hotkeys Actions & API Gating ---

  public setupHotkeys(actions: Record<string, () => void>) {
    void this.hotkeyManager.init(actions);
  }

  public async togglePlayPause() {
    const player = appState.get('videoPlayerApi');
    if (!player) return;

    const isPaused = appState.get('isVideoPaused');
    if (isPaused) {
      // Trigger audio generation in the background if needed; playback starts
      // immediately and falls back to Web Speech API for any unrendered cues.
      void adAudioManager.regenerateAdAudio();
    }

    if (isPaused) {
      void player.play();
    } else {
      player.pause();
    }
    const newPaused = !isPaused;
    appState.set('isVideoPaused', newPaused);

    const time = player.currentTime;
    appState.set('statusMessage',
      newPaused
        ? `Paused at ${formatTimeForScreenReader(time)}.`
        : `Playing at ${formatTimeForScreenReader(time)}.`
    );
  }

  public jumpForward() {
    const player = appState.get('videoPlayerApi');
    if (!player) return;
    const jumpTime = Math.min(player.currentTime + 5, player.duration);
    player.seek(jumpTime);
    appState.set('statusMessage', `Fast forwarded to ${formatTimeForScreenReader(jumpTime)}.`);
  }

  public jumpBackward() {
    const player = appState.get('videoPlayerApi');
    if (!player) return;
    const jumpTime = Math.max(player.currentTime - 5, 0);
    player.seek(jumpTime);
    appState.set('statusMessage', `Rewound to ${formatTimeForScreenReader(jumpTime)}.`);
  }

  public jumpToStart() {
    const player = appState.get('videoPlayerApi');
    if (!player) return;
    player.seek(0);
    appState.set('statusMessage', 'Jumped to beginning of video.');
  }

  public async clearVideoData() {
    const videoId = appState.get('currentVideoId');
    if (!videoId) return;

    appState.set('statusMessage', 'Clearing video data...');
    await clearAllDataForVideo(videoId);
    appState.set('currentVideoId', '');
    appState.set('localVideoFile', undefined);
    this.resetVideoState();
    appState.set('statusMessage', 'Video and associated data cleared.');
  }

  // --- Model Interaction (Orchestrated and Gated) ---

  public getAgentContext(currentScriptText: string, currentLineNumber: number): AgentContext {
    const player = appState.get('videoPlayerApi');
    return {
      videoId: appState.get('currentVideoId') || '',
      adScriptText: currentScriptText,
      adScriptLine: currentLineNumber,
      currentTime: player?.currentTime || 0,
      videoDuration: player?.duration || 0,
    };
  }

  public async generateAd() {
    if (!appState.get('isGenerateEnabled')) {
      return;
    }

    const existingScriptText = (appState.get('editorScriptText') || '').trim();
    const existingSegments = appState.get('adSegments') || [];
    const hasExistingAd =
      existingScriptText.length > 0 ||
      existingSegments.some((seg) => seg.script.trim().length > 0);

    if (hasExistingAd) {
      const isConfirmed = await showConfirm(
        'Generate Audio Description',
        'Generating a new Audio Description script will overwrite the existing AD text in the editor, and current edits will be lost. Do you want to continue?',
        'Generate',
        'Cancel',
        true,
      );
      if (!isConfirmed) {
        return;
      }
    }

    const scriptText = appState.get('editorScriptText') || '';
    const cursorLine = appState.get('editorCursorLine') || 1;
    const context = this.getAgentContext(scriptText, cursorLine);
    void this.sendMessage('Please write a full audio description script for this video. You MUST place the full script in the "script" field of your JSON response, not in the "response" field.', context, true);
  }

  public async sendMessage(command: string, context: AgentContext, silent = false) {
    const videoId = appState.get('currentVideoId');
    if (!videoId) {
      appState.set('statusMessage', 'No video loaded.');
      return;
    }

    // Gate requests: only one at a time
    if (appState.get('isAgentResponding')) {
      appState.set('statusMessage', 'Agent is already processing a request.');
      return;
    }

    appState.set('isAgentResponding', true);
    appState.set('statusMessage', 'Sending command to agent...');

    let log = appState.get('conversationLog') || [];

    if (!silent) {
      const userEntry: ConversationEntry = {
        type: 'user',
        message: command,
        timestamp: new Date().toISOString(),
        trashed: false,
        videoId,
      };
      log = [...log, userEntry];
      appState.set('conversationLog', log);
      await addConversationEntryToDB(userEntry);
    }

    try {
      const ytUrl = !videoId.startsWith('http') && !appState.get('localVideoFile')
        ? `https://www.youtube.com/watch?v=${videoId}`
        : videoId;

      const historyString = JSON.stringify(log.slice(-10));
      const prompt = PROMPTS.userCommand(
        command,
        historyString,
        ytUrl,
        String(context.currentTime || 0),
        context.adScriptText || '',
        context.adScriptLine || 0,
        appState.get('scriptNotes') || ''
      );

      const provider = appState.get('llmProvider') || 'gemini';
      if (provider === 'none') {
        const msg = 'VLM provider is set to None. Configure ai_provider in models.conf to use AI features.';
        appState.set('statusMessage', msg);
        this.appendAgentMessage(`⚠️ ${msg}`, videoId, false);
        appState.set('isAgentResponding', false);
        return;
      }
      let request: GeminiRequest | OpenAIRequest;
      if (provider === 'openai') {
        request = new OpenAIRequest();
      } else {
        request = new GeminiRequest();
      }
      this.activeRequest = request;

      const model =
        provider === 'openai'
          ? appState.get('openaiModel') || DEFAULT_OPENAI_MODEL
          : appState.get('agentModel') || DEFAULT_AGENT_MODEL;
      const data: GeminiRequestPlusData = {
        videoId,
        adTextBefore: context.adScriptText || '',
        command,
      };

      const localFile = appState.get('localVideoFile') as File | undefined;

      const onResponse = async (text: string) => {
        try {
          const parsed = parseAgentResponse(text);
          
          if (!silent) {
            const aiEntry: ConversationEntry = {
              type: 'agent',
              message: parsed.response || 'Done.',
              timestamp: new Date().toISOString(),
              trashed: false,
              videoId,
            };
            const currentLog = appState.get('conversationLog') || [];
            appState.set('conversationLog', [...currentLog, aiEntry]);
            addConversationEntryToDB(aiEntry).catch((e) =>
              console.error('Failed to save AI response to DB:', e)
            );
          }

          // Handle script updates
          if (parsed.script !== undefined) {
            if (this.onScriptUpdateCallback) {
              this.onScriptUpdateCallback(parsed.script);
            }
            this.syncScriptSegments(parsed.script);
            appState.set('statusMessage', 
              parsed.script.length > 0 ? 'Agent updated script.' : 'Agent cleared script.'
            );
          }

          // Handle seeking
          const player = appState.get('videoPlayerApi');
          if (parsed.timestamp !== undefined && parsed.timestamp !== 0 && player) {
            player.seek(parsed.timestamp);
            appState.set('statusMessage', `Agent seeked video to ${formatTimeForScreenReader(parsed.timestamp)}.`);
          }

          // Handle active line navigation
          if (parsed.line !== undefined && parsed.line !== 0 && this.onGoToLineCallback) {
            this.onGoToLineCallback(parsed.line);
          }

        } catch (e) {
          console.error('Failed to parse AI response', e, 'Raw:', text);
          this.appendAgentMessage('⚠️ Error: Could not parse response from agent.', videoId, false);
        } finally {
          this.activeRequest = null;
          appState.set('isAgentResponding', false);
        }
      };

      const onError = (error: unknown) => {
        console.error('AI Error:', error);
        const source = provider === 'openai' ? 'OpenAI' : model;
        const errMsg = describeError(error, provider).replace(/\.?$/, '.');
        appState.set('statusMessage', `Error from ${source}: ${errMsg}`);
        this.appendAgentMessage(
          `⚠️ Error from ${source}: ${errMsg}`, videoId, false);
        this.activeRequest = null;
        appState.set('isAgentResponding', false);
      };

      if (localFile) {
        if (request instanceof GeminiRequest) {
          await request.callGeminiWithLocalVideo(prompt, localFile, onResponse, onError, model, data);
        } else {
          const frames = await extractFramesFromVideoBlob(localFile);
          await request.callOpenAIWithFrames(prompt, frames, onResponse, onError, model, data);
        }
      } else {
        if (request instanceof GeminiRequest) {
          await request.callGeminiWithYouTubeURL(prompt, ytUrl, onResponse, onError, model, data);
        } else {
          await request.callOpenAIWithYouTubeURL(prompt, ytUrl, onResponse, onError, model, data);
        }
      }

    } catch (e) {
      console.error('AI Request failed', e);
      this.appendAgentMessage(`⚠️ Sorry, an unexpected error occurred: ${describeError(e)}`, videoId, false);
      this.activeRequest = null;
      appState.set('isAgentResponding', false);
    }
  }

  private appendAgentMessage(msg: string, videoId: string, silent: boolean) {
    if (silent) return;
    const entry: ConversationEntry = {
      type: 'agent',
      message: msg,
      timestamp: new Date().toISOString(),
      trashed: false,
      videoId,
    };
    const currentLog = appState.get('conversationLog') || [];
    appState.set('conversationLog', [...currentLog, entry]);
    void addConversationEntryToDB(entry);
  }

  // --- Exports ---

  public async exportFile(type: string, localVideoFile?: File) {
    const videoId = appState.get('currentVideoId');
    if (!videoId) {
      appState.set('statusMessage', 'No video loaded. Cannot export.');
      return;
    }

    if (appState.get('isAdAudioGenerating')) {
      appState.set('statusMessage', 'Still generating audio segments. Please wait.');
      return;
    }

    appState.set('statusMessage', `Starting ${type} export...`);

    try {
      const segments = appState.get('adSegments') || [];

      if (type === 'webvtt') {
        let vtt = "WEBVTT\n\n";
        segments.forEach((seg, i) => {
          vtt += `${i + 1}\n${formatTimeForVttFull(seg.startTime)} --> ${formatTimeForVttFull(seg.endTime)}\n${seg.script}\n\n`;
        });
        
        const blob = new Blob([vtt], { type: 'text/vtt' });
        const url = URL.createObjectURL(blob);
        this.triggerDownload(url, `${videoId}_ad.vtt`);
        URL.revokeObjectURL(url);
        appState.set('statusMessage', 'WebVTT export complete.');
        
      } else if (type === 'audio') {
        const compiledTrack = appState.get('compiledAdTrackUrl');
        if (compiledTrack) {
          this.triggerDownload(compiledTrack, `${videoId}_ad_track.wav`);
          appState.set('statusMessage', 'Audio export complete.');
        } else {
          appState.set('statusMessage', 'No audio track available to export.');
        }

      } else if (type === 'video') {
        const adTrackUrl = appState.get('compiledAdTrackUrl');
        if (!localVideoFile || !adTrackUrl) {
          appState.set('statusMessage', 'Mixed video export needs a local video and a generated AD track.');
          return;
        }
        const exporter = await getVideoExporter();
        const blob = await exporter.exportMixedVideo({
          video: localVideoFile,
          adTrack: await (await fetch(adTrackUrl)).blob(),
          ducking: {
            enabled: appState.get('audioDuckingEnabled') ?? DEFAULT_AUDIO_DUCKING_ENABLED,
            duckVolumePercent: appState.get('duckVolumePercent') ?? DEFAULT_DUCK_VOLUME_PERCENT,
            attackMs: appState.get('duckAttackMs') ?? DEFAULT_DUCK_ATTACK_MS,
            releaseMs: appState.get('duckReleaseMs') ?? DEFAULT_DUCK_RELEASE_MS,
            holdMs: appState.get('duckHoldMs') ?? DEFAULT_DUCK_HOLD_MS,
          },
          onProgress: (p) => appState.set('statusMessage', `Exporting video: ${Math.round(p * 100)}%`),
        });
        const url = URL.createObjectURL(blob);
        this.triggerDownload(url, `${videoId}_mixed.${exporter.fileExtension}`);
        URL.revokeObjectURL(url);
        appState.set('statusMessage', 'Mixed video export complete.');
      } else if (type === 'all') {
        await this.exportFile('webvtt', localVideoFile);
        const compiledTrack = appState.get('compiledAdTrackUrl');
        if (compiledTrack) {
          await this.exportFile('audio', localVideoFile);
        }
        if (localVideoFile && compiledTrack) {
          const exporter = await getVideoExporter().catch(() => null);
          if (exporter && (await exporter.isSupported().catch(() => false))) {
            await this.exportFile('video', localVideoFile);
          }
        }
        appState.set('statusMessage', 'All available project exports complete.');
      }
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'Unknown error';
      appState.set('statusMessage', `Export failed: ${msg}`);
    }
  }

  private triggerDownload(url: string, filename: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // --- Modals Management ---

  public openSettings() {
    appState.set('isSettingsModalOpen', true);
  }

  public closeSettings() {
    appState.set('isSettingsModalOpen', false);
  }

  public openHelp() {
    appState.set('isHelpModalOpen', true);
  }

  public closeHelp() {
    appState.set('isHelpModalOpen', false);
  }

  public openAddVideo() {
    appState.set('isAddVideoModalOpen', true);
  }

  public closeAddVideo() {
    appState.set('isAddVideoModalOpen', false);
  }

  // --- Settings Management ---

  public async saveSettings(settings: {
    ttsProvider?: 'gemini' | 'openai' | 'kokoro';
    ttsLanguage?: string;
    ttsVoice?: string;
    audioDuckingEnabled?: boolean;
    duckVolumePercent?: number;
    duckAttackMs?: number;
    duckReleaseMs?: number;
    duckHoldMs?: number;
    hotkeys?: HotkeyConfigEntry[];
  }) {
    if (settings.ttsProvider !== undefined) {
      appState.set('ttsProvider', settings.ttsProvider);
      const validVoices = getVoicesForTtsProvider(settings.ttsProvider);
      const currentVoice = settings.ttsVoice ?? appState.get('ttsVoice');
      if (!validVoices.some((v) => v.name === currentVoice)) {
        appState.set('ttsVoice', getDefaultVoiceForTtsProvider(settings.ttsProvider));
      }
    }
    if (settings.ttsLanguage !== undefined) {
      appState.set('ttsLanguage', settings.ttsLanguage);
    }
    if (settings.ttsVoice !== undefined) {
      appState.set('ttsVoice', settings.ttsVoice);
    }
    if (settings.audioDuckingEnabled !== undefined) {
      appState.set('audioDuckingEnabled', settings.audioDuckingEnabled);
    }
    if (settings.duckVolumePercent !== undefined) {
      appState.set(
        'duckVolumePercent',
        Math.max(0, Math.min(100, settings.duckVolumePercent)),
      );
    }
    if (settings.duckAttackMs !== undefined) {
      appState.set('duckAttackMs', Math.max(0, Math.min(2000, settings.duckAttackMs)));
    }
    if (settings.duckReleaseMs !== undefined) {
      appState.set('duckReleaseMs', Math.max(0, Math.min(2000, settings.duckReleaseMs)));
    }
    if (settings.duckHoldMs !== undefined) {
      appState.set('duckHoldMs', Math.max(0, Math.min(2000, settings.duckHoldMs)));
    }

    if (settings.hotkeys) {
      await storeHotkeyConfigsToDB(settings.hotkeys);
      const updatedConfigs = await retrieveHotkeyConfigsFromDB();
      this.hotkeyManager.setConfigs(updatedConfigs);
    }

    window.dispatchEvent(new CustomEvent('hotkeys-updated'));
  }

  public async resetSettings() {
    await resetHotkeyConfigsInDB();
    const newHotkeys = await retrieveHotkeyConfigsFromDB();
    this.hotkeyManager.setConfigs(newHotkeys);

    const cloudTtsProvider = appState.get('cloudTtsProvider') || 'gemini';
    appState.set('ttsProvider', cloudTtsProvider);
    appState.set('ttsLanguage', 'en-US');
    appState.set('ttsVoice', getDefaultVoiceForTtsProvider(cloudTtsProvider));
    appState.set('audioDuckingEnabled', DEFAULT_AUDIO_DUCKING_ENABLED);
    appState.set('duckVolumePercent', DEFAULT_DUCK_VOLUME_PERCENT);
    appState.set('duckAttackMs', DEFAULT_DUCK_ATTACK_MS);
    appState.set('duckReleaseMs', DEFAULT_DUCK_RELEASE_MS);
    appState.set('duckHoldMs', DEFAULT_DUCK_HOLD_MS);
    await appState.loadServerConfig();

    window.dispatchEvent(new CustomEvent('hotkeys-updated'));
  }

  // --- Actions & Buttons Gating ---

  private updateButtonStates() {
    const videoId = appState.get('currentVideoId');
    const isGenerating = appState.get('isAdAudioGenerating');
    const isResponding = appState.get('isAgentResponding');
    const llmProvider = appState.get('llmProvider') || 'gemini';
    const activeKey =
      llmProvider === 'openai'
        ? appState.get('openaiApiKey')?.trim() || appState.get('geminiApiKey')?.trim()
        : appState.get('geminiApiKey')?.trim();
    const hasVlmKey =
      llmProvider !== 'none' &&
      Boolean(getInjectedGeminiApiKey() || activeKey);

    appState.set('isPlayEnabled', !!videoId);
    appState.set('isGenerateEnabled', !!videoId && hasVlmKey && !isResponding);
    appState.set('isClearEnabled', !!videoId);
    appState.set('isExportEnabled', !!videoId && !isGenerating && !isResponding);
    appState.set('isAgentInputEnabled', !!videoId && hasVlmKey && !isResponding);
  }
}
