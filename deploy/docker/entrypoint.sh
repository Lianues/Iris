#!/bin/sh
set -e

IRIS_DATA_DIR="${IRIS_DATA_DIR:-/data}"
IRIS_PLATFORM="${IRIS_PLATFORM:-web}"
CONFIG_DIR="$IRIS_DATA_DIR/configs"
TEMPLATE_DIR="/app/data/configs.example"

# ------ First-run: initialize config from templates ------
if [ ! -d "$CONFIG_DIR" ] || [ -z "$(ls -A "$CONFIG_DIR" 2>/dev/null)" ]; then
  echo "[Iris] First run detected — initializing config directory..."

  mkdir -p "$CONFIG_DIR"

  if [ -d "$TEMPLATE_DIR" ]; then
    cp -r "$TEMPLATE_DIR"/* "$CONFIG_DIR"/
  else
    echo "[Iris] Warning: template directory not found at $TEMPLATE_DIR"
  fi

  # Patch platform.yaml for Docker networking
  PLATFORM_YAML="$CONFIG_DIR/platform.yaml"
  if [ -f "$PLATFORM_YAML" ]; then
    # Bind to all interfaces (required for Docker port mapping)
    sed -i 's/host: 127\.0\.0\.1/host: 0.0.0.0/' "$PLATFORM_YAML"
    # Set platform type
    sed -i "s/^type: console$/type: $IRIS_PLATFORM/" "$PLATFORM_YAML"
  fi

  echo "[Iris] Config initialized at $CONFIG_DIR"
  echo "[Iris] Please edit $CONFIG_DIR/llm.yaml to set your LLM API key, then restart."
fi

# ------ Safety check: warn if web host is still localhost ------
PLATFORM_YAML="$CONFIG_DIR/platform.yaml"
if [ -f "$PLATFORM_YAML" ] && grep -q 'host: 127\.0\.0\.1' "$PLATFORM_YAML" 2>/dev/null; then
  echo "[Iris] Warning: web.host is 127.0.0.1 — the web UI will not be accessible from outside the container."
  echo "[Iris] Set 'host: 0.0.0.0' in $CONFIG_DIR/platform.yaml to fix this."
fi

# ------ Start the application ------
# Console (TUI) platform requires the Bun-compiled binary
if echo "$IRIS_PLATFORM" | grep -qw "console"; then
  exec /app/bin/iris "$@"
else
  exec node --import ./esm-fix.mjs dist/index.js "$@"
fi
