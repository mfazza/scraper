#!/usr/bin/env bash
set -euo pipefail

# This script groups the nested thread structures on stdin by the parent message's
# calendar day in local time (D-16), ensuring replies are kept together on that same day.
jq 'group_by(.parent.ts | tonumber | localtime | strftime("%Y-%m-%d")) | map({ day: (.[0].parent.ts | tonumber | localtime | strftime("%Y-%m-%d")), entries: . })'
