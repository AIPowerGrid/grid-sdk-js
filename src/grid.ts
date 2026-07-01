// SPDX-License-Identifier: MIT
//
// Raw Grid media access — video + advanced image beyond OpenAI-compat chat.
//
// The OpenAI-compatible /v1 endpoints cover text and basic txt2img. This adds
// the grid's SYNCHRONOUS media endpoints — /v1/images/generations (full param
// surface: img2img, LoRAs, styles, samplers) and /v1/videos/generations — as
// `client.grid`. Both are synchronous: the call returns the finished result
// (hosted media.aipg.art URLs), no submit/poll. (Replaces the retired horde
// /api/v2 async queue.)
//
//   const vid = await client.grid.video('a city timelapse', {
//     model: 'LTX-2.3', width: 768, height: 512, seconds: 4,
//   });
//   console.log(vid.data[0].url);
//
//   const img = await client.grid.image('make it watercolor', {
//     model: 'FLUX.2 Klein 4B FP8', sourceImage: '<base64>', strength: 0.6,
//     loras: [{ name: 'watercolor', model: 1.0 }],
//   });
//   console.log(img.data[0].url);

export interface GenerateOptions {
  timeoutMs?: number;
}

export interface ImageOptions extends GenerateOptions {
  /** Grid model id, e.g. 'FLUX.2 Klein 4B FP8'. `models[0]` is accepted too. */
  model?: string;
  models?: string[];
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  samplerName?: string;
  n?: number;
  /** img2img source — inline base64 / data: URI. */
  sourceImage?: string;
  /** img2img latent-blend strength (0–1). */
  strength?: number;
  negativePrompt?: string;
  loras?: unknown[];
  style?: string;
  /** Any additional grid params, merged into the request body. */
  params?: Record<string, unknown>;
}

export interface VideoOptions extends GenerateOptions {
  model?: string;
  models?: string[];
  width?: number;
  height?: number;
  seconds?: number;
  fps?: number;
  /** img2video start frame — inline base64 / data: URI. */
  sourceImage?: string;
  params?: Record<string, unknown>;
}

export class GridRaw {
  private headers: Record<string, string>;
  private base: string; // …/v1

  constructor(apiKey: string, baseURL: string) {
    this.headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    this.base = baseURL.replace(/\/+$/, ''); // the client base already ends in /v1
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, any>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('grid request timed out')), timeoutMs);
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`Grid ${path} failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
      }
      return (await res.json()) as Record<string, any>;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Raw passthrough: POST an arbitrary body to a media endpoint
   * (default `/images/generations`). Returns the OpenAI-shaped response. */
  async generate(
    body: Record<string, unknown>,
    opts: GenerateOptions & { endpoint?: string } = {},
  ): Promise<Record<string, any>> {
    const { endpoint = '/images/generations', timeoutMs = 300_000 } = opts;
    return this.post(endpoint, body, timeoutMs);
  }

  /** Image generation with the full param surface (img2img, LoRAs, styles). */
  async image(prompt: string, opts: ImageOptions): Promise<Record<string, any>> {
    const {
      model,
      models,
      width = 1024,
      height = 1024,
      steps,
      cfgScale,
      samplerName,
      n = 1,
      sourceImage,
      strength,
      negativePrompt,
      loras,
      style,
      params = {},
      timeoutMs = 300_000,
    } = opts;
    const body: Record<string, unknown> = {
      model: model ?? models?.[0],
      prompt,
      n,
      size: `${width}x${height}`,
      ...(steps != null ? { steps } : {}),
      ...(cfgScale != null ? { cfg_scale: cfgScale } : {}),
      ...(samplerName ? { sampler: samplerName } : {}),
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      ...(loras ? { loras } : {}),
      ...(style ? { style } : {}),
      ...(sourceImage ? { image: sourceImage, ...(strength != null ? { strength } : {}) } : {}),
      ...params,
    };
    return this.post('/images/generations', body, timeoutMs);
  }

  /** Video generation (txt2video / img2video). */
  async video(prompt: string, opts: VideoOptions): Promise<Record<string, any>> {
    const {
      model,
      models,
      width = 768,
      height = 512,
      seconds,
      fps,
      sourceImage,
      params = {},
      timeoutMs = 600_000,
    } = opts;
    const body: Record<string, unknown> = {
      model: model ?? models?.[0],
      prompt,
      size: `${width}x${height}`,
      ...(seconds != null ? { seconds } : {}),
      ...(fps != null ? { fps } : {}),
      ...(sourceImage ? { image: sourceImage } : {}),
      ...params,
    };
    return this.post('/videos/generations', body, timeoutMs);
  }
}
