// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { AIPG } from '../src/index.js';
import { GridRaw, deriveV2Base } from '../src/grid.js';

describe('deriveV2Base', () => {
  it('maps /v1 to /api/v2', () => {
    expect(deriveV2Base('https://api.aipowergrid.io/v1')).toBe('https://api.aipowergrid.io/api/v2');
  });
  it('handles a trailing slash', () => {
    expect(deriveV2Base('https://api.aipowergrid.io/v1/')).toBe('https://api.aipowergrid.io/api/v2');
  });
  it('handles a custom host', () => {
    expect(deriveV2Base('http://localhost:7002/v1')).toBe('http://localhost:7002/api/v2');
  });
});

describe('client.grid wiring', () => {
  it('is a GridRaw pointed at the v2 base', () => {
    const client = new AIPG({ apiKey: 'k' });
    expect(client.grid).toBeInstanceOf(GridRaw);
    // @ts-expect-error private field, read for the test
    expect(client.grid.base).toBe('https://api.aipowergrid.io/api/v2');
  });
});

describe('payload builders', () => {
  function capture(grid: GridRaw) {
    const cap: { payload?: any } = {};
    vi.spyOn(grid, 'generate').mockImplementation(async (payload: any) => {
      cap.payload = payload;
      return { ok: true };
    });
    return cap;
  }

  it('image builder produces the basic payload', async () => {
    const grid = new GridRaw('k', 'https://api.aipowergrid.io/v1');
    const cap = capture(grid);
    await grid.image('a cat', { models: ['FLUX.1-dev'], width: 512, height: 768, steps: 20 });
    expect(cap.payload.prompt).toBe('a cat');
    expect(cap.payload.models).toEqual(['FLUX.1-dev']);
    expect(cap.payload.params.width).toBe(512);
    expect(cap.payload.params.steps).toBe(20);
    expect(cap.payload.r2).toBe(true);
  });

  it('image builder sets img2img when sourceImage is given', async () => {
    const grid = new GridRaw('k', 'https://api.aipowergrid.io/v1');
    const cap = capture(grid);
    await grid.image('watercolor', { models: ['m'], sourceImage: 'BASE64' });
    expect(cap.payload.source_image).toBe('BASE64');
    expect(cap.payload.params.source_processing).toBe('img2img');
  });

  it('image builder flows advanced params through', async () => {
    const grid = new GridRaw('k', 'https://api.aipowergrid.io/v1');
    const cap = capture(grid);
    await grid.image('x', {
      models: ['m'],
      params: { loras: [{ name: 'watercolor', model: 1.0 }], control_type: 'canny' },
    });
    expect(cap.payload.params.loras).toEqual([{ name: 'watercolor', model: 1.0 }]);
    expect(cap.payload.params.control_type).toBe('canny');
  });

  it('video builder passes video params through', async () => {
    const grid = new GridRaw('k', 'https://api.aipowergrid.io/v1');
    const cap = capture(grid);
    await grid.video('a timelapse', { models: ['LTX-2'], width: 768, params: { length: 97, fps: 24 } });
    expect(cap.payload.models).toEqual(['LTX-2']);
    expect(cap.payload.params.width).toBe(768);
    expect(cap.payload.params.length).toBe(97);
    expect(cap.payload.params.fps).toBe(24);
  });

  it('nsfw flag flips censor', async () => {
    const grid = new GridRaw('k', 'https://api.aipowergrid.io/v1');
    const cap = capture(grid);
    await grid.image('x', { models: ['m'], nsfw: true });
    expect(cap.payload.nsfw).toBe(true);
    expect(cap.payload.censor_nsfw).toBe(false);
  });
});
