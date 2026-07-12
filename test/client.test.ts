// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import OpenAI from 'openai';
import { AIPG, DEFAULT_BASE_URL } from '../src/index.js';

describe('AIPG client', () => {
  const ORIGINAL = process.env.AIPG_API_KEY;

  beforeEach(() => {
    delete process.env.AIPG_API_KEY;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AIPG_API_KEY;
    else process.env.AIPG_API_KEY = ORIGINAL;
  });

  // ── key resolution + config ──

  it('uses an explicit key', () => {
    const client = new AIPG({ apiKey: 'grid-explicit' });
    expect(client.apiKey).toBe('grid-explicit');
  });

  it('falls back to AIPG_API_KEY env var', () => {
    process.env.AIPG_API_KEY = 'grid-from-env';
    const client = new AIPG();
    expect(client.apiKey).toBe('grid-from-env');
  });

  it('throws a helpful error when no key is available', () => {
    expect(() => new AIPG()).toThrowError(/AIPG_API_KEY/);
    expect(() => new AIPG()).toThrowError(/console\.aipowergrid\.io\/dashboard\/api-key/);
  });

  it('defaults the base URL to the Grid', () => {
    const client = new AIPG({ apiKey: 'k' });
    expect(client.baseURL.replace(/\/$/, '')).toBe(DEFAULT_BASE_URL.replace(/\/$/, ''));
  });

  it('allows overriding the base URL', () => {
    const client = new AIPG({ apiKey: 'k', baseURL: 'http://localhost:9999/v1' });
    expect(client.baseURL).toContain('localhost:9999');
  });

  it('is an OpenAI client (all OpenAI features come free)', () => {
    expect(new AIPG({ apiKey: 'k' })).toBeInstanceOf(OpenAI);
  });

  // ── onlineModels() ──

  it('maps the models response to a list of IDs', async () => {
    const client = new AIPG({ apiKey: 'k' });
    vi.spyOn(client.models, 'list').mockResolvedValue({
      data: [{ id: 'grid/llama-3.3-70b-versatile' }, { id: 'grid/qwen3-32b' }],
    } as any);

    expect(await client.onlineModels()).toEqual([
      'grid/llama-3.3-70b-versatile',
      'grid/qwen3-32b',
    ]);
  });

  it('returns an empty array when no workers are online', async () => {
    const client = new AIPG({ apiKey: 'k' });
    vi.spyOn(client.models, 'list').mockResolvedValue({ data: [] } as any);
    expect(await client.onlineModels()).toEqual([]);
  });
});
