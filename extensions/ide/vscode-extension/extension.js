'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const EXTENSION_VERSION = '0.1.2';
const DEFAULT_PROTOCOL_VERSION = '2025-11-25';

let server = null;
let port = 0;
let lockfilePath = undefined;
let rewriteTimer = undefined;
let selectionTimer = undefined;
let authToken = undefined;
const clients = new Map();
const diffDocuments = new Map();

function resolveDataDir() {
  const configured = vscode.workspace.getConfiguration('irisIde').get('dataDir');
  const raw = typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : process.env.IRIS_DATA_DIR || path.join(os.homedir(), '.iris');
  return path.resolve(raw.replace(/^~(?=$|[\\/])/, os.homedir()));
}

function getWorkspaceFolders() {
  return (vscode.workspace.workspaceFolders || [])
    .map((folder) => folder.uri.scheme === 'file' ? folder.uri.fsPath : folder.uri.toString());
}

function getIdeName() {
  const appName = vscode.env.appName || 'VS Code';
  return appName.includes('Visual Studio Code') ? 'VS Code' : appName;
}

function getLockfilePayload() {
  return {
    workspaceFolders: getWorkspaceFolders(),
    pid: process.pid,
    extensionVersion: EXTENSION_VERSION,
    ideName: getIdeName(),
    transport: 'sse',
    runningInWindows: process.platform === 'win32',
    authToken,
  };
}

function writeLockfile() {
  if (!port) return;
  const lockDir = path.join(resolveDataDir(), 'ide');
  fs.mkdirSync(lockDir, { recursive: true });
  lockfilePath = path.join(lockDir, `${port}.lock`);
  fs.writeFileSync(lockfilePath, JSON.stringify(getLockfilePayload(), null, 2), 'utf8');
}

function removeLockfile() {
  if (!lockfilePath) return;
  try { fs.rmSync(lockfilePath, { force: true }); } catch { /* ignore */ }
  lockfilePath = undefined;
}

function header(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isAuthorized(req) {
  if (!authToken) return true;
  return header(req, 'x-iris-ide-authorization') === authToken
    || header(req, 'x-claude-code-ide-authorization') === authToken;
}

function sendHttp(res, status, body = '') {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function writeSse(res, message) {
  try {
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  } catch {
    // Client is gone; close handling will clean it up.
  }
}

function findClient(clientId) {
  if (clientId && clients.has(clientId)) return clients.get(clientId);
  return clients.values().next().value;
}

function respond(clientId, id, result) {
  const client = findClient(clientId);
  if (!client) return;
  writeSse(client, { jsonrpc: '2.0', id, result });
}

function respondError(clientId, id, code, message) {
  const client = findClient(clientId);
  if (!client) return;
  writeSse(client, { jsonrpc: '2.0', id, error: { code, message } });
}

function notify(method, params) {
  const message = { jsonrpc: '2.0', method, params };
  for (const client of clients.values()) writeSse(client, message);
}

function toolDefinition(name, description, inputSchema = { type: 'object', properties: {}, additionalProperties: false }) {
  return { name, description, inputSchema };
}

function getCurrentSelectionPayload() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return { filePath: undefined, text: '', selection: null };
  const selection = editor.selection;
  const filePath = editor.document.uri.scheme === 'file'
    ? editor.document.uri.fsPath
    : editor.document.uri.toString();
  return {
    filePath,
    text: editor.document.getText(selection),
    selection: {
      start: { line: selection.start.line, character: selection.start.character },
      end: { line: selection.end.line, character: selection.end.character },
    },
  };
}

function sendSelectionChanged() {
  notify('selection_changed', getCurrentSelectionPayload());
}

function sendAtMentioned() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('No active editor to mention.');
    return;
  }
  const selection = editor.selection;
  const filePath = editor.document.uri.scheme === 'file'
    ? editor.document.uri.fsPath
    : editor.document.uri.toString();
  notify('at_mentioned', {
    filePath,
    lineStart: selection.start.line,
    lineEnd: selection.end.line,
  });
  vscode.window.setStatusBarMessage('Sent @ mention to Iris', 2000);
}

function scheduleSelectionChanged(delay = 60) {
  if (selectionTimer) clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    selectionTimer = undefined;
    sendSelectionChanged();
  }, delay);
}

function serializeDiagnostic(diagnostic) {
  const severity = ['Error', 'Warning', 'Information', 'Hint'][diagnostic.severity] || String(diagnostic.severity);
  return {
    severity,
    message: diagnostic.message,
    source: diagnostic.source,
    code: diagnostic.code,
    range: {
      start: { line: diagnostic.range.start.line + 1, character: diagnostic.range.start.character + 1 },
      end: { line: diagnostic.range.end.line + 1, character: diagnostic.range.end.character + 1 },
    },
  };
}

