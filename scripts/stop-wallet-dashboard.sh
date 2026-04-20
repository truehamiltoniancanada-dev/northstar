#!/usr/bin/env bash
set -euo pipefail
pkill -f "python3 -m http.server 4173 --directory dist" || true
pkill -f "vite --host 0.0.0.0" || true
echo "Wallet dashboard stopped."
