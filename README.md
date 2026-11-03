# AD Script Assist

AD Script Assist is a web-based, AI-driven interactive helper for creating, editing, and mixing audio descriptions (AD) for videos. It helps users generate initial AD scripts and refine them through a natural language chat interface with an AI agent, or use the editor directly as a standalone WebVTT audio description studio with on-device neural text-to-speech.

---

## 1. Overview

AD Script Assist supports multiple model providers, cloud and on-device neural TTS voices, and flexible video sources:

- **AI Engines**:
  - **Google Gemini**: Uses the official Google Gen AI SDK (`@google/genai`). Supports analyzing both YouTube video URLs/IDs and local video files.
  - **OpenAI ChatGPT**: Uses OpenAI's client (`openai`). Local videos are analyzed by extracting video frames and passing them as multi-modal image inputs (`gpt-4o`).
- **Cloud & Local Neural Text-to-Speech (TTS)**:
  - **Cloud Voices**: Gemini TTS (`Aoede`, `Charon`, `Fenrir`, `Kore`, `Puck`) and OpenAI TTS.
  - **Local Neural TTS (Kokoro-82M)**: Built-in on-device neural voices (`Heart`, `Bella`, `Nicole`, `Fenrir`, `Michael`, `Puck`, `Emma`, `George`) powered by [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (`kokoro-js`, Apache-2.0) running in a background Web Worker (using WebGPU `fp32` when available with automatic fallback to quantized `q8` WASM).
  - **Standalone Editor & Automatic Fallback**: Selecting any `(Kokoro Local)` voice lets you author, preview, and export audio descriptions completely offline without an API key. When a cloud voice is selected and cloud TTS fails, is unconfigured, or runs out of quota, speech synthesis automatically falls back to the local Kokoro `Heart` (`af_heart`) voice.
- **Visual Speech Status & Playback Guard**:
  - The **Script Editor** header and per-cue dots in the line-number gutter subtly indicate when speech is generating vs. ready for each cue.
  - If playback is triggered while audio description speech is still being generated, the app alerts you to wait a moment until generation finishes.
- **Video Sources & Creative IDs (CIDs)**:
  - **YouTube**: Paste a YouTube video URL or enter its 11-character video ID.
  - **Local Video**: Upload a local video file (up to 1.5GB, under 10 minutes).
- **Export Mixed Video** (local videos): Downloads an MP4 with the original video stream copied unchanged and the original audio mixed with the AD track (AAC) using WebCodecs via [Mediabunny](https://mediabunny.dev).

---

## 2. System Architecture: Client Web App + Server-Side Key & Proxy Shim (`src/server.ts`)

Originally, AD Script Assist ran 100% in the browser. It now uses a **client-heavy Lit web application paired with a lightweight Node.js server-side key & proxy shim ([`src/server.ts`](src/server.ts))**:

- **Why Client + Server Shim?**:
  1. **Google AI Studio Server-Side Policy**: Google AI Studio requires all Gemini API calls to execute on the server (`"majorCapabilities": ["MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"]` in [`metadata.json`](metadata.json)).
  2. **API Key Security**: Keeping API keys (`gemini_api_key`, `openai_api_key`) strictly on the server in `models.conf` (or server environment variables) ensures secrets are never embedded in client JavaScript bundles or exposed in browser DevTools network logs.
- **How It Works**:
  - **In the Browser (`src/web/`, `src/av/`, `src/core/`)**: Video playback, WebVTT script parsing/editing, IndexedDB project persistence, on-device Kokoro-82M WebGPU/WASM neural speech synthesis, and WebCodecs MP4 audio/video mixing all run in the browser.
  - **On the Server ([`src/server.ts`](src/server.ts), mounted by [`vite.config.ts`](vite.config.ts))**: Reads [`models.conf`](models.conf.example) and exposes two lightweight routes:
    1. `GET /api/config`: Serves the active `[providers]` and `[models]` configuration to the browser with all non-empty `[keys]` replaced by opaque placeholders (`__SERVER_KEY:<key_name>__`).
    2. `POST /api/proxy`: Accepts outbound AI/TTS requests (up to 2 GB to support 1 GB+ local video blobs), validates the target hostname (`generativelanguage.googleapis.com` or `api.openai.com`), substitutes the real API key in server memory, and executes Gemini `generateContent` calls via the official `@google/genai` SDK (`User-Agent: aistudio-build`).

---

## 3. Getting Started

You can run AD Script Assist directly in **Google AI Studio** (no local setup required) or **locally** on your machine.

### Option 1: Run in Google AI Studio (Recommended)

AD Script Assist runs directly inside Google AI Studio's App Builder:

1. **Generate an AI Studio zip archive** (excludes `node_modules/`, `dist/`, `.git/`, and local artifacts):
   ```bash
   make make-for-aistudio
   ```
   This produces `ad-script-assist-aistudio.zip` in the repository root.
2. **Import into Google AI Studio**:
   - Open [Google AI Studio](https://aistudio.google.com/) (**Build**) and start a blank project by typing `"blank project"` in the prompt.
   - When the project opens, **stop the agent** immediately so it does not overwrite files with boilerplate.
   - Attach `ad-script-assist-aistudio.zip` to the prompt and enter: `"import files"`.
3. **API Keys in AI Studio**:
   - In Google AI Studio, `src/server.ts` automatically detects the host environment's injected `GEMINI_API_KEY` (or `API_KEY`) on the server—no configuration file changes are required.

---

### Option 2: Run Locally

#### Prerequisites
- **Node.js**: Version `20.19+` or `22.12+` (required by Vite 8).
- **FFmpeg** (CLI only; the web app does not need it): Required on your native system only for the CLI's `--mix` flag with local videos and CLI frame extraction with OpenAI.

#### Installation, Configuration (`models.conf`) & Development Server
```bash
# 1. Install dependencies and create models.conf from models.conf.example
make setup
```

Open `models.conf` in any text editor to configure your AI providers, model versions, and API keys:

```ini
[providers]
# Active AI Vision / Q&A provider: gemini | openai
ai_provider = gemini

# Cloud Text-to-Speech provider when a cloud voice is selected in the UI:
#   gemini | openai
cloud_tts_provider = gemini

[models]
gemini_model = gemini-3.8-flash
openai_model = gpt-4o
gemini_tts_model = gemini-3.1-flash-tts-preview
openai_tts_model = tts-1

[keys]
gemini_api_key = YOUR_GEMINI_API_KEY
openai_api_key =
```

> **Note**: `models.conf` is git-ignored so your personal API keys are never committed (always edit `models.conf` rather than `models.conf.example`). User interface preferences—switching between **Cloud TTS** and **Kokoro (Local Browser TTS)**, selecting **Voice Language**, and customizing **Hotkeys**—remain configurable inside the in-app **Settings** dialog. Even without an API key, you can load a video, write or edit WebVTT cues in the **Script Editor**, and synthesize speech locally using Kokoro (`Heart (Kokoro Local)` or any other local voice).

#### Changing AI & Cloud TTS Providers (`models.conf`)
Because API keys and model selections are isolated on the server, switching between **Google Gemini** and **OpenAI** (or changing model IDs) is done in `models.conf`:

1. **Switch the Vision / Q&A Provider (`ai_provider`)**:
   - Set `ai_provider = gemini` (analyzes both YouTube URLs and local video files) or `ai_provider = openai` (analyzes local video files via extracted frames).
   - Provide the matching API key under `[keys]` (`gemini_api_key = ...` or `openai_api_key = ...`).
   - *(Optional)* Customize `gemini_model` (default `gemini-3.8-flash`) or `openai_model` (default `gpt-4o`) under `[models]`.
2. **Switch the Cloud Text-to-Speech Provider (`cloud_tts_provider`)**:
   - Set `cloud_tts_provider = gemini` (uses `gemini_tts_model`, default `gemini-3.1-flash-tts-preview`) or `cloud_tts_provider = openai` (uses `openai_tts_model`, default `tts-1`).
   - You can mix and match providers (for example, `ai_provider = gemini` with `cloud_tts_provider = openai`, provided both keys are set under `[keys]`).
   - Within the web UI, open **Settings** at any time to toggle **TTS Engine** between your configured **Cloud TTS** provider and **Kokoro (Local Browser TTS)**.
3. **Applying Changes**:
   - Save `models.conf` and refresh the browser page. `src/server.ts` re-reads `models.conf` on every request to `GET /api/config` and `POST /api/proxy`, so no server restart is needed.

Start the Vite development server:
```bash
# 2. Start the Vite development server at http://localhost:5173/
make dev
# (or: npm start / npm run dev)
```

#### Production Preview
```bash
make serve
# (or: npm run build && npm run preview)
```

---

## 4. Code Layout

```
├── metadata.json           # Google AI Studio app metadata (MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API)
├── models.conf.example     # Template for server-side [providers], [models], and [keys]
├── public/                 # Static assets
├── src/
│   ├── server.ts           # Node/Vite server middleware (/api/config & /api/proxy)
│   ├── ai/                 # AI Model & TTS Integrations
│   │   ├── gemini_client.ts        # Gemini API request client & key resolution
│   │   ├── openai_client.ts        # OpenAI ChatGPT request client
│   │   ├── tts_client.ts           # Cloud + Local Kokoro TTS client & fallback
│   │   ├── kokoro_tts.ts           # Local Kokoro-82M TTS coordinator
│   │   ├── kokoro_worker.ts        # Background Web Worker for Kokoro ONNX inference
│   │   ├── prompts.ts              # System templates & prompt formatting
│   │   ├── instructions.ts         # Agent system guidelines
│   │   ├── agent_response_parser.ts# Raw AI output JSON parser
│   │   └── ad_generator.ts         # Segment audio generator wrapper
│   ├── av/                 # Audio/Video Processing
│   │   ├── youtube_adapter.ts      # YouTube Iframe Player adapter
│   │   ├── local_video_adapter.ts  # HTML5 Native Video element adapter
│   │   ├── ad_audio_manager.ts     # Synchronized AD track compilation & status
│   │   ├── audio_utils.ts          # WAV header construction & OfflineAudioContext mixing
│   │   ├── video_exporter.ts       # VideoExporter interface (Export Mixed Video)
│   │   └── mediabunny_video_exporter.ts # Mediabunny implementation (MP4 + AAC via WebCodecs)
│   ├── cli/                # Command-Line Tool
│   │   ├── index.ts                # Entry point for CLI tool
│   │   └── video_utils.ts          # Frame extraction via ffmpeg command
│   ├── core/               # App State and Utilities
│   │   ├── app_state.ts            # Centralized state management (Observer pattern)
│   │   ├── ad_script_parser.ts     # WebVTT parser
│   │   ├── constants.ts            # Voices, default models, and environment key detection
│   │   ├── time_utils.ts           # Sub-second timestamp formatters
│   │   └── types.ts                # Common TypeScript type definitions
│   └── web/                # Web Application Frontend
│       ├── index.ts                # Application bundle entry point
│       ├── hotkeys.ts              # Key binding registration and handlers
│       ├── controller/
│       │   └── app_controller.ts   # Core UI orchestration, playback guard & AI calls
│       ├── storage/
│       │   ├── db.ts               # IndexedDB storage for scripts, segments, and logs
│       │   └── tts_cache.ts        # IndexedDB cache for synthesized TTS audio blobs
│       ├── utils/
│       │   └── video_frame_extractor.ts # Canvas frame extraction helper
│       └── components/             # Reusable Lit web components
│           ├── main_page.ts        # Root app layout page
│           ├── top_bar.ts          # Header toolbar
│           ├── add_video_modal.ts  # File drag-and-drop & URL input dialog
│           ├── settings_modal.ts   # TTS mode, voice language & hotkey config panel
│           ├── ad_text_area.ts     # Line-numbered WebVTT editor with per-cue speech status
│           ├── agent_chat.ts       # Message history component
│           ├── agent_input.ts      # Natural language chat textbox
│           ├── video_player.ts     # YouTube or local video container
│           ├── video_controls.ts   # Play/pause/seek controls
│           └── confirm_modal.ts    # Confirmation & alert dialogs
├── tests/
│   ├── setup_tests.ts      # Downloads & caches the NASA test video
│   ├── test_data/          # Cached test video (gitignored)
│   ├── cli/                # Terminal interface test suites
│   ├── ui/                 # Panel rendering and option persistence tests
│   └── e2e/                # Puppeteer-driven end-to-end user flow tests
├── package.json            # NPM dependencies and scripts
├── tsconfig.json           # TypeScript compilation config
├── vite.config.ts          # Vite build tool config
└── Makefile                # Build, dev, and AI Studio packaging shortcuts
```

---

## 5. Data Management

Project state and audio caches operate **client-side** in the browser (`localStorage` and `IndexedDB`), while API keys and model configurations stay on the server (`models.conf` via `src/server.ts`):

- **IndexedDB Stores**:
  - `adSegments`: Stores structured cues, start/end timestamps, and synthesized audio blobs.
  - `adScript`: Stores the latest raw WebVTT script text indexed per video ID.
  - `conversationHistory`: Stores agent chat message logs.
  - `hotkeyConfigs`: Saved keyboard shortcut mappings.
  - `ttsCache`: Caches synthesized TTS audio clips by text, voice, and speed.
- **Clearing Project Data**:
  - Click the **Clear Project** button in the top bar to wipe cached data for the active video.

---

## 6. Testing

All test suites run locally using the Node.js test runner.

### Initial Test Setup
Before running tests, download the public-domain NASA test video into `tests/test_data/` (cached after the first run, and invoked automatically by `npm run test:*`):
```bash
npm run test:setup
```

### Running the Test Suites
- **CLI Tests**:
  ```bash
  npm run test:cli
  ```
- **UI Tests**:
  ```bash
  npm run test:ui
  ```
- **E2E Tests**:
  ```bash
  npm run test:e2e
  ```

---

## 7. CLI Commands

AD Script Assist includes a CLI tool for headlessly processing videos, generating AD scripts, answering video-related questions, and mixing audio tracks.

### Usage
```bash
npx tsx src/cli/index.ts -v <id_or_url_or_path> -o <path> [options]
```

### Options
- `-v, --video <id_or_url_or_path>`: (Required) 11-character YouTube ID, full YouTube URL, or path to a local MP4 file.
- `-o, --outdir <path>`: (Required) Output directory for `script.vtt`, generated audio, or answers.
- `-m, --mix`: Mix generated TTS audio over the video (`mixed_output.mp4` for local videos via `ffmpeg`, or per-segment audio files for YouTube videos).
- `-q, --question <text>`: Ask a question about the video instead of generating an AD script (`answer.txt`).
- `-p, --provider <provider>`: Choose `gemini` (default) or `openai`.
- `-h, --help`: Show help text.

---

# Disclaimers
Eligibility for the [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security) is determined by the [Google Open Source Software Vulnerability Reward Program Rules](https://bughunters.google.com/about/rules/open-source/google-open-source-software-vulnerability-reward-program-rules).

This project is intended for demonstration purposes only. It is not
intended for use in a production environment.
