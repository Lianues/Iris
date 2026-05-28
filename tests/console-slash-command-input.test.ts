import { describe, expect, it } from 'vitest';
import {
  isSlashCommandInput,
  normalizeSlashCommandInput,
} from '../extensions/console/src/input-commands';

describe('console slash command input aliases', () => {
  it('recognizes standard slash and Chinese IME slash alias at input start', () => {
    expect(isSlashCommandInput('/')).toBe(true);
    expect(isSlashCommandInput('/model')).toBe(true);
    expect(isSlashCommandInput('、')).toBe(true);
    expect(isSlashCommandInput('、model')).toBe(true);
  });

  it('does not recognize slash-like characters away from the input start', () => {
    expect(isSlashCommandInput('abc/')).toBe(false);
    expect(isSlashCommandInput('abc、')).toBe(false);
    expect(isSlashCommandInput('你好、世界')).toBe(false);
  });

  it('normalizes only the leading Chinese punctuation alias to slash', () => {
    expect(normalizeSlashCommandInput('、model')).toBe('/model');
    expect(normalizeSlashCommandInput('、commit cn')).toBe('/commit cn');
    expect(normalizeSlashCommandInput('/model')).toBe('/model');
    expect(normalizeSlashCommandInput('你好、世界')).toBe('你好、世界');
    expect(normalizeSlashCommandInput('abc、model')).toBe('abc、model');
  });
});
