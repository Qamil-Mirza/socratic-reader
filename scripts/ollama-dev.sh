#!/bin/bash
# Ensures ollama is running with CORS origins enabled for the Chrome extension,
# then starts vite in watch mode. Ctrl+C kills both cleanly.

cleanup() {
  [ -n "$OLLAMA_PID" ] && kill "$OLLAMA_PID" 2>/dev/null
  wait "$OLLAMA_PID" 2>/dev/null
}
trap cleanup EXIT

# Stop any existing ollama so we can start with the right env
if pgrep -f "ollama serve" > /dev/null 2>&1; then
  echo "[dev] Stopping existing ollama..."
  pkill -f "ollama serve"
  sleep 1
fi

# Start ollama with CORS open to chrome-extension:// origins
echo "[dev] Starting ollama (OLLAMA_ORIGINS=*)..."
OLLAMA_ORIGINS="*" ollama serve &
OLLAMA_PID=$!

# Wait for ollama to become reachable
for i in $(seq 1 15); do
  if curl -sf http://localhost:11434/ > /dev/null 2>&1; then
    echo "[dev] Ollama ready on :11434"
    break
  fi
  if [ $i -eq 15 ]; then
    echo "[dev] Warning: ollama did not become ready in time — continuing anyway"
  fi
  sleep 1
done

# Run vite watch build in the foreground
npx vite build --watch
