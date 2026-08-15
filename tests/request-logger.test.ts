import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { logRequest } from '../src/logger/request-logger.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('request logger', () => {
  it('redacts credential-bearing headers without mutating the live request', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-request-log-'));
    tempDirs.push(dir);
    const headers = {
      Authorization: 'Bearer secret-token',
      'X-API-Key': 'secret-api-key',
      'x-goog-api-key': 'secret-google-key',
      Cookie: 'session=secret',
      'Content-Type': 'application/json',
    };

    const timestamp = logRequest(dir, {
      url: 'https://example.test/v1/chat/completions?access_token=url-secret&mode=debug',
      method: 'POST',
      headers,
      body: { model: 'test-model' },
    });
    const logged = JSON.parse(fs.readFileSync(
      path.join(dir, `request_${timestamp}.json`),
      'utf8',
    ));

    expect(logged.headers.Authorization).toBe('[REDACTED]');
    expect(logged.headers['X-API-Key']).toBe('[REDACTED]');
    expect(logged.headers['x-goog-api-key']).toBe('[REDACTED]');
    expect(logged.headers.Cookie).toBe('[REDACTED]');
    expect(logged.headers['Content-Type']).toBe('application/json');
    expect(logged.url).toContain('access_token=%5BREDACTED%5D');
    expect(logged.url).toContain('mode=debug');
    expect(headers.Authorization).toBe('Bearer secret-token');
  });
});
