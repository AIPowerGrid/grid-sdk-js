// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIPG } from '../src/index.js';
import { GridRaw } from '../src/grid.js';

describe('client.grid wiring', () => {
  it('is a GridRaw pointed at the /v1 base', () => {
    const client = new AIPG({ apiKey: 'k' });
    expect(client.grid).toBeInstanceOf(GridRaw);
    // @ts-expect-error private field, read for the test
    expect(client.grid.base).toBe('https://api.aipowergrid.io/v1');
  });
});

describe('/v1 media requests', () => {
  let calls: Array<{ url: string; body: any; headers: any }>;

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: any) => {
        calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ url: 'https://media.aipg.art/x.webp', seed: 1 }] }),
        } as any;
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('image posts to /v1/images/generations in OpenAI shape', async () => {
    const grid = new GridRaw('k', 'https://api.aipowergrid.io/v1');
    await grid.image('a cat', { model: 'FLUX.2 Klein 4B FP8', width: 512, height: 768, steps: 20, cfgScale: 3.5 });
    expect(calls[0].url).toBe('https://api.aipowergrid.io/v1/images/generations');
    expect(calls[0].headers.Authorization).toBe('Bearer k');
    expect(calls[0].body.model).toBe('FLUX.2 Klein 4B FP8');
    expect(calls[0].body.prompt).toBe('a cat');
    expect(calls[0].body.size).toBe('512x768');
    expect(calls[0].body.steps).toBe(20);
    expect(calls[0].body.cfg_scale).toBe(3.5);
  });

  it('accepts models[] for back-compat (maps to model)', async () => {
    const grid = new GridRaw('k', 'https://api.aipowergrid.io/v1');
    await grid.image('x', { models: ['z-image-turbo'] });
    expect(calls[0].body.model).toBe('z-image-turbo');
  });

  it('image sets img2img fields when sourceImage is given', async () => {
    const grid = new GridRaw('k', 'https://api.aipowergrid.io/v1');
    await grid.image('watercolor', { model: 'm', sourceImage: 'BASE64', strength: 0.6 });
    expect(calls[0].body.image).toBe('BASE64');
    expect(calls[0].body.strength).toBe(0.6);
  });

  it('image flows loras + extra params through', async () => {
    const grid = new GridRaw('k', 'https://api.aipowergrid.io/v1');
    await grid.image('x', { model: 'm', loras: [{ name: 'watercolor', model: 1.0 }], params: { seed: 42 } });
    expect(calls[0].body.loras).toEqual([{ name: 'watercolor', model: 1.0 }]);
    expect(calls[0].body.seed).toBe(42);
  });

  it('video posts to /v1/videos/generations', async () => {
    const grid = new GridRaw('k', 'https://api.aipowergrid.io/v1');
    await grid.video('a timelapse', { model: 'LTX-2.3', width: 768, height: 512, seconds: 4, fps: 24 });
    expect(calls[0].url).toBe('https://api.aipowergrid.io/v1/videos/generations');
    expect(calls[0].body.model).toBe('LTX-2.3');
    expect(calls[0].body.size).toBe('768x512');
    expect(calls[0].body.seconds).toBe(4);
    expect(calls[0].body.fps).toBe(24);
  });
});
