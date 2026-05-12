import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYAML } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { runMcpCli } from '../src/mcp-cli';

const createdDirs: string[] = [];

function createTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-mcp-cli-'));
  createdDirs.push(dir);
  return dir;
}

function readYaml(filePath: string): any {
  return parseYAML(fs.readFileSync(filePath, 'utf-8'));
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('iris mcp CLI', () => {
  it('adds HTTP MCP server using Claude-style --transport http syntax', async () => {
    const dataDir = createTempDataDir();

    const result = await runMcpCli([
      'add',
      '--transport', 'http',
      'exa',
      'https://mcp.exa.ai/mcp',
    ], { dataDir });

    expect(result.ok).toBe(true);
    const mcpPath = path.join(dataDir, 'configs', 'mcp.yaml');
    const config = readYaml(mcpPath);
    expect(config.servers.exa).toMatchObject({
      transport: 'streamable-http',
      url: 'https://mcp.exa.ai/mcp',
      timeout: 30000,
      enabled: true,
    });
  });

  it('adds stdio MCP server with env and command args after --', async () => {
    const dataDir = createTempDataDir();

    const result = await runMcpCli([
      'add',
      '-e', 'API_KEY=xxx',
      'filesystem',
      '--',
      'npx',
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/tmp',
    ], { dataDir });

    expect(result.ok).toBe(true);
    const config = readYaml(path.join(dataDir, 'configs', 'mcp.yaml'));
    expect(config.servers.filesystem).toMatchObject({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { API_KEY: 'xxx' },
      enabled: true,
    });
  });

  it('removes and toggles MCP servers', async () => {
    const dataDir = createTempDataDir();
    await runMcpCli(['add', '--transport', 'http', 'exa', 'https://mcp.exa.ai/mcp'], { dataDir });

    const disabled = await runMcpCli(['disable', 'exa'], { dataDir });
    expect(disabled.ok).toBe(true);
    expect(readYaml(path.join(dataDir, 'configs', 'mcp.yaml')).servers.exa.enabled).toBe(false);

    const enabled = await runMcpCli(['enable', 'exa'], { dataDir });
    expect(enabled.ok).toBe(true);
    expect(readYaml(path.join(dataDir, 'configs', 'mcp.yaml')).servers.exa.enabled).toBe(true);

    const removed = await runMcpCli(['remove', 'exa'], { dataDir });
    expect(removed.ok).toBe(true);
    expect(readYaml(path.join(dataDir, 'configs', 'mcp.yaml')).servers.exa).toBeUndefined();
  });

  it('writes agent scoped MCP config and respects custom agent dataDir', async () => {
    const dataDir = createTempDataDir();
    const customAgentDir = path.join(dataDir, 'custom-agent-data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'agents.yaml'), [
      'agents:',
      '  worker:',
      `    dataDir: ${JSON.stringify(customAgentDir)}`,
    ].join('\n'), 'utf-8');

    const result = await runMcpCli([
      'add',
      '--agent', 'worker',
      '--transport', 'streamable-http',
      'exa',
      'https://mcp.exa.ai/mcp',
    ], { dataDir });

    expect(result.ok).toBe(true);
    const config = readYaml(path.join(customAgentDir, 'configs', 'mcp.yaml'));
    expect(config.servers.exa.url).toBe('https://mcp.exa.ai/mcp');
    expect(fs.existsSync(path.join(dataDir, 'configs', 'mcp.yaml'))).toBe(false);
  });
});
