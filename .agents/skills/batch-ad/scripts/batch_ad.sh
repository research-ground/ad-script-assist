#!/usr/bin/env bash
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -euo pipefail

CHANNEL_URL=""
IDS_FILE=""
LOCAL_DIR=""
OUT_BASE="./ad-output"
VOICE="af_heart"
TTS_PROVIDER="kokoro"
AI_PROVIDER=""
MAX_VIDEOS=""
MAX_DURATION="600"
SLEEP_SECS="5"
MAX_RETRIES="2"
RETRY_DELAY="30"
DRY_RUN="0"

usage() {
  cat <<'EOF'
Usage: batch_ad.sh [options]

Source (choose exactly one):
  --channel <url>        YouTube channel or playlist URL (uses yt-dlp to list videos)
  --ids-file <path>      Text file with one YouTube video ID or URL per line (works without yt-dlp)
  --local-dir <path>     Local directory of video files (.mp4, .mov, .webm, .mkv, .m4v)

Options:
  --outdir <path>        Base output directory (default: ./ad-output)
  --voice <name>         Kokoro/TTS voice name (default: af_heart)
  --tts <provider>       TTS provider: kokoro | gemini | openai (default: kokoro)
  --provider <provider>  AI vision provider: gemini | openai (defaults to models.conf)
  --max <n>              Maximum number of videos to process
  --max-duration <secs>  Skip videos longer than <secs> (default: 600; 0 to disable)
  --sleep <secs>         Seconds to pause between videos (default: 5)
  --dry-run              List videos that would be processed without running the CLI
  -h, --help             Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) CHANNEL_URL="$2"; shift 2 ;;
    --ids-file) IDS_FILE="$2"; shift 2 ;;
    --local-dir) LOCAL_DIR="$2"; shift 2 ;;
    --outdir) OUT_BASE="$2"; shift 2 ;;
    --voice) VOICE="$2"; shift 2 ;;
    --tts) TTS_PROVIDER="$2"; shift 2 ;;
    --provider) AI_PROVIDER="$2"; shift 2 ;;
    --max) MAX_VIDEOS="$2"; shift 2 ;;
    --max-duration) MAX_DURATION="$2"; shift 2 ;;
    --sleep) SLEEP_SECS="$2"; shift 2 ;;
    --dry-run) DRY_RUN="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

SOURCE_COUNT=0
[[ -n "$CHANNEL_URL" ]] && SOURCE_COUNT=$((SOURCE_COUNT + 1))
[[ -n "$IDS_FILE" ]] && SOURCE_COUNT=$((SOURCE_COUNT + 1))
[[ -n "$LOCAL_DIR" ]] && SOURCE_COUNT=$((SOURCE_COUNT + 1))

if (( SOURCE_COUNT != 1 )); then
  echo "Error: provide exactly one of --channel, --ids-file, or --local-dir." >&2
  usage
  exit 1
fi

