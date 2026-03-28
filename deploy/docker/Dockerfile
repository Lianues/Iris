# ============================================================
# Iris — Multi-stage Docker build
# ============================================================
# Targets:
#   production    (default)  — Node 22 Debian slim + Bun 编译 TUI, ~400 MB
#   computer-use  (optional) — Ubuntu + Playwright/Chromium, ~900 MB
#
# Build:
#   docker build -t iris .                                  # production
#   docker build -t iris-cu --target computer-use-base .    # with Playwright
# ============================================================

# ------ Stage 1: Install ALL dependencies (incl. devDeps for tsc) ------
FROM node:22-slim AS deps
WORKDIR /app

# Native addon build tools (better-sqlite3, sharp, node-pty)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ libvips-dev && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Prepare web-ui directory for its own package.json
RUN mkdir -p src/platforms/web/web-ui
COPY src/platforms/web/web-ui/package.json src/platforms/web/web-ui/

RUN npm install --legacy-peer-deps
RUN cd src/platforms/web/web-ui && npm install


# ------ Stage 2: Build Vue 3 Web UI (Vite) ------
FROM deps AS build-ui
COPY src/platforms/web/web-ui/ src/platforms/web/web-ui/
RUN cd src/platforms/web/web-ui && npm run build


# ------ Stage 3: Compile TypeScript ------
FROM deps AS build
COPY src/ src/
COPY tsconfig.json tsconfig.build.json ./
COPY data/ data/
# Overlay pre-built web-ui into source tree
COPY --from=build-ui /app/src/platforms/web/web-ui/dist/ src/platforms/web/web-ui/dist/
RUN npx tsc -p tsconfig.build.json
# Strip devDependencies — production image only needs runtime deps
RUN npm prune --omit=dev


# ------ Stage 4: Compile standalone binary with Bun (TUI + onboard) ------
FROM deps AS bun-compile

# Install Bun (needed for bun build --compile; npm is already available from deps)
RUN npm install -g bun
# OpenTUI React dependency — must be installed via npm to avoid incomplete package
RUN npm install --no-save react-devtools-core

COPY src/ src/
COPY tsconfig.json tsconfig.build.json ./
COPY data/ data/
COPY script/build.ts script/build.ts
COPY onboard/ onboard/
# Overlay pre-built web-ui
COPY --from=build-ui /app/src/platforms/web/web-ui/dist/ src/platforms/web/web-ui/dist/

# Compile standalone binary for current platform (linux-x64)
# build.ts internally runs: bun install --os="*" --cpu="*" @opentui/core
RUN bun run script/build.ts --single


# ------ Stage 5: Production image (default target) ------
FROM node:22-slim AS production

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Compiled JS
COPY --from=build /app/dist/ dist/
# Runtime dependencies only (devDeps pruned in build stage)
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/package.json .
# Config templates for first-run init
COPY --from=build /app/data/ data/
# Web UI static files — resolvePublicDir() checks cwd/src/platforms/web/web-ui/dist
COPY --from=build-ui /app/src/platforms/web/web-ui/dist/ src/platforms/web/web-ui/dist/
# Bun-compiled binaries (TUI + onboard)
COPY --from=bun-compile /app/dist/bin/iris-linux-x64/bin/iris bin/iris
COPY --from=bun-compile /app/dist/bin/iris-linux-x64/bin/iris-onboard bin/iris-onboard
RUN chmod +x bin/iris bin/iris-onboard
# Entrypoint script
COPY deploy/docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Ensure data volume mount point exists and is owned by node
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    IRIS_DATA_DIR=/data \
    IRIS_PLATFORM=web

EXPOSE 8192
VOLUME /data
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/entrypoint.sh"]


# ------ Stage 6: Computer Use variant (Playwright + Chromium) ------
# Playwright base image already ships Node.js 22 + Chromium + system deps
FROM mcr.microsoft.com/playwright:v1.58.0-noble AS computer-use-base

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 iris 2>/dev/null || true && \
    useradd -u 1001 -g iris -m -s /bin/bash iris 2>/dev/null || true

WORKDIR /app

COPY --from=build /app/dist/ dist/
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/package.json .
COPY --from=build /app/data/ data/
COPY --from=build-ui /app/src/platforms/web/web-ui/dist/ src/platforms/web/web-ui/dist/
COPY --from=bun-compile /app/dist/bin/iris-linux-x64/bin/iris bin/iris
COPY --from=bun-compile /app/dist/bin/iris-linux-x64/bin/iris-onboard bin/iris-onboard
RUN chmod +x bin/iris bin/iris-onboard
COPY deploy/docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

RUN mkdir -p /data && chown iris:iris /data

ENV NODE_ENV=production \
    IRIS_DATA_DIR=/data \
    IRIS_PLATFORM=web \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 8192
VOLUME /data
USER iris

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/entrypoint.sh"]
