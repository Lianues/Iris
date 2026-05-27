# Iris IDE Integration for VS Code

This extension starts a local MCP-compatible SSE endpoint and writes an Iris IDE lockfile to `~/.iris/ide/<port>.lock` (or `IRIS_DATA_DIR/ide`). Iris can then connect via `/ide detect` and `/ide connect`.

The extension is installed by Iris with `/ide install` when the VS Code `code` command is available.

## Commands

- `Iris IDE: Show Status` — show local server/lockfile status.
- `Iris IDE: Restart Local Server` — restart the local SSE endpoint and refresh lockfile.
- `Iris IDE: Insert @ Mention into Iris` — send the current file/selection as an `@file#Lx-Ly` mention to Iris Console.

Iris can also open approval diffs in VS Code through the extension's `openDiff` MCP tool.
