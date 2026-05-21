#!/bin/bash
set -e

echo "[Startup] Starting Xvfb on display :99..."
Xvfb :99 -screen 0 1280x720x16 -ac &
sleep 2

export DISPLAY=:99

echo "[Startup] Starting ClaudeProxy server..."
exec node node_modules/tsx/dist/cli.mjs src/index.ts
