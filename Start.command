#!/bin/bash
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required: https://nodejs.org/"
  read -r -p "Press Enter to close..."
  exit 1
fi

npm run web
status=$?
if [ "$status" -ne 0 ]; then
  read -r -p "Press Enter to close..."
fi
exit "$status"
