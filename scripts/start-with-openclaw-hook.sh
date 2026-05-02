#!/usr/bin/env bash

# Start the Node HTTP server in the background
node server.js &
SERVER_PID=$!

echo "Waiting for server to be healthy..."
while ! curl -s http://127.0.0.1:${PORT:-8787}/api/health | grep -q '"ok":true'; do
  sleep 1
done

echo "Server is healthy. Running notify hook..."
node ./scripts/notify-openclaw-build.mjs

# Wait for the server process to keep the container running
wait $SERVER_PID
