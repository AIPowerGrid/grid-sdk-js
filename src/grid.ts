// SPDX-License-Identifier: MIT
//
// Raw Grid access — the full generation surface beyond OpenAI compatibility.
//
// The OpenAI-compatible /v1 endpoints cover text and basic txt2img. The Grid
// can do more — video, image-to-image, ControlNet, LoRAs, post-processing —
// via its native queue at /api/v2/generate/async. This is exposed as
// `client.grid`.
//
//   // Video (params depend on the model — passed straight through):
//   const result = await client.grid.video('a city timelapse', {
//     models: ['LTX-2'], width: 768, height: 512, length: 97,
//   });
//
//   // img2img / ControlNet / LoRAs:
//   const result = await client.grid.image('make it watercolor', {
//     models: ['FLUX.1-dev'], sourceImage: '<base64>',
//     loras: [{ name: 'watercolor', model: 1.0 }],
//   });
//
//   // Or a raw payload:
//   const result = await client.grid.generate({ prompt: '...', models: [...], params: {...} });

export function deriveV2Base(baseURL: string): string {
  let root = baseURL.replace(/\/+$/, '');
  if (root.endsWith('/v1')) root = root.slice(0, -'/v1'.length);
  return `${root}/api/v2`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GenerateOptions {
  wait?: boolean;
  timeoutMs?: number;
  intervalMs?: number;
}

export class GridRaw {
  private headers: Record<string, string>;
  private base: string;

  constructor(apiKey: string, baseURL: string) {
    this.headers = { apikey: apiKey, 'Content-Type': 'application/json' };
    this.base = deriveV2Base(baseURL);
  }

  /** Submit a raw job to /api/v2/generate/async. Returns the job id. */
  async submit(payload: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${this.base}/generate/async`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });
    if (res.status !== 200 && res.status !== 202) {
      throw new Error(`Grid submit failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { id?: string };
    if (!data.id) throw new Error('Grid submit returned no job id');
    return data.id;
  }

  /** Lightweight progress poll (does not return the generation). */
  async check(jobId: string): Promise<Record<string, any>> {
    const res = await fetch(`${this.base}/generate/check/${jobId}`, { headers: this.headers });
    return res.status === 200 ? ((await res.json()) as Record<string, any>) : {};
  }

  /** Full status including generations once done. */
  async status(jobId: string): Promise<Record<string, any>> {
    const res = await fetch(`${this.base}/generate/status/${jobId}`, { headers: this.headers });
    if (res.status !== 200) {
      throw new Error(`Grid status failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
    }
    return (await res.json()) as Record<string, any>;
  }

  /** Poll until the job is done (or timeout). Returns the status payload. */
  async wait(jobId: string, timeoutMs = 300_000, intervalMs = 2_000): Promise<Record<string, any>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(intervalMs);
      const c = await this.check(jobId);
      if (c.done) return this.status(jobId);
    }
    throw new Error(`Grid job ${jobId} did not finish within ${timeoutMs}ms`);
  }

  /** Submit a raw payload and (by default) wait for the result. */
  async generate(
    payload: Record<string, unknown>,
    opts: GenerateOptions = {},
  ): Promise<Record<string, any>> {
    const { wait = true, timeoutMs = 300_000, intervalMs = 2_000 } = opts;
    const id = await this.submit(payload);
    return wait ? this.wait(id, timeoutMs, intervalMs) : { id };
  }

  /** Image generation with the full param surface. Advanced options
   * (loras, controlType, postProcessing, …) go in `params` and flow through. */
  async image(
    prompt: string,
    opts: {
      models: string[];
      width?: number;
      height?: number;
      steps?: number;
      cfgScale?: number;
      samplerName?: string;
      n?: number;
      sourceImage?: string;
      nsfw?: boolean;
      params?: Record<string, unknown>;
    } & GenerateOptions,
  ): Promise<Record<string, any>> {
    const {
      models,
      width = 1024,
      height = 1024,
      steps = 30,
      cfgScale = 7.5,
      samplerName = 'k_euler',
      n = 1,
      sourceImage,
      nsfw = false,
      params = {},
      ...gen
    } = opts;

    const body: Record<string, unknown> = {
      prompt,
      models,
      nsfw,
      censor_nsfw: !nsfw,
      r2: true,
      params: { n, width, height, steps, cfg_scale: cfgScale, sampler_name: samplerName, ...params },
    };
    if (sourceImage) {
      body.source_image = sourceImage;
      (body.params as Record<string, unknown>).source_processing ??= 'img2img';
    }
    return this.generate(body, gen);
  }

  /** Video generation. Param names (length, fps, motion, …) depend on the
   * model and are passed straight through via `params`. */
  async video(
    prompt: string,
    opts: {
      models: string[];
      width?: number;
      height?: number;
      params?: Record<string, unknown>;
    } & GenerateOptions,
  ): Promise<Record<string, any>> {
    const { models, width = 768, height = 512, params = {}, ...gen } = opts;
    const body = {
      prompt,
      models,
      r2: true,
      params: { width, height, ...params },
    };
    return this.generate(body, { timeoutMs: 600_000, ...gen });
  }
}
