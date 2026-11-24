---
name: batch-ad
description: >-
  Batch-generate audio descriptions (AD) for YouTube channels, YouTube
  playlists/URL lists, or local folders of video files using the
  ad-script-assist CLI and local Kokoro neural TTS. Use this skill when the
  user wants to process multiple videos and produce AD scripts (script.vtt),
  time-aligned AD audio tracks (ad_track.wav), or muxed audio-described MP4
  videos (mixed_output.mp4).
---

# Batch Audio Description Workflow (`batch-ad`)

Use this runbook to set up prerequisites and batch-generate audio-described
outputs for either **YouTube sources** (channel, playlist, or URL/ID list) or
**local video folders** (`.mp4`, `.mov`, `.webm`, `.mkv`, `.m4v`) using the
`ad-script-assist` CLI (`src/cli/index.ts`) and local on-device Kokoro TTS.

## Outputs Per Video

Each processed video writes to `<outdir>/<video_id_or_relpath>/`:

- `script.vtt` — timed WebVTT audio description script (generated via Gemini or
  OpenAI)
- `ad_track.wav` — single time-aligned 24 kHz mono WAV track (compiled in pure
  Node; requires **no** `ffmpeg` or `yt-dlp`)
- `mixed_output.mp4` — video with AD narration mixed over ducked original audio
  (generated automatically for local videos when `ffmpeg` is installed, and for
  YouTube videos when **both** `yt-dlp` and `ffmpeg` are installed on `PATH`)

## Step 1: Verify Prerequisites

1. **Node.js & dependencies (required)**:
   - Verify `node -v` is `>= 20.19` (or `>= 22.12`). Install Node.js if missing.
   - If `node_modules/` does not exist in the repository root, run `npm install`
     (never use `bun`, `yarn`, or `pnpm`).
2. **Optional / video-muxing tools (`ffmpeg` and `yt-dlp`)**:
   - Check `which ffmpeg yt-dlp`.
   - For **local videos with `--mix`**: `ffmpeg` is required to mux
     `mixed_output.mp4` (and to extract frames if `--provider openai` is used).
   - For **YouTube videos with `--mix`**:
     - With `yt-dlp` + `ffmpeg`: downloads each video and outputs `script.vtt`,
       `ad_track.wav`, and `mixed_output.mp4`.
     - Without `yt-dlp` or `ffmpeg`: still works in pure Node and outputs
       `script.vtt` + `ad_track.wav`.
   - Install any needed missing tools (e.g., `brew install yt-dlp ffmpeg` on
     macOS, `apt install ffmpeg` + `yt-dlp` on Linux, or `winget` on Windows).
3. **API key (required for video analysis)**:
   - Check whether `GEMINI_API_KEY` (or `OPENAI_API_KEY` if using OpenAI) is
     set in the environment or configured under `[keys]` in `models.conf`
     (never print or echo keys).
   - If missing, ask the user for their API key, then run:
     ```bash
     git update-index --skip-worktree models.conf
     ```
     and set `gemini_api_key = <key>` (or `openai_api_key = <key>`) under
     `[keys]` in `models.conf`.
   - Do **not** modify `[models]` in `models.conf` unless the user explicitly
     requests a specific model.
   - Kokoro TTS (`--tts kokoro`) runs locally on-device and needs no TTS API
     key or cloud TTS quota.

## Step 2: Discover Videos & Confirm Scope

Preview the batch with `--dry-run` and confirm the list, voice, and output
directory with the user before starting:

- **YouTube channel or playlist (requires `yt-dlp`)**:
  ```bash
  bash .agents/skills/batch-ad/scripts/batch_ad.sh \
    --channel "<CHANNEL_OR_PLAYLIST_URL>" \
    --max 10 \
    --max-duration 600 \
    --dry-run
  ```
- **YouTube URL/ID list (works without `yt-dlp`)**:
  - Put one YouTube video ID or URL per line in a text file (or fetch the
    latest 15 uploads from a channel's public RSS feed at
    `https://www.youtube.com/feeds/videos.xml?channel_id=<CHANNEL_ID>`), then
    preview with `--ids-file <path> --dry-run`.
- **Local folder of videos**:
  ```bash
  bash .agents/skills/batch-ad/scripts/batch_ad.sh \
    --local-dir "<PATH_TO_VIDEOS_DIR>" \
    --max-duration 600 \
    --dry-run
  ```

Filter recommendations:
- Prefer videos **under 10 minutes** (`--max-duration 600`) for reliable video
  analysis.
- Skip livestreams (`duration` missing/0) unless requested.

### Available Kokoro Voices (`--voice`)

- US English: `af_heart` *(default)*, `af_bella`, `af_nicole`, `am_fenrir`,
  `am_michael`, `am_puck`
- UK English: `bf_emma`, `bm_george`

## Step 3: Run the Batch

Run the bundled resumable script from the repository root:

```bash
# YouTube channel / playlist
bash .agents/skills/batch-ad/scripts/batch_ad.sh \
  --channel "<CHANNEL_OR_PLAYLIST_URL>" \
  --outdir "./ad-output" \
  --max 5 \
  --max-duration 600 \
  --voice af_heart

# YouTube ID/URL list (works with or without yt-dlp)
bash .agents/skills/batch-ad/scripts/batch_ad.sh \
  --ids-file "./video_ids.txt" \
  --outdir "./ad-output" \
  --voice af_heart

# Local folder of videos
bash .agents/skills/batch-ad/scripts/batch_ad.sh \
  --local-dir "./videos" \
  --outdir "./ad-output" \
  --voice af_heart
```

Or invoke the CLI directly for any single video:

```bash
npx tsx src/cli/index.ts \
  -v "<YOUTUBE_URL_OR_LOCAL_VIDEO_PATH>" \
  -o "./ad-output/<NAME>" \
  --mix \
  --tts kokoro \
  --voice af_heart
```

### Resumability & Rate-Limit Handling

- Skips any video whose expected final artifact already exists
  (`mixed_output.mp4` when muxing is available, or `ad_track.wav` otherwise).
- Paces requests (`--sleep 5` by default) to respect API rate limits.
- Retries transient failures (e.g., `429` / `503`) up to 2 times with a 30s
  backoff, logs persistent failures to `<outdir>/failures.log`, and continues
  with the remaining videos.

## Step 4: Validate & Summarize

After the batch finishes:

1. Verify each completed video folder contains non-empty `script.vtt` and
   `ad_track.wav` (plus `mixed_output.mp4` when video muxing ran).
2. Optionally inspect a sample `mixed_output.mp4` or `ad_track.wav` with
   `ffprobe` (if installed) to confirm valid duration and audio streams.
3. Present a concise summary table listing each video, status
   (succeeded / skipped / failed), and output paths, plus any entries in
   `<outdir>/failures.log`.