extract_video_id() {
  local raw="$1"
  if [[ "$raw" =~ [?\&]v=([A-Za-z0-9_-]{11}) ]]; then
    echo "${BASH_REMATCH[1]}"
  elif [[ "$raw" =~ youtu\.be/([A-Za-z0-9_-]{11}) ]]; then
    echo "${BASH_REMATCH[1]}"
  elif [[ "$raw" =~ /shorts/([A-Za-z0-9_-]{11}) ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo "$raw"
  fi
}

HAS_FFMPEG=0
command -v ffmpeg >/dev/null 2>&1 && HAS_FFMPEG=1
HAS_FFPROBE=0
command -v ffprobe >/dev/null 2>&1 && HAS_FFPROBE=1
HAS_YTDLP=0
command -v yt-dlp >/dev/null 2>&1 && HAS_YTDLP=1

# Parallel arrays describing each queued item:
#   ITEM_INPUTS[i]  -> CLI -v argument (YouTube URL or local file path)
#   ITEM_RELOUTS[i] -> Subdirectory under OUT_BASE
#   ITEM_LABELS[i]  -> Human-readable label for logs
ITEM_INPUTS=()
ITEM_RELOUTS=()
ITEM_LABELS=()
IS_LOCAL_MODE=0

if [[ -n "$LOCAL_DIR" ]]; then
  IS_LOCAL_MODE=1
  if [[ ! -d "$LOCAL_DIR" ]]; then
    echo "Error: local directory not found: $LOCAL_DIR" >&2
    exit 1
  fi
  ABS_LOCAL_DIR="$(cd "$LOCAL_DIR" && pwd)"
  while IFS= read -r -d '' filepath; do
    if [[ "$MAX_DURATION" != "0" && "$HAS_FFPROBE" == "1" ]]; then
      dur="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$filepath" 2>/dev/null || true)"
      if [[ "$dur" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
        dur_int="${dur%%.*}"
        if (( dur_int > MAX_DURATION )); then
          echo "Skipping (>${MAX_DURATION}s): $filepath (${dur_int}s)"
          continue
        fi
      fi
    fi
    rel="${filepath#"$ABS_LOCAL_DIR"/}"
    rel_no_ext="${rel%.*}"
    ITEM_INPUTS+=("$filepath")
    ITEM_RELOUTS+=("$rel_no_ext")
    ITEM_LABELS+=("$rel")
    echo "Queued: $rel"
    if [[ -n "$MAX_VIDEOS" && "${#ITEM_INPUTS[@]}" -ge "$MAX_VIDEOS" ]]; then
      break
    fi
  done < <(find "$ABS_LOCAL_DIR" -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.webm' -o -iname '*.mkv' -o -iname '*.m4v' \) -print0 | sort -z)
elif [[ -n "$IDS_FILE" ]]; then
  if [[ ! -f "$IDS_FILE" ]]; then
    echo "Error: IDs file not found: $IDS_FILE" >&2
    exit 1
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="$(echo "$line" | sed 's/#.*//' | xargs)"
    [[ -z "$trimmed" ]] && continue
    vid="$(extract_video_id "$trimmed")"
    ITEM_INPUTS+=("https://www.youtube.com/watch?v=$vid")
    ITEM_RELOUTS+=("$vid")
    ITEM_LABELS+=("$vid")
    echo "Queued: $vid"
    if [[ -n "$MAX_VIDEOS" && "${#ITEM_INPUTS[@]}" -ge "$MAX_VIDEOS" ]]; then
      break
    fi
  done < "$IDS_FILE"
else
  if [[ "$HAS_YTDLP" != "1" ]]; then
    echo "Error: yt-dlp is required to list videos from --channel. Pass --ids-file instead or install yt-dlp." >&2
    exit 1
  fi
  while IFS=$'\t' read -r vid dur title; do
    [[ -z "$vid" ]] && continue
    if [[ "$MAX_DURATION" != "0" ]]; then
      if [[ ! "$dur" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
        continue
      fi
      dur_int="${dur%%.*}"
      if (( dur_int <= 0 || dur_int > MAX_DURATION )); then
        continue
      fi
    fi
    ITEM_INPUTS+=("https://www.youtube.com/watch?v=$vid")
    ITEM_RELOUTS+=("$vid")
    ITEM_LABELS+=("$vid ($title)")
    echo "Queued: $vid (${dur}s) - $title"
    if [[ -n "$MAX_VIDEOS" && "${#ITEM_INPUTS[@]}" -ge "$MAX_VIDEOS" ]]; then
      break
    fi
  done < <(yt-dlp --flat-playlist --print "%(id)s	%(duration)s	%(title)s" "$CHANNEL_URL")
fi

TOTAL="${#ITEM_INPUTS[@]}"
echo "Found $TOTAL video(s) to process."
if [[ "$DRY_RUN" == "1" || "$TOTAL" == "0" ]]; then
  exit 0
fi

CAN_MUX_MP4=0
if [[ "$IS_LOCAL_MODE" == "1" && "$HAS_FFMPEG" == "1" ]]; then
  CAN_MUX_MP4=1
elif [[ "$IS_LOCAL_MODE" == "0" && "$HAS_YTDLP" == "1" && "$HAS_FFMPEG" == "1" ]]; then
  CAN_MUX_MP4=1
fi

mkdir -p "$OUT_BASE"
FAIL_LOG="$OUT_BASE/failures.log"

SUCCEEDED=0
SKIPPED=0
FAILED=0

for (( i = 0; i < TOTAL; i++ )); do
  INPUT="${ITEM_INPUTS[$i]}"
  RELOUT="${ITEM_RELOUTS[$i]}"
  LABEL="${ITEM_LABELS[$i]}"
  OUT_DIR="$OUT_BASE/$RELOUT"

  EXPECTED_FILE="$OUT_DIR/ad_track.wav"
  if [[ "$CAN_MUX_MP4" == "1" ]]; then
    EXPECTED_FILE="$OUT_DIR/mixed_output.mp4"
  fi

  if [[ -s "$EXPECTED_FILE" ]]; then
    echo "[SKIP] $LABEL ($EXPECTED_FILE already exists)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "=== [$((i + 1))/$TOTAL] Processing $LABEL -> $OUT_DIR ==="
  CLI_ARGS=(-v "$INPUT" -o "$OUT_DIR" --mix --tts "$TTS_PROVIDER" --voice "$VOICE")
  if [[ -n "$AI_PROVIDER" ]]; then
    CLI_ARGS+=(-p "$AI_PROVIDER")
  fi

  ATTEMPT=0
  SUCCESS=0
  while (( ATTEMPT <= MAX_RETRIES )); do
    if npx tsx src/cli/index.ts "${CLI_ARGS[@]}"; then
      SUCCESS=1
      break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    if (( ATTEMPT <= MAX_RETRIES )); then
      echo "[RETRY] $LABEL failed (attempt $ATTEMPT/$MAX_RETRIES); waiting ${RETRY_DELAY}s..."
      sleep "$RETRY_DELAY"
    fi
  done

  if [[ "$SUCCESS" == "1" ]]; then
    SUCCEEDED=$((SUCCEEDED + 1))
  else
    echo "[FAIL] $LABEL ($INPUT)" | tee -a "$FAIL_LOG"
    FAILED=$((FAILED + 1))
  fi

  if (( SLEEP_SECS > 0 && i + 1 < TOTAL )); then
    sleep "$SLEEP_SECS"
  fi
done

echo ""
echo "Batch complete: succeeded=$SUCCEEDED skipped=$SKIPPED failed=$FAILED"
echo "Output directory: $OUT_BASE"
if (( FAILED > 0 )); then
  echo "Failed items logged to: $FAIL_LOG"
  exit 1
fi
