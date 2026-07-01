# src — SDK source

## Purpose

The two-file SDK: the OpenAI-compatible `Grid` client and the `GridRaw` native-queue
client behind `client.grid`.

## Ownership

- `index.ts` — public entry point. `Grid extends OpenAI` (env-key + base-URL defaults,
  `onlineModels()`, `.grid`). Exports `Grid` (default + named), `GridRaw`,
  `DEFAULT_BASE_URL`, `API_KEY_ENV`, the `GridOptions` type, and deprecated `AIPG`/`AIPGOptions`.
- `grid.ts` — `GridRaw`: native SYNCHRONOUS media access at `/v1/images/generations` and
  `/v1/videos/generations` for video / advanced image. The call returns the finished result
  (hosted `media.aipg.art` URLs); no submit/poll and no `/api/v2` derivation.

## Local Contracts

- **`Grid` constructor:** resolves key from `options.apiKey` then `AIPG_API_KEY`; throws a
  helpful error if neither is set. `baseURL` defaults to `DEFAULT_BASE_URL`. All other
  `ClientOptions` pass straight through to `super()`. `this.grid` is constructed with the
  resolved key + base.
- **`onlineModels()`** returns `models.list()` ids — the models with workers connected
  right now. Empty array = no workers (requests 503). It is a convenience over the standard
  `.models` surface, not a replacement.
- **`GridRaw` base:** the client base already ends in `/v1`; `GridRaw` just strips trailing
  slashes and POSTs media paths under it. No `/api/v2` derivation.
- **`GridRaw` lifecycle is synchronous:** `generate(body, { endpoint })` POSTs and returns the
  finished OpenAI-shaped response directly (default `endpoint: '/images/generations'`, i.e.
  `/v1/images/generations`). There is no `submit`/`check`/`status`/`wait` poll cycle.
- **Auth header:** `GridRaw` uses the same OpenAI-style `Authorization: Bearer <key>` as the
  `/v1` surface.
- **Builders are sugar over `generate`:** `image`/`video` assemble the native body
  (snake_case params, `r2: true`) and forward through `params`. `image` sets
  `censor_nsfw = !nsfw` and switches to `source_processing: 'img2img'` when `sourceImage`
  is given; `video` uses a longer default timeout (600s). Unknown/advanced fields must keep
  flowing through `params` unchanged — do not allowlist them.

## Work Guidance

- New native helper → build the body in a method that delegates to `generate`, keep param
  passthrough open, and add a payload-shape test in `test/grid.test.ts`.
- Snake_case is the wire format for the `/v1` media endpoints; map camelCase options at the boundary.

## Verification

- `npm test` (`test/grid.test.ts` asserts `.grid` wiring and the image/video payload builders;
  `test/client.test.ts` covers client construction).

## Child DOX Index

- None — leaf.
