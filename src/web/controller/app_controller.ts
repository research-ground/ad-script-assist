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
import { formatTimeForScreenReader } from '../../core/time_utils';
import { GeminiRequest } from '../../ai/gemini_client';
import { OpenAIRequest } from '../../ai/openai_client';
import { parseAgentResponse } from '../../ai/agent_response_parser';
import { PROMPTS } from '../../ai/prompts';
import { DEFAULT_AGENT_MODEL } from '../../core/constants';
import { extractFramesFromVideoBlob } from '../utils/video_frame_extractor';
import { getVideoExporter } from '../../av/video_exporter';
import type { AdSegment, AgentContext, AgentResponse, ConversationEntry, GeminiRequestPlusData, HotkeyConfigEntry } from '../../core/types';

export class AppController {
  private static instance: AppController | null = null;

  // Playback audio elements
  private readonly adAudio = new Audio();
  private lastSpokenSegmentId: string | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private compiledAdTrackUrl: string | null = null;

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
          if (speak && player && !player.paused) {
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
          if (this.currentUtterance) {
            window.speechSynthesis.cancel();
          }
        } else {
          const player = appState.get('videoPlayerApi');
          if (player && !player.paused && this.compiledAdTrackUrl) {
            this.adAudio.currentTime = player.currentTime;
            void this.adAudio.play().catch(() => {});
          }
        }
      })
    );

    // Sync state: when video resumes play
    this.unsubscribes.push(
      appState.subscribe('isVideoPaused', (paused) => {
        if (paused) {
          this.adAudio.pause();
          window.speechSynthesis.cancel();
          this.lastSpokenSegmentId = null;
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
      appState.subscribe('isAgentResponding', () => this.updateButtonStates())
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
  }

  // --- Playback Sync ---

  public syncAdAudioWithVideo() {
    const speakAdText = appState.get('speakAdText') ?? true;
    if (!speakAdText) {
      this.adAudio.pause();
      return;
    }
    const player = appState.get('videoPlayerApi');
    if (!player) return;
    const targetTime = player.currentTime;
    if (Math.abs(this.adAudio.currentTime - targetTime) > 0.2) {
      try {
        this.adAudio.currentTime = targetTime;
      } catch (e) {}
    }
    if (!player.paused) {
      void this.adAudio.play().catch(() => {});
    } else {
      this.adAudio.pause();
    }
  }

  public handleTimeUpdate(currentTime: number) {
    const speakAdText = appState.get('speakAdText') ?? true;
    if (!speakAdText) {
      this.adAudio.pause();
      window.speechSynthesis.cancel();
      this.lastSpokenSegmentId = null;
      return;
    }
    const player = appState.get('videoPlayerApi');
    if (!player) return;

    // Sync compiled ad track if needed
    if (this.compiledAdTrackUrl && !player.paused) {
      if (Math.abs(this.adAudio.currentTime - currentTime) > 0.3) {
        this.adAudio.currentTime = currentTime;
      }
      if (this.adAudio.paused) {
        void this.adAudio.play().catch(() => {});
      }
    }


    const adSegments = appState.get('adSegments') || [];
    for (const seg of adSegments) {
      if (currentTime >= seg.startTime && currentTime <= seg.endTime) {
        const segId = `${seg.startTime}-${seg.script}`;
        if (this.lastSpokenSegmentId !== segId) {
          this.lastSpokenSegmentId = segId;

          if (!seg.audioData || !this.compiledAdTrackUrl) {
            console.log(`[PlaybackController] Fallback local TTS: "${seg.script}"`);
            if (this.currentUtterance) {
              window.speechSynthesis.cancel();
            }
            const utterance = new SpeechSynthesisUtterance(seg.script);
            utterance.volume = 1;
            utterance.rate = 1;
            const voices = window.speechSynthesis.getVoices();
            if (voices && voices.length > 0) {
              utterance.voice = voices.find(v => v.lang.startsWith('en')) || voices[0];
            }
            this.currentUtterance = utterance;
            window.speechSynthesis.speak(utterance);
          }
        }
        break;
      }
    }
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
    this.lastSpokenSegmentId = null;
    if (this.currentUtterance) {
      window.speechSynthesis.cancel();
    }
    appState.set('adSegments', []);
    appState.set('conversationLog', []);
    if (this.onScriptUpdateCallback) {
      this.onScriptUpdateCallback('');
    }
  }

  // --- Script Updating ---

  public syncScriptSegments(scriptText: string) {
    const videoId = appState.get('currentVideoId');
    if (!videoId) return;

    // Parse and compare segments
    const oldSegments = appState.get('adSegments') || [];
    const newSegments = this.adParser.parse(scriptText, videoId);
    const comparedSegments = this.adParser.compare(oldSegments, newSegments);

    appState.set('adSegments', comparedSegments);
    void storeLatestAdScriptToDB(videoId, scriptText);
    void adAudioManager.regenerateAdAudio();
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
      // Trigger audio generation in the background (non-blocking)
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

  public generateAd() {
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
      let request: GeminiRequest | OpenAIRequest;
      if (provider === 'openai') {
        request = new OpenAIRequest();
      } else {
        request = new GeminiRequest();
      }
      this.activeRequest = request;

      const model = DEFAULT_AGENT_MODEL;
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
          this.appendAgentMessage('Error: Could not parse response from agent.', videoId, silent);
        } finally {
          this.activeRequest = null;
          appState.set('isAgentResponding', false);
        }
      };

      const onError = (error: unknown) => {
        console.error('AI Error:', error);
        this.appendAgentMessage('An error occurred while contacting the agent.', videoId, silent);
        this.activeRequest = null;
        appState.set('isAgentResponding', false);
      };

      if (localFile) {
        if (request instanceof GeminiRequest) {
          await request.callGeminiWithLocalVideo(prompt, localFile, onResponse, onError, model, data);
        } else {
          const frames = await extractFramesFromVideoBlob(localFile);
          await request.callOpenAIWithFrames(prompt, frames, onResponse, onError, 'gpt-4o', data);
        }
      } else {
        if (request instanceof GeminiRequest) {
          await request.callGeminiWithYouTubeURL(prompt, ytUrl, onResponse, onError, model, data);
        } else {
          await request.callOpenAIWithYouTubeURL(prompt, ytUrl, onResponse, onError, 'gpt-4o', data);
        }
      }

    } catch (e) {
      console.error('AI Request failed', e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.appendAgentMessage(`Sorry, an unexpected error occurred: ${errorMsg}`, videoId, silent);
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
        const { formatTimeForVttFull } = await import('../../core/time_utils');
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
          onProgress: (p) => appState.set('statusMessage', `Exporting video: ${Math.round(p * 100)}%`),
        });
        const url = URL.createObjectURL(blob);
        this.triggerDownload(url, `${videoId}_mixed.${exporter.fileExtension}`);
        URL.revokeObjectURL(url);
        appState.set('statusMessage', 'Mixed video export complete.');
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
    geminiApiKey?: string;
    openaiApiKey?: string;
    llmProvider?: 'gemini' | 'openai';
    ttsLanguage?: string;
    ttsVoice?: string;
    hotkeys?: HotkeyConfigEntry[];
  }) {
    if (settings.geminiApiKey !== undefined) {
      appState.set('geminiApiKey', settings.geminiApiKey);
    }
    if (settings.openaiApiKey !== undefined) {
      appState.set('openaiApiKey', settings.openaiApiKey);
    }
    if (settings.llmProvider !== undefined) {
      appState.set('llmProvider', settings.llmProvider);
    }
    if (settings.ttsLanguage !== undefined) {
      appState.set('ttsLanguage', settings.ttsLanguage);
    }
    if (settings.ttsVoice !== undefined) {
      appState.set('ttsVoice', settings.ttsVoice);
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

    appState.set('geminiApiKey', '');
    appState.set('openaiApiKey', '');
    appState.set('llmProvider', 'gemini');
    appState.set('ttsLanguage', 'en-US');
    appState.set('ttsVoice', 'Aoede');

    window.dispatchEvent(new CustomEvent('hotkeys-updated'));
  }

  // --- Actions & Buttons Gating ---

  private updateButtonStates() {
    const videoId = appState.get('currentVideoId');
    const isGenerating = appState.get('isAdAudioGenerating');
    const isResponding = appState.get('isAgentResponding');

    appState.set('isPlayEnabled', !!videoId);
    appState.set('isClearEnabled', !!videoId);
    appState.set('isExportEnabled', !!videoId && !isGenerating && !isResponding);
    appState.set('isAgentInputEnabled', !!videoId && !isResponding);
  }
}
