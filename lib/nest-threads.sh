#!/usr/bin/env bash
set -euo pipefail

# This script accepts a raw directory containing daily JSON files and groups
# messages into threads based on the ts == threadId self-reference convention.
RAW_DIR="${1:-}"

if [ -z "$RAW_DIR" ]; then
  echo "Error: raw directory path is required" >&2
  exit 1
fi

if [ ! -d "$RAW_DIR" ] || [ -z "$(ls "$RAW_DIR"/*.json 2>/dev/null)" ]; then
  echo "[]"
  exit 0
fi

jq -s 'add | group_by(.threadId) | map({ parent: (.[] | select(.ts == .threadId)), replies: (map(select(.ts != .threadId)) | sort_by(.ts)) })' "$RAW_DIR"/*.json