function getDiagnostics(params) {
  const requested = params && typeof params.filePath === 'string' ? params.filePath : undefined;
  if (requested) {
    const uri = vscode.Uri.file(requested);
    return [{ filePath: requested, diagnostics: vscode.languages.getDiagnostics(uri).map(serializeDiagnostic) }];
  }
  return vscode.languages.getDiagnostics()
    .map(([uri, diagnostics]) => ({
      filePath: uri.scheme === 'file' ? uri.fsPath : uri.toString(),
      diagnostics: diagnostics.map(serializeDiagnostic),
    }))
    .filter((entry) => entry.diagnostics.length > 0);
}

function getExtensionStatus() {
  const editor = vscode.window.activeTextEditor;
  const selection = editor?.selection;
  return {
    extensionVersion: EXTENSION_VERSION,
    server: {
      port,
      lockfilePath,
      clientCount: clients.size,
      diffDocumentCount: diffDocuments.size,
      dataDir: resolveDataDir(),
    },
    workspaceFolders: getWorkspaceFolders(),
    activeEditor: editor ? {
      filePath: editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : editor.document.uri.toString(),
      languageId: editor.document.languageId,
      isDirty: editor.document.isDirty,
      selection: selection ? {
        start: { line: selection.start.line + 1, character: selection.start.character + 1 },
        end: { line: selection.end.line + 1, character: selection.end.character + 1 },
      } : undefined,
    } : undefined,
  };
}

function parseUnifiedDiffForVirtualDocuments(diff) {
  const oldLines = [];
  const newLines = [];
  const lines = String(diff || '').split(/\r?\n/g);
  for (const line of lines) {
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff --git ') || line.startsWith('index ')) {
      continue;
    }
    if (line.startsWith('@@')) {
      oldLines.push(line);
      newLines.push(line);
      continue;
    }
    if (line.startsWith('-')) {
      oldLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith('+')) {
      newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(' ')) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
      continue;
    }
    if (line.length > 0) {
      oldLines.push(line);
      newLines.push(line);
    }
  }
  return { oldText: oldLines.join('\n'), newText: newLines.join('\n') };
}

async function openDiffInIde(params) {
  const diff = typeof params?.diff === 'string' ? params.diff : '';
  if (!diff.trim()) throw new Error('openDiff requires a non-empty diff string');
  const filePath = typeof params?.filePath === 'string' ? params.filePath : 'diff';
  const title = typeof params?.title === 'string' && params.title.trim()
    ? params.title.trim()
    : `Iris Diff: ${path.basename(filePath)}`;
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { oldText, newText } = parseUnifiedDiffForVirtualDocuments(diff);
  const leftPath = `/before/${encodeURIComponent(filePath)}/${nonce}`;
  const rightPath = `/after/${encodeURIComponent(filePath)}/${nonce}`;
  const leftUri = vscode.Uri.from({ scheme: 'iris-diff', path: leftPath });
  const rightUri = vscode.Uri.from({ scheme: 'iris-diff', path: rightPath });
  diffDocuments.set(leftUri.toString(), oldText);
  diffDocuments.set(rightUri.toString(), newText);
  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, { preview: false });
  setTimeout(() => {
    diffDocuments.delete(leftUri.toString());
    diffDocuments.delete(rightUri.toString());
  }, 10 * 60 * 1000);
  return { opened: true, title, filePath };
}

async function callTool(name, args) {
  switch (name) {
    case 'getCurrentSelection':
      return getCurrentSelectionPayload();
    case 'getOpenedFile': {
      const editor = vscode.window.activeTextEditor;
      return {
        file: editor
          ? (editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : editor.document.uri.toString())
          : undefined,
      };
    }
    case 'getStatus':
      return getExtensionStatus();
    case 'getDiagnostics':
      return { files: getDiagnostics(args || {}) };
    case 'openDiff':
      return openDiffInIde(args || {});
    default:
      throw new Error(`Unknown IDE tool: ${name}`);
  }
}

