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
import { extractFrames, requireFfmpeg } from './video_utils';

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
  -m, --mix                       Mix generated TTS with the video (or just output audio if YT)
  -q, --question <text>           Ask a question about the video instead of generating an AD script
  -p, --provider <provider>       LLM provider: 'gemini' (default) or 'openai'
  -h, --help                      Show help
    `);
    process.exit(values.help ? 0 : 1);
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
      : videoInput.split('/').pop()!;
    console.log(`Processing YouTube video: ${ytUrl}`);
  }

  const provider = values.provider || 'gemini';

  if (provider === 'gemini' && !process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY environment variable is not set.');
    process.exit(1);
  } else if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable is not set.');
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
            undefined,
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
              'gpt-4o',
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
            undefined,
            { videoId }
          );
        } else {
          request.callOpenAIWithYouTubeURL(
            prompt,
            ytUrl,
            (response) => resolve(response),
            (error) => reject(error),
            'gpt-4o',
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
      console.log('\\nStarting audio mixing...');
      const parser = new AdScriptParser();
      const segments = parser.parse(parsed.script!, videoId);
      
      if (isLocal) {
        console.log('Generating TTS files and mixing over local video...');
        const { generateTTS } = await import('../ai/tts_client');
        const { execSync } = await import('child_process');
        
        // Save original video to temp file
        const tempVideoPath = path.join(outdir, 'temp_input.mp4');
        fs.writeFileSync(tempVideoPath, videoBuffer!);

        const inputs: string[] = ['-i', `"${tempVideoPath}"`];
        const delays: string[] = [];
        const amixInputs: string[] = ['[0:a]'];
        let audioIndex = 1;

        for (let i = 0; i < segments.length; i++) {
          if (!segments[i].script.trim()) continue;
          console.log(`Generating TTS for segment ${i + 1}/${segments.length}...`);
          const ttsBlob = await generateTTS(segments[i].script, 'Aoede', 1.0, provider);
          const ttsBuffer = Buffer.from(ttsBlob, 'base64');
          const audioPath = path.join(outdir, `temp_audio_${i}.mp3`);
          fs.writeFileSync(audioPath, ttsBuffer);
          
          inputs.push('-i', `"${audioPath}"`);
          const delayMs = Math.round(segments[i].startTime * 1000);
          delays.push(`[${audioIndex}:a]adelay=${delayMs}|${delayMs}[a${audioIndex}]`);
          amixInputs.push(`[a${audioIndex}]`);
          audioIndex++;
        }

        if (audioIndex > 1) {
          const filterComplex = [
            ...delays,
            `${amixInputs.join('')}amix=inputs=${audioIndex}:duration=first:dropout_transition=2[aout]`
          ].join('; ');
          
          const outVideoPath = path.join(outdir, 'mixed_output.mp4');
          console.log('Running FFmpeg mix command...');
          execSync(`ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v copy -c:a aac "${outVideoPath}"`, { stdio: 'inherit' });
          console.log(`Mixed video saved to: ${outVideoPath}`);
        } else {
          console.log('No AD segments to mix. Local video unchanged.');
        }

        // Cleanup
        fs.unlinkSync(tempVideoPath);
        for (let i = 0; i < segments.length; i++) {
          if (segments[i].script.trim()) {
            try { fs.unlinkSync(path.join(outdir, `temp_audio_${i}.mp3`)); } catch (e) {}
          }
        }
      } else {
        // For YouTube, just mix the audio alone without video
        // We pass a dummy empty video blob to the mixer, which will just fail or mix audio over nothing.
        // Actually, FFMPEGMixer is currently hardcoded to map 0:v (video). If video is empty, it fails.
        // We'll write a simple unmixed TTS script for YT tests
        console.log('Generating TTS files for YT video segments...');
        const { generateTTS } = await import('../ai/tts_client');
        for (let i = 0; i < segments.length; i++) {
          if (!segments[i].script.trim()) continue;
          const ttsBlob = await generateTTS(segments[i].script, 'Aoede', 1.0, provider);
          const ttsBuffer = Buffer.from(ttsBlob, 'base64');
          const audioPath = path.join(outdir, `segment_${i}.mp3`);
          fs.writeFileSync(audioPath, ttsBuffer);
          console.log(`Saved ${audioPath}`);
        }
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
