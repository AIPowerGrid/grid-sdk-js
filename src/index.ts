// SPDX-License-Identifier: MIT
//
// AI Power Grid JS/TS SDK.
//
// The Grid API is OpenAI-compatible, so this SDK is a thin subclass of the
// official `openai` client: it points at the Grid, reads your key from the
// environment, and adds a Grid-specific helper for listing the models that
// actually have workers online. Everything the OpenAI SDK does works here.
//
//   import { AIPG } from 'aipg';
//
//   const client = new AIPG(); // reads AIPG_API_KEY from the environment
//
//   const stream = await client.chat.completions.create({
//     model: 'grid/llama-3.3-70b-versatile',
//     messages: [{ role: 'user', content: 'Hello!' }],
//     stream: true,
//   });
//   for await (const chunk of stream) {
//     process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
//   }

import OpenAI, { type ClientOptions } from 'openai';

import { GridRaw } from './grid.js';

export { GridRaw, deriveV2Base } from './grid.js';

export const DEFAULT_BASE_URL = 'https://api.aipowergrid.io/v1';
export const API_KEY_ENV = 'AIPG_API_KEY';

export interface AIPGOptions extends ClientOptions {
  /** Grid API key. Falls back to the AIPG_API_KEY environment variable. */
  apiKey?: string;
  /** Override the endpoint. Defaults to https://api.aipowergrid.io/v1 */
  baseURL?: string;
}

/**
 * AI Power Grid client. Drop-in for `openai`'s default client, pre-configured
 * for the Grid. Use `.chat`, `.images`, `.models` exactly as with the OpenAI
 * SDK, plus `.onlineModels()` to see what's servable right now.
 */
export class AIPG extends OpenAI {
  /**
   * Raw-Grid access (video, img2img, ControlNet, LoRAs) beyond the
   * OpenAI-compatible surface. See {@link GridRaw}.
   */
  readonly grid: GridRaw;

  constructor(options: AIPGOptions = {}) {
    const apiKey =
      options.apiKey ??
      (typeof process !== 'undefined' ? process.env?.[API_KEY_ENV] : undefined);

    if (!apiKey) {
      throw new Error(
        `No API key provided. Pass { apiKey } or set the ${API_KEY_ENV} ` +
          `environment variable. Get a free key at https://api.aipowergrid.io/register`,
      );
    }

    const baseURL = options.baseURL ?? DEFAULT_BASE_URL;
    super({ ...options, apiKey, baseURL });
    this.grid = new GridRaw(apiKey, baseURL);
  }

  /**
   * Model IDs currently served by connected workers. An empty array means no
   * workers are online — requests will 503 until one connects. Prefer this
   * over a hardcoded model name; the Grid's model set shifts with worker
   * presence.
   */
  async onlineModels(): Promise<string[]> {
    const res = await this.models.list();
    return res.data.map((m) => m.id);
  }
}

export default AIPG;
