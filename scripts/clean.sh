#!/usr/bin/env bash
set -euo pipefail

# Orchestrates the full cleaning pipeline for each specified conversation slug.
# Flow: nest-threads.sh -> group-by-day.sh -> render-markdown.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$(cd "$SCRIPT_DIR/../lib" && pwd)"

for slug in "$@"; do
  if [ -z "$slug" ]; then
    continue
  fi

  raw_dir=".raw/$slug"
  if [ ! -d "$raw_dir" ] || [ -z "$(ls "$raw_dir"/*.json 2>/dev/null)" ]; then
    echo "No raw data found for '$slug' under .raw/ — skipping clean."
    continue
  fi

  echo "Cleaning and generating markdown for '$slug'..."
  mkdir -p "raw/$slug"

  # Pipe raw files through the nesting and bucketing filters.
  bucketed_data=$(bash "$LIB_DIR/nest-threads.sh" "$raw_dir" | bash "$LIB_DIR/group-by-day.sh")

  # Generate individual daily markdown files.
  echo "$bucketed_data" | jq -c '.[]' | while read -r line; do
    if [ -z "$line" ]; then
      continue
    fi

    day=$(echo "$line" | jq -r '.day')
    
    # Overwrite the daily markdown file completely to guarantee determinism.
    echo "$line" | npx tsx "$SCRIPT_DIR/resolve-mentions.ts" | bash "$LIB_DIR/render-markdown.sh" "$slug" "$day" > "raw/$slug/$day.md"
    echo "  -> Generated raw/$slug/$day.md"
  done
done

echo "Cleaning stage finished."
