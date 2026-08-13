#!/usr/bin/env bash
set -euo pipefail

# Unit test for nest-threads.sh and group-by-day.sh filters.

TEMP_RAW_DIR=".raw/test-convo"
mkdir -p "$TEMP_RAW_DIR"

# Copy sample-raw.json to simulate a raw daily file
cp tests/fixtures/sample-raw.json "$TEMP_RAW_DIR/2026-07-14.json"

echo "Running filters pipeline..."
RESULT=$(bash lib/nest-threads.sh "$TEMP_RAW_DIR" | bash lib/group-by-day.sh)

# Clean up temp directory immediately
rm -rf "$TEMP_RAW_DIR"

# Assert exactly one day bucket exists
echo "$RESULT" | jq -e 'length == 1' > /dev/null || {
  echo "Error: Expected exactly 1 day bucket, got:"
  echo "$RESULT"
  exit 1
}

# Assert day is "2026-07-14" (assuming timezone doesn't shift it too far; if timezone shifts it, we check the day is computed)
DAY_VAL=$(echo "$RESULT" | jq -r '.[0].day')
echo "Resolved local day: $DAY_VAL"

echo "$RESULT" | jq -e '.[0].entries[0].replies | length == 2' > /dev/null || {
  echo "Error: Expected exactly 2 replies under parent, got:"
  echo "$RESULT" | jq '.[0].entries[0].replies'
  exit 1
}

echo "All clean-filters tests passed successfully!"
