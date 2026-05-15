import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYAML } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { isCronCliSubcommand, runCronCli } from '../src/cron-cli';

const createdDirs: string[] = [];

function createTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-cron-cli-'));
  createdDirs.push(dir);
  return dir;
}

function readYaml(filePath: string): any {
  return parseYAML(fs.readFileSync(filePath, 'utf-8'));
}

function readJobs(filePath: string): any[] {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('iris cron CLI', () => {
  it('detects cron CLI subcommands', () => {
    expect(isCronCliSubcommand('list')).toBe(true);
    expect(isCronCliSubcommand('config')).toBe(true);
    expect(isCronCliSubcommand(undefined)).toBe(false);
  });

  it('updates cron scheduler config', async () => {
    const dataDir = createTempDataDir();

    const disabled = await runCronCli(['config', 'disable'], { dataDir });
    expect(disabled.ok).toBe(true);
    let config = readYaml(path.join(dataDir, 'configs', 'cron.yaml'));
    expect(config.enabled).toBe(false);

    const enabled = await runCronCli(['config', 'enable'], { dataDir });
    expect(enabled.ok).toBe(true);
    config = readYaml(path.join(dataDir, 'configs', 'cron.yaml'));
    expect(config.enabled).toBe(true);

    const status = await runCronCli(['status'], { dataDir });
    expect(status.ok).toBe(true);
    expect(status.message).toContain('scheduler enabled: true');

    const scopedOrdering = await runCronCli(['config', '--agent', 'worker', 'disable'], { dataDir });
    expect(scopedOrdering.ok).toBe(true);
    expect(readYaml(path.join(dataDir, 'agents', 'worker', 'configs', 'cron.yaml')).enabled).toBe(false);
  });

  it('creates, lists, gets, toggles and removes cron jobs', async () => {
    const dataDir = createTempDataDir();
    const result = await runCronCli([
      'add',
      'morning',
      '--type', 'cron',
      '--value', '0 9 * * *',
      '--instruction', '生成一条早安问候',
      '--silent',
      '--allow-tools', 'memory_search,delivery_send',
    ], { dataDir });

    expect(result.ok).toBe(true);
    const jobsPath = path.join(dataDir, 'extension-data', 'cron', 'cron-jobs.json');
    let jobs = readJobs(jobsPath);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: 'morning',
      schedule: { type: 'cron', expression: '0 9 * * *' },
      instruction: '生成一条早安问候',
      silent: true,
      allowedTools: ['memory_search', 'delivery_send'],
      enabled: true,
    });

    const list = await runCronCli(['list'], { dataDir });
    expect(list.ok).toBe(true);
    expect(list.message).toContain('morning');
    expect(list.message).toContain('cron 0 9 * * *');

    const get = await runCronCli(['get', 'morning'], { dataDir });
    expect(get.ok).toBe(true);
    expect(get.message).toContain('instruction: 生成一条早安问候');

    const invalid = await runCronCli(['add', 'bad', '-t', 'cron', '-v', 'bad cron', '-i', 'bad'], { dataDir });
    expect(invalid.ok).toBe(false);
    expect(invalid.message).toContain('无效 cron 表达式');

    const disabled = await runCronCli(['disable', 'morning'], { dataDir });
    expect(disabled.ok).toBe(true);
    jobs = readJobs(jobsPath);
    expect(jobs[0].enabled).toBe(false);

    const enabled = await runCronCli(['enable', jobs[0].id], { dataDir });
    expect(enabled.ok).toBe(true);
    jobs = readJobs(jobsPath);
    expect(jobs[0].enabled).toBe(true);

    const removed = await runCronCli(['remove', 'morning'], { dataDir });
    expect(removed.ok).toBe(true);
    expect(readJobs(jobsPath)).toHaveLength(0);
  });

  it('supports interval and once schedule shorthand', async () => {
    const dataDir = createTempDataDir();
    const interval = await runCronCli([
      'add', 'check', '-t', 'interval', '-v', '30m', '-i', '检查状态', '--disabled',
    ], { dataDir });
    expect(interval.ok).toBe(true);

    const once = await runCronCli([
      'add', 'reminder', '-t', 'once', '-v', '10m', '-i', '提醒喝水',
    ], { dataDir });
    expect(once.ok).toBe(true);

    const jobs = readJobs(path.join(dataDir, 'extension-data', 'cron', 'cron-jobs.json'));
    expect(jobs.find((job) => job.name === 'check')?.schedule).toMatchObject({ type: 'interval', ms: 30 * 60 * 1000 });
    expect(jobs.find((job) => job.name === 'check')?.enabled).toBe(false);
    expect(jobs.find((job) => job.name === 'reminder')?.schedule.type).toBe('once');
    expect(jobs.find((job) => job.name === 'reminder')?.schedule.at).toBeGreaterThan(Date.now());
  });

  it('writes agent-scoped cron config and jobs respecting custom dataDir', async () => {
    const dataDir = createTempDataDir();
    const customAgentDir = path.join(dataDir, 'custom-agent-data');
    fs.writeFileSync(path.join(dataDir, 'agents.yaml'), [
      'agents:',
      '  worker:',
      `    dataDir: ${JSON.stringify(customAgentDir)}`,
    ].join('\n'), 'utf-8');

    const result = await runCronCli([
      'add', '--agent', 'worker', 'agent-job', '-t', 'interval', '-v', '5m', '-i', 'agent task',
    ], { dataDir });
    expect(result.ok).toBe(true);

    const jobsPath = path.join(customAgentDir, 'extension-data', 'cron', 'cron-jobs.json');
    expect(readJobs(jobsPath)[0].name).toBe('agent-job');
    expect(fs.existsSync(path.join(dataDir, 'extension-data', 'cron', 'cron-jobs.json'))).toBe(false);

    const config = await runCronCli(['config', 'disable', '--agent', 'worker'], { dataDir });
    expect(config.ok).toBe(true);
    expect(readYaml(path.join(customAgentDir, 'configs', 'cron.yaml')).enabled).toBe(false);
  });
});