async function handleRpcMessage(clientId, message) {
  if (!message || typeof message !== 'object') return;
  const id = message.id;
  const method = message.method;

  try {
    switch (method) {
      case 'initialize':
        respond(clientId, id, {
          protocolVersion: message.params?.protocolVersion || DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'iris-vscode', version: EXTENSION_VERSION },
        });
        scheduleSelectionChanged(100);
        return;
      case 'notifications/initialized':
      case 'ide_connected':
        scheduleSelectionChanged(30);
        return;
      case 'tools/list':
        respond(clientId, id, {
          tools: [
            toolDefinition('getCurrentSelection', 'Return VS Code active editor selection and text.'),
            toolDefinition('getOpenedFile', 'Return VS Code active editor file path.'),
            toolDefinition('getStatus', 'Return Iris VS Code extension debug status.'),
            toolDefinition('getDiagnostics', 'Return VS Code diagnostics.', {
              type: 'object',
              properties: { filePath: { type: 'string' } },
              additionalProperties: false,
            }),
            toolDefinition('openDiff', 'Open a unified diff in VS Code diff editor.', {
              type: 'object',
              properties: {
                filePath: { type: 'string' },
                diff: { type: 'string' },
                title: { type: 'string' },
              },
              required: ['diff'],
              additionalProperties: false,
            }),
          ],
        });
        return;
      case 'tools/call': {
        const name = message.params?.name;
        const args = message.params?.arguments || {};
        const data = await callTool(name, args);
        respond(clientId, id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        });
        return;
      }
      case 'ping':
        respond(clientId, id, {});
        return;
      default:
        if (id !== undefined) respondError(clientId, id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    if (id !== undefined) {
      respondError(clientId, id, -32603, error instanceof Error ? error.message : String(error));
    }
  }
}

async function handlePost(req, res, clientId) {
  if (!isAuthorized(req)) return sendHttp(res, 401, 'Unauthorized');
  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw);
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const message of messages) await handleRpcMessage(clientId, message);
    sendHttp(res, 202, 'Accepted');
  } catch (error) {
    sendHttp(res, 400, error instanceof Error ? error.message : String(error));
  }
}

function handleSse(req, res) {
  if (!isAuthorized(req)) return sendHttp(res, 401, 'Unauthorized');
  const clientId = crypto.randomBytes(8).toString('hex');
  const endpointHost = req.headers.host || `127.0.0.1:${port}`;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  clients.set(clientId, res);
  res.write(`event: endpoint\n`);
  res.write(`data: http://${endpointHost}/message?clientId=${clientId}\n\n`);
  res.write(`: connected\n\n`);
  req.on('close', () => clients.delete(clientId));
}

function startServer() {
  stopServer();
  authToken = crypto.randomBytes(24).toString('hex');
  server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && requestUrl.pathname === '/sse') return handleSse(req, res);
    if (req.method === 'POST' && requestUrl.pathname === '/message') return void handlePost(req, res, requestUrl.searchParams.get('clientId') || undefined);
    if (req.method === 'GET' && requestUrl.pathname === '/health') return sendHttp(res, 200, 'ok');
    sendHttp(res, 404, 'Not Found');
  });

  server.listen(0, '127.0.0.1', () => {
    const address = server?.address();
    port = typeof address === 'object' && address ? address.port : 0;
    writeLockfile();
    rewriteTimer = setInterval(writeLockfile, 10_000);
    scheduleSelectionChanged(100);
  });

  server.on('error', (error) => {
    vscode.window.showWarningMessage(`Iris IDE server failed: ${error.message}`);
  });
}

function stopServer() {
  if (selectionTimer) clearTimeout(selectionTimer);
  selectionTimer = undefined;
  if (rewriteTimer) clearInterval(rewriteTimer);
  rewriteTimer = undefined;
  removeLockfile();
  diffDocuments.clear();
  for (const client of clients.values()) {
    try { client.end(); } catch { /* ignore */ }
  }
  clients.clear();
  if (server) {
    try { server.close(); } catch { /* ignore */ }
  }
  server = null;
  port = 0;
}

function statusText() {
  return port
    ? `Iris IDE Integration is running on port ${port}. Lockfile: ${lockfilePath || '(pending)'}`
    : 'Iris IDE Integration server is not running.';
}

function activate(context) {
  startServer();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('iris-diff', {
      provideTextDocumentContent: (uri) => diffDocuments.get(uri.toString()) ?? '',
    }),
    vscode.commands.registerCommand('irisIde.showStatus', () => vscode.window.showInformationMessage(statusText())),
    vscode.commands.registerCommand('irisIde.restartServer', () => {
      startServer();
      vscode.window.showInformationMessage('Iris IDE Integration server restarted.');
    }),
    vscode.commands.registerCommand('irisIde.insertAtMention', sendAtMentioned),
    vscode.window.onDidChangeActiveTextEditor(() => scheduleSelectionChanged()),
    vscode.window.onDidChangeTextEditorSelection(() => scheduleSelectionChanged()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      writeLockfile();
      scheduleSelectionChanged();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('irisIde.dataDir')) startServer();
    }),
    { dispose: stopServer },
  );
}

function deactivate() {
  stopServer();
}

module.exports = { activate, deactivate };
