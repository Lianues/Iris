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

  echo "[Iris] Config initialized at $CONFIG_DIR"
  echo "[Iris] Please edit $CONFIG_DIR/llm.yaml to set your LLM API key, then restart."
fi

# ------ Docker networking: ensure web binds to all interfaces ------
# Platform type is overridden by IRIS_PLATFORM env var at runtime (no need to patch yaml).
# But web.host must be 0.0.0.0 for Docker port mapping to work.
PLATFORM_YAML="$CONFIG_DIR/platform.yaml"
if [ -f "$PLATFORM_YAML" ] && grep -q 'host: 127\.0\.0\.1' "$PLATFORM_YAML" 2>/dev/null; then
  sed -i 's/host: 127\.0\.0\.1/host: 0.0.0.0/' "$PLATFORM_YAML"
  echo "[Iris] Patched web.host to 0.0.0.0 for Docker networking"
fi

# ------ Deploy TUI binary + runtime to host ------
# The iris binary uses resolveProjectRoot() to locate data/ and extensions/
# relative to the binary (../data, ../extensions from bin/).
# /host-lib provides the full directory structure; /host-bin gets symlinks.
if [ -d /host-lib ] && [ -w /host-lib ]; then
  # Deploy full runtime structure into /host-lib/iris/
  IRIS_HOST_DIR="/host-lib/iris"
  mkdir -p "$IRIS_HOST_DIR/bin"

  for bin in iris iris-onboard; do
    if [ -f "/app/bin/$bin" ]; then
      cp "/app/bin/$bin" "$IRIS_HOST_DIR/bin/$bin"
      chmod +x "$IRIS_HOST_DIR/bin/$bin"
    fi
  done

  # Copy runtime dirs that resolveProjectRoot() expects next to bin/
  for dir in data extensions; do
    if [ -d "/app/$dir" ]; then
      rm -rf "$IRIS_HOST_DIR/$dir"
      cp -a "/app/$dir" "$IRIS_HOST_DIR/$dir"
    fi
  done

  # OpenTUI tree-sitter runtime (bin/opentui/)
  if [ -d "/app/bin/opentui" ]; then
    rm -rf "$IRIS_HOST_DIR/bin/opentui"
    cp -a "/app/bin/opentui" "$IRIS_HOST_DIR/bin/opentui"
  fi

  echo "[Iris] Runtime deployed to host: $IRIS_HOST_DIR"

  # Create symlinks in /host-bin pointing to the deployed binaries.
  # IRIS_HOST_LIB_DIR tells us the real host path of /host-lib (default: /usr/local/lib).
  IRIS_HOST_LIB_DIR="${IRIS_HOST_LIB_DIR:-/usr/local/lib}"
  if [ -d /host-bin ] && [ -w /host-bin ]; then
    for bin in iris iris-onboard; do
      if [ -f "$IRIS_HOST_DIR/bin/$bin" ]; then
        ln -sf "$IRIS_HOST_LIB_DIR/iris/bin/$bin" "/host-bin/$bin"
      fi
    done
    echo "[Iris] Symlinks created in /host-bin -> $IRIS_HOST_LIB_DIR/iris/bin/"
  fi
elif [ -d /host-bin ] && [ -w /host-bin ]; then
  # Fallback: legacy mode — copy binaries only (extensions won't be available)
  for bin in iris iris-onboard; do
    if [ -f "/app/bin/$bin" ]; then
      cp "/app/bin/$bin" "/host-bin/$bin"
      chmod +x "/host-bin/$bin"
    fi
  done
  echo "[Iris] TUI binaries deployed to host (legacy mode, no extensions)"
  echo "[Iris] Tip: mount /host-lib to deploy the full runtime structure"
fi

# ------ Drop privileges for the main process ------
# entrypoint runs as root (for /host-bin write access), then drops to a non-root user.
# Detect available user: 'node' (production image) or 'pwuser' (Playwright image)
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  if id node >/dev/null 2>&1; then
    RUN_USER=node
  elif id pwuser >/dev/null 2>&1; then
    RUN_USER=pwuser
  else
    RUN_USER=""
  fi
  if [ -n "$RUN_USER" ]; then
    chown -R "$RUN_USER" "$IRIS_DATA_DIR" 2>/dev/null || true
    RUN_AS="setpriv --reuid=$RUN_USER --regid=$RUN_USER --init-groups --"
  fi
fi

# ------ Start the application ------
# Console (TUI) platform requires the Bun-compiled binary
if echo "$IRIS_PLATFORM" | grep -qw "console"; then
  exec $RUN_AS /app/bin/iris "$@"
else
  exec $RUN_AS node --import ./esm-fix.mjs dist/src/index.js "$@"
fi
