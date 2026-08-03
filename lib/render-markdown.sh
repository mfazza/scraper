#!/usr/bin/env bash
set -euo pipefail

# This script accepts a conversation name ($1) and a date ($2), reads a single day
# bucket JSON object on stdin, and renders a day-organized markdown file (D-11/D-13/D-15).

CONV_NAME="${1:-}"
DATE_STR="${2:-}"

if [ -z "$CONV_NAME" ] || [ -z "$DATE_STR" ]; then
  echo "Error: conversation name and date string are required" >&2
  exit 1
fi

jq -r --arg conv "$CONV_NAME" --arg date "$DATE_STR" '
  "# \($conv) — \($date)\n\n" +
  (
    .entries | map(
      "**" + .parent.author + "** · " + (if (.parent.permalink | length) > 0 then "[" + (.parent.ts | tonumber | localtime | strftime("%H:%M")) + "](" + .parent.permalink + ")" else (.parent.ts | tonumber | localtime | strftime("%H:%M")) end) + "\n" +
      .parent.text + (if .parent.edited then " (edited)" else "" end) +
      (if (.parent.files | length) > 0 then "\n" + (.parent.files | map(if (.filename | length) > 0 then "[Attachment: " + .filename + "](" + .url + ")" else "[Attachment](" + .url + ")" end) | join("\n")) else "" end) + "\n" +
      (
        if (.replies | length) > 0 then
          "\n" + (
            .replies | map(
              "> **" + .author + "** · " + (if (.permalink | length) > 0 then "[" + (.ts | tonumber | localtime | strftime("%H:%M")) + "](" + .permalink + ")" else (.ts | tonumber | localtime | strftime("%H:%M")) end) + "\n" +
              "> " + (
                ((.text + (if .edited then " (edited)" else "" end)) +
                (if (.files | length) > 0 then "\n" + (.files | map(if (.filename | length) > 0 then "[Attachment: " + .filename + "](" + .url + ")" else "[Attachment](" + .url + ")" end) | join("\n")) else "" end)) | gsub("\n"; "\n> ")
              ) + "\n"
            ) | join("\n")
          )
        else
          ""
        end
      )
    ) | join("\n\n")
  )
'
