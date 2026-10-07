# AD Script Assist

AD Script Assist is a web-based, AI-driven interactive helper for creating and editing audio descriptions (AD) for videos. It helps users generate initial AD scripts and refine them through a natural language chat interface with an AI agent. The application dynamically generates and syncs a text-to-speech (TTS) audio track with the video, adjusting speeds to fit allotted times, and exports a final mixed AD track.

---

## 1. Overview

AD Script Assist supports multiple model providers and video sources to provide a seamless audio description generation workflow:

- **AI Engines**:
  - **Google Gemini**: Uses the official Google Gen AI SDK (`@google/genai`). It supports analyzing both YouTube video URLs/IDs and local video files.
  - **OpenAI ChatGPT**: Uses OpenAI's client (`openai`). Since OpenAI does not natively support YouTube video URLs, local videos are analyzed by extracting video frames and passing them as multi-modal image inputs (`gpt-4o`).
- **Video Sources & Creative IDs (CIDs)**:
  - **YouTube**: Paste a YouTube video URL or enter its 11-character video ID. The video ID acts as the project identifier (CID) in storage.
  - **Local Video**: Upload a local video file (up to 75MB, under 10 minutes). The file's name prefixed with `local_` (e.g., `local_my-ad-creative.mp4`) is used as the project identifier (CID) in storage.
- **Dynamic TTS Audio Generation**:
  - Highlights modified cues in a line-numbered WebVTT script editor.
  - Generates TTS audio clips for modified sections on-the-fly.
  - Compiles silent pads and audio clips into a single, synchronized track.
- **Export Mixed Video** (local videos): Downloads an MP4 with the original video stream copied unchanged and the original audio mixed with the AD track (AAC). Uses the browser's WebCodecs AAC encoder via [Mediabunny](https://mediabunny.dev), so it works in Chrome (macOS/Windows) and recent Safari.

---

## 2. Code Layout

The project is structured as follows:

```
├── public/                 # Static assets (icons, manifest)
├── src/
│   ├── ai/                 # AI Model Integrations
│   │   ├── gemini_client.ts        # Gemini API request client
│   │   ├── openai_client.ts        # OpenAI ChatGPT request client
│   │   ├── tts_client.ts           # Speech generation client
│   │   ├── prompts.ts              # System templates & prompt formatting
│   │   ├── instructions.ts         # Agent system guidelines & tools
│   │   ├── agent_response_parser.ts# Raw AI output JSON parser
│   │   └── ad_generator.ts         # Wrapper to generate scripts
│   ├── av/                 # Audio/Video Processing
│   │   ├── youtube_adapter.ts      # YouTube Iframe Player adapter
│   │   ├── local_video_adapter.ts  # HTML5 Native Video element adapter
│   │   ├── ad_audio_manager.ts     # Synchronized AD track playback controller
│   │   ├── audio_utils.ts          # Pitch/speed shift, silent pads, track compilation
│   │   ├── video_exporter.ts       # VideoExporter interface (Export Mixed Video)
│   │   └── mediabunny_video_exporter.ts # Mediabunny implementation (MP4 + AAC via WebCodecs)
│   ├── cli/                # Command-Line Tool
│   │   ├── index.ts                # Entry point for CLI tool
│   │   └── video_utils.ts          # Frame extraction via ffmpeg command
│   ├── core/               # App State and Utilities
│   │   ├── app_state.ts            # Centralized state management (Observer pattern)
│   │   ├── ad_script_parser.ts     # WebVTT parser
│   │   ├── constants.ts            # Voice selections, styles, default models
│   │   ├── time_utils.ts           # Sub-second timestamp formatters
│   │   └── types.ts                # Common TypeScript type definitions
│   └── web/                # Web Application Frontend
│       ├── index.ts                # Application bundle entry point
│       ├── service-worker.ts       # Service worker configuration
│       ├── hotkeys.ts              # Key binding registration and handlers
│       ├── controller/
│       │   └── app_controller.ts   # Core UI orchestration & backend client calls
│       ├── storage/
│       │   └── db.ts               # LocalStorage wrapper (SimpleDB)
│       ├── utils/
│       │   └── video_frame_extractor.ts# Canvas frame extraction helper
│       └── components/             # Reusable Lit web components
│           ├── main_page.ts        # Root app layout page
│           ├── top_bar.ts          # Header options
│           ├── add_video_modal.ts  # File drag-and-drop & URL input dialog
│           ├── settings_modal.ts   # API Key & model config panel
│           ├── ad_text_area.ts     # Line-numbered WebVTT script editor
│           ├── agent_chat.ts       # Message history component
│           ├── agent_input.ts      # Natural language chat textbox
│           ├── video_player.ts     # YouTube or local video container
│           ├── video_controls.ts   # Native layout play/pause/slider
│           ├── debug_panel.ts      # Real-time state / log monitor
│           └── confirm_modal.ts    # Action validation dialogs
├── tests/
│   ├── setup_tests.ts      # Downloads & caches the NASA test video
│   ├── test_data/          # Cached test video (gitignored)
│   ├── cli/                # Terminal interface test suites
│   ├── ui/                 # Panel rendering and option persistence tests
│   └── e2e/                # Puppeteer-driven end-to-end user flow tests
├── package.json            # NPM dependencies and run scripts
├── tsconfig.json           # TypeScript compilation config
├── vite.config.ts          # Vite build tool config
└── Makefile                # Build/Dev shortcuts
```

