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


import { parseArgs } from 'util';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

import { GeminiRequest } from '../ai/gemini_client';
import { OpenAIRequest } from '../ai/openai_client';
import { parseAgentResponse } from '../ai/agent_response_parser';
import { PROMPTS } from '../ai/prompts';
import { AdScriptParser, isValidWebVtt } from '../core/ad_script_parser';
import {
  DEFAULT_OPENAI_MODEL,
  getDefaultVoiceForTtsProvider,
} from '../core/constants';
import { loadServerConfig } from '../server';
import {
  downloadYouTubeVideo,
  extractFrames,
  hasFfmpeg,
  hasYtDlp,
  mixAudioSegmentsWithVideo,
  requireFfmpeg,
} from './video_utils';
import { compileWavTrack, isWavBuffer } from './wav_utils';

type TtsProvider = 'kokoro' | 'gemini' | 'openai';

function detectAudioExtension(buf: Buffer): 'wav' | 'mp3' {
  return isWavBuffer(buf) ? 'wav' : 'mp3';
}

async function main() {
  const { values } = parseArgs({
    options: {
      video: {
        type: 'string',
        short: 'v',
      },
      outdir: {
        type: 'string',
        short: 'o',
      },
      mix: {
        type: 'boolean',
        short: 'm',
      },
      question: {
        type: 'string',
        short: 'q',
      },
      provider: {
        type: 'string',
        short: 'p',
      },
      tts: {
        type: 'string',
        short: 't',
      },
      voice: {
        type: 'string',
      },
      help: {
        type: 'boolean',
        short: 'h',
      },
    },
  });

  if (values.help || !values.video || !values.outdir) {
    console.log(`
Usage: ad-script-assist [options]

Options:
  -v, --video <id_or_url_or_path> YouTube Video ID or URL, or local file path
  -o, --outdir <path>             Output directory for generated files
  -m, --mix                       Compile timed AD audio (ad_track.wav) and mux into mixed_output.mp4 when video + ffmpeg are available
  -q, --question <text>           Ask a question about the video instead of generating an AD script
  -p, --provider <provider>       LLM provider: 'gemini' or 'openai' (defaults to models.conf)
  -t, --tts <provider>            TTS provider: 'kokoro', 'gemini', or 'openai' (defaults to models.conf)
      --voice <name>              TTS voice name (e.g., 'af_heart', 'Aoede', 'alloy')
  -h, --help                      Show help
    `);
    process.exit(values.help ? 0 : 1);
  }

  // Load models.conf (and .env/.env.local) so CLI shares configuration with the web app.
  const serverConfig = loadServerConfig();
  if (!process.env.GEMINI_API_KEY && serverConfig.realKeys['gemini_api_key']) {
    process.env.GEMINI_API_KEY = serverConfig.realKeys['gemini_api_key'];
  }
  if (!process.env.OPENAI_API_KEY && serverConfig.realKeys['openai_api_key']) {
    process.env.OPENAI_API_KEY = serverConfig.realKeys['openai_api_key'];
  }

  const outdir = path.resolve(values.outdir!);
  if (!fs.existsSync(outdir)) {
    fs.mkdirSync(outdir, { recursive: true });
  }

  const videoInput = values.video!;
  let isLocal = false;
  let ytUrl = '';
  let videoId = 'cli-video';
  let videoBuffer: Buffer | null = null;

  if (fs.existsSync(videoInput)) {
    isLocal = true;
    console.log(`Processing local video: ${videoInput}`);
    videoBuffer = fs.readFileSync(videoInput);
    videoId = path.basename(videoInput);
  } else {
    ytUrl = videoInput.startsWith('http')
      ? videoInput
      : `https://www.youtube.com/watch?v=${videoInput}`;
    videoId = videoInput.includes('v=')
      ? new URL(videoInput).searchParams.get('v')!
      : videoInput.split('/').pop()!.split('?')[0];
    console.log(`Processing YouTube video: ${ytUrl}`);
  }

  const provider =
    values.provider ||
    serverConfig.sections['providers']?.['ai_provider'] ||
    'gemini';

  const configuredTts = (
    values.tts ||
    serverConfig.sections['providers']?.['tts_provider'] ||
    'kokoro'
  ).toLowerCase();
  const ttsProvider: TtsProvider =
    configuredTts === 'gemini' || configuredTts === 'openai' || configuredTts === 'kokoro'
      ? configuredTts
      : 'kokoro';
  const voice = values.voice || getDefaultVoiceForTtsProvider(ttsProvider);

  const geminiModel = serverConfig.sections['models']?.['gemini_model'] || undefined;
  const openaiModel = serverConfig.sections['models']?.['openai_model'] || DEFAULT_OPENAI_MODEL;

  if (provider === 'gemini' && !process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set (in environment or models.conf).');
    process.exit(1);
  } else if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY is not set (in environment or models.conf).');
    process.exit(1);
  }

  if (isLocal && values.mix) requireFfmpeg('for --mix with a local video');
  if (isLocal && provider === 'openai') requireFfmpeg('to extract frames for OpenAI');

  // Generate AD for the whole video, or answer the user's question
  const command = values.question || 'Generate AD for the whole video.';
  const prompt = PROMPTS.userCommand(command, '[]', isLocal ? 'local_video.mp4' : ytUrl, '0', '', 0);

  console.log(`Sending request to ${provider}... This may take a minute.`);

  const request = provider === 'openai' ? new OpenAIRequest() : new GeminiRequest();

  try {
    const rawResponse = await new Promise<string>((resolve, reject) => {
      if (isLocal) {
        // Use Node Blob
        const blob = new Blob([videoBuffer as any], { type: 'video/mp4' });
        if (request instanceof GeminiRequest) {
          request.callGeminiWithLocalVideo(
            prompt,
            blob,
            (response) => resolve(response),
            (error) => reject(error),
            geminiModel,
            { videoId }
          );
        } else {
          try {
            const frames = extractFrames(videoInput);
            request.callOpenAIWithFrames(
              prompt,
              frames,
              (response) => resolve(response),
              (error) => reject(error),
              openaiModel,
              { videoId }
            );
          } catch (err) {
            reject(err);
          }
        }
      } else {
        if (request instanceof GeminiRequest) {
          request.callGeminiWithYouTubeURL(
            prompt,
            ytUrl,
            (response) => resolve(response),
            (error) => reject(error),
            geminiModel,
            { videoId }
          );
        } else {
          request.callOpenAIWithYouTubeURL(
            prompt,
            ytUrl,
            (response) => resolve(response),
            (error) => reject(error),
            openaiModel,
            { videoId }
          );
        }
      }
    });

    const parsed = parseAgentResponse(rawResponse);
    if (!parsed.script && !values.question) {
      console.log('Agent did not return an AD script. Agent said:');
      console.log(parsed.response);
      process.exit(1);
    }

    if (values.question) {
      console.log('Agent Response:');
      console.log(parsed.response);

      const answerPath = path.join(outdir, 'answer.txt');
      let text = `> ${values.question}\n\n${parsed.response}`;

      if (parsed.script) {
        console.log('Agent also returned a script snippet:');
        console.log(parsed.script);
        text += `\n\n${parsed.script}`;
      }

      fs.writeFileSync(answerPath, text, 'utf-8');
      console.log(`\nAnswer saved to: ${answerPath}`);
      process.exit(0);
    }

    if (!isValidWebVtt(parsed.script!)) {
      console.error('Agent returned invalid WebVTT script:');
      console.error(parsed.script);
      process.exit(1);
    }

    const scriptPath = path.join(outdir, 'script.vtt');
    fs.writeFileSync(scriptPath, parsed.script!, 'utf-8');

    console.log('Success! WebVTT script saved to:');
    console.log(scriptPath);

    if (values.mix) {
      console.log(`\nStarting audio mixing using ${ttsProvider} TTS (voice: ${voice})...`);
      const parser = new AdScriptParser();
      const segments = parser
        .parse(parsed.script!, videoId)
        .filter((seg) => seg.script.trim().length > 0);

      if (segments.length === 0) {
        console.log('No AD segments to mix.');
        return;
      }

      const { generateTTS } = await import('../ai/tts_client');
      const canMuxYouTube = !isLocal && hasYtDlp() && hasFfmpeg();
      const willMuxVideo = isLocal || canMuxYouTube;

      const generatedSegments: Array<{
        buffer: Buffer;
        startTime: number;
        endTime?: number;
      }> = [];
      for (let i = 0; i < segments.length; i++) {
        console.log(`Generating TTS for segment ${i + 1}/${segments.length}...`);
        const ttsBase64 = await generateTTS(segments[i].script, voice, 1.0, ttsProvider);
        generatedSegments.push({
          buffer: Buffer.from(ttsBase64, 'base64'),
          startTime: segments[i].startTime,
          endTime: segments[i].endTime,
        });
      }

      const allWav = generatedSegments.every((seg) => isWavBuffer(seg.buffer));
      const tempAudioFiles: string[] = [];
      let muxInputs: Array<{ audioPath: string; startTime: number }> = [];

      if (allWav) {
        const compiledWav = compileWavTrack(
          generatedSegments.map((seg) => ({
            wavBuffer: seg.buffer,
            startTime: seg.startTime,
            endTime: seg.endTime,
          })),
        );
        const adTrackPath = path.join(outdir, 'ad_track.wav');
        fs.writeFileSync(adTrackPath, compiledWav);
        console.log(`Compiled AD audio track saved to: ${adTrackPath}`);
        muxInputs = [{ audioPath: adTrackPath, startTime: 0 }];
      } else {
        for (let i = 0; i < generatedSegments.length; i++) {
          const seg = generatedSegments[i];
          const ext = detectAudioExtension(seg.buffer);
          const filename = willMuxVideo ? `temp_audio_${i}.${ext}` : `segment_${i}.${ext}`;
          const audioPath = path.join(outdir, filename);
          fs.writeFileSync(audioPath, seg.buffer);
          muxInputs.push({ audioPath, startTime: seg.startTime });
          if (willMuxVideo) {
            tempAudioFiles.push(audioPath);
          } else {
            console.log(`Saved ${audioPath}`);
          }
        }
      }

      if (willMuxVideo) {
        let sourceVideoPath = videoInput;
        let downloadedTempVideo: string | null = null;
        try {
          if (!isLocal) {
            downloadedTempVideo = path.join(outdir, 'temp_yt_input.mp4');
            console.log(`Downloading YouTube video via yt-dlp: ${ytUrl}`);
            downloadYouTubeVideo(ytUrl, downloadedTempVideo);
            sourceVideoPath = downloadedTempVideo;
          }

          const outVideoPath = path.join(outdir, 'mixed_output.mp4');
          console.log('Running FFmpeg mix command...');
          mixAudioSegmentsWithVideo(sourceVideoPath, muxInputs, outVideoPath);
          console.log(`Mixed video saved to: ${outVideoPath}`);
        } finally {
          if (downloadedTempVideo && fs.existsSync(downloadedTempVideo)) {
            try { fs.unlinkSync(downloadedTempVideo); } catch { /* ignore */ }
          }
          for (const tempFile of tempAudioFiles) {
            try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
          }
        }
      } else if (!isLocal) {
        const missing = [!hasYtDlp() ? 'yt-dlp' : '', !hasFfmpeg() ? 'ffmpeg' : '']
          .filter(Boolean)
          .join(' and ');
        console.log(
          `Install ${missing} to also download and mux YouTube videos into mixed_output.mp4.`,
        );
      }
    }
  } catch (err) {
    console.error('Error generating AD script:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
