#!/bin/bash
set -e

echo "[Startup] Starting Xvfb on display :99..."
Xvfb :99 -screen 0 1280x720x24 -ac &
XVFB_PID=$!
sleep 2

export DISPLAY=:99

echo "[Startup] Starting fluxbox window manager..."
fluxbox &
sleep 1

echo "[Startup] Starting x11vnc on port 5900..."
x11vnc -display :99 -forever -nopw -rfbport 5900 -shared &
sleep 1

if command -v websockify &> /dev/null; then
    echo "[Startup] Starting noVNC on port 6080..."
    websockify --web /usr/share/novnc/ 6080 localhost:5900 &
else
    echo "[Startup] websockify not found, skipping noVNC"
fi

echo "[Startup] Starting ClaudeProxy server..."
exec node node_modules/tsx/dist/cli.mjs src/index.ts
