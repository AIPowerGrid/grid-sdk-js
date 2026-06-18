# src — SDK source

## Purpose

The two-file SDK: the OpenAI-compatible `Grid` client and the `GridRaw` native-queue
client behind `client.grid`.

## Ownership

- `index.ts` — public entry point. `Grid extends OpenAI` (env-key + base-URL defaults,
  `onlineModels()`, `.grid`). Exports `Grid` (default + named), `GridRaw`, `deriveV2Base`,
  `DEFAULT_BASE_URL`, `API_KEY_ENV`, the `GridOptions` type, and deprecated `AIPG`/`AIPGOptions`.
- `grid.ts` — `GridRaw`: native `/api/v2/generate/*` access for video / advanced image.
  Holds `deriveV2Base` and the submit/poll lifecycle.

## Local Contracts

- **`Grid` constructor:** resolves key from `options.apiKey` then `AIPG_API_KEY`; throws a
  helpful error if neither is set. `baseURL` defaults to `DEFAULT_BASE_URL`. All other
  `ClientOptions` pass straight through to `super()`. `this.grid` is constructed with the
  resolved key + base.
- **`onlineModels()`** returns `models.list()` ids — the models with workers connected
  right now. Empty array = no workers (requests 503). It is a convenience over the standard
  `.models` surface, not a replacement.
- **`deriveV2Base`:** strips trailing slashes and a trailing `/v1`, then appends `/api/v2`.
  This is the bridge between the OpenAI-compat base and the native queue — keep it total
  (custom hosts, trailing slash) and covered by tests.
- **`GridRaw` lifecycle:** `submit` → job id (accepts 200/202); `check` = lightweight
  progress (returns `{}` on non-200); `status` = full payload incl. generations; `wait`
  polls `check` until `done` then returns `status`; `generate` submits and (default) waits.
  `{ wait: false }` returns `{ id }` for manual polling via `status`.
- **Auth header:** `GridRaw` sends the key as the `apikey` header (the native queue's
  convention), distinct from the OpenAI Bearer auth used by the `/v1` surface.
- **Builders are sugar over `generate`:** `image`/`video` assemble the native body
  (snake_case params, `r2: true`) and forward through `params`. `image` sets
  `censor_nsfw = !nsfw` and switches to `source_processing: 'img2img'` when `sourceImage`
  is given; `video` uses a longer default timeout (600s). Unknown/advanced fields must keep
  flowing through `params` unchanged — do not allowlist them.

## Work Guidance

- New native helper → build the body in a method that delegates to `generate`, keep param
  passthrough open, and add a payload-shape test in `test/grid.test.ts`.
- Snake_case is the wire format for `/api/v2`; map camelCase options to it at the boundary.

## Verification

- `npm test` (`test/grid.test.ts` asserts `deriveV2Base`, `.grid` wiring, and the
  image/video payload builders; `test/client.test.ts` covers client construction).

## Child DOX Index

- None — leaf.