---

## 3. Setup

### Prerequisites
- **Node.js**: Version `20.0.0` or higher.
- **FFmpeg** (CLI only; the web app doesn't need it): Required on your native system for two CLI features with local videos: `--mix` (creates `mixed_output.mp4`) and the OpenAI provider (extracts still frames for GPT-4o).

### Installation
Clone the repository and install packages:
```bash
npm install
```

### Running Locally
To launch the Vite development server with hot-module replacement (HMR):
```bash
npm run dev
# Or using the Makefile:
make dev
```
The application will run by default at `http://localhost:5173/`.

### Production Preview
To compile the application bundle and preview the optimized build:
```bash
npm run build
npm run preview
# Or using the Makefile:
make serve
```

### App API Configurations
1. Open the application in your browser.
2. Click the **Settings** icon in the top header.
3. Paste your **Gemini API Key** and/or **OpenAI API Key**.
4. Select your preferred **LLM Provider** (Gemini is the default).
5. These configurations are saved persistently inside your browser and used for all requests.

---

## 4. Data Management

The application operates entirely **client-side**; there is no background database server or cloud metadata store. All persistent user data is managed in the browser's `localStorage` via a lightweight database table abstraction:

- **Tables**:
  - `adSegments`: Stores structured cues, start/end timestamps, and active voice parameters.
  - `adScript`: Stores the latest raw WebVTT script file text indexed per Creative ID (CID).
  - `conversationHistory`: Stores the agent chat message logs.
  - `geminiLogs`: Debug logs of API payloads.
  - `hotkeyConfigs`: Saved keyboard shortcut key-mappings.
- **Clearing Project Data**:
  - You can clear data for the current video by clicking the **Clear Project** (trash bin) button in the Top Bar.
  - Wiping browser `localStorage` or application cache will fully reset all settings and scripts.

---

## 5. Testing

All test suites run locally using standard Node.js test runner commands.

### Initial Test Setup
Before running the tests, run the setup script to download the test video (a public-domain NASA clip) into `tests/test_data/` (gitignored). It is cached after the first run, and the `test:*` scripts run it automatically:
```bash
npm run test:setup
```

### Running the Test Suites
- **CLI Tests**: Runs headless terminal command tests.
  ```bash
  npm run test:cli
  ```
- **UI Tests**: Verifies component rendering and settings modal persistence using Puppeteer.
  ```bash
  npm run test:ui
  ```
- **E2E Tests**: Simulates screen reader accessibility, tab key navigations, and user actions.
  ```bash
  npm run test:e2e
  ```

> [!NOTE]
> The UI and E2E tests automatically run a production build (`npm run build`) and spin up a local preview server on `http://localhost:5173` using Puppeteer, so you do **not** need to have the Vite dev server running in another terminal.

---

## 6. CLI Commands

AD Script Assist includes a CLI tool for headlessly processing videos, generating AD scripts, answering video-related questions, and mixing audio tracks.

### Usage
```bash
npx tsx src/cli/index.ts -v <id_or_url_or_path> -o <path> [options]
```

### Options
- `-v, --video <id_or_url_or_path>`: (Required) The 11-char YouTube ID, a full YouTube URL, or path to a local MP4 file.
- `-o, --outdir <path>`: (Required) Directory where output files (`script.vtt`, generated audio, answers) will be saved.
- `-m, --mix`: Mix the generated TTS audio over the video.
  - *Local videos*: Outputs a fully combined `mixed_output.mp4` with audio mixed over video (requires system `ffmpeg`).
  - *YouTube videos*: Generates and outputs individual `.mp3` audio files for all segments.
- `-q, --question <text>`: Ask a question about the video instead of generating a full audio description script. The answer is printed and saved to `answer.txt`.
- `-p, --provider <provider>`: Choose `gemini` (default) or `openai`.
- `-h, --help`: Show help text.

### Example
Generate a WebVTT script and individual TTS audio clips for a YouTube video using Gemini:
```bash
export GEMINI_API_KEY="your_api_key"
npx tsx src/cli/index.ts -v "https://www.youtube.com/watch?v=W85oD8FEF78" -o ./dist/cli-output -m
```

# Disclaimers
Eligibility for the [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security) is determined by the [Google Open Source Software Vulnerability Reward Program Rules](https://bughunters.google.com/about/rules/open-source/google-open-source-software-vulnerability-reward-program-rules).

This project is intended for demonstration purposes only. It is not
intended for use in a production environment.