# DOX framework

- DOX is a hierarchy of AGENTS.md files that carry the durable contracts for this repo.
- Agents must follow the DOX chain on every edit.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees.
- Any work product must stay understandable from the nearest AGENTS.md plus every parent above it.

## Read Before Editing

1. Read this root AGENTS.md.
2. Identify every path you expect to touch.
3. Walk from repo root to each target, reading every AGENTS.md on the way.
4. The nearest AGENTS.md is the local contract; parents hold repo-wide rules.
5. If docs conflict, the closer doc controls local detail, but no child may weaken DOX.

Do not rely on memory — re-read the applicable chain in-session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done. Update the closest
owning AGENTS.md when a change affects: purpose/scope/ownership; durable structure,
contracts, or workflows; inputs/outputs/permissions/side-effects; or the Child DOX Index.
Remove stale text immediately. Refresh affected parent and child indexes.

## Style

Concise, current, operational. Stable contracts, not diary entries. Broad rules in parents,
concrete detail in children. Delete stale notes instead of explaining history.

---

# grid-ai — JavaScript / TypeScript SDK for the Grid

## Purpose

The JS/TS client for the AI Power Grid API. The Grid speaks the OpenAI protocol, so the
SDK is a thin subclass of the official `openai` package pre-pointed at the Grid, plus a
native escape hatch (`client.grid`) for video / advanced image generation the OpenAI
surface does not cover. Published to npm as `grid-ai`. Co-canonical peer of the Python SDK
`../grid-sdk-python` (PyPI `grid-sdk`) — keep the two SDKs' surfaces aligned.

## Ownership

- `src/` — the SDK source (the `Grid` client + `GridRaw` native queue access). Owned in
  its own AGENTS.md. **All work lands here.**
- `test/` — Vitest unit tests (`client.test.ts`, `grid.test.ts`). Mirror `src/` one-to-one.
- `dist/` — `tsc` build output. Generated; never edit by hand.
- `package.json` / `tsconfig.json` — manifest + TS config (ESM, strict, target ES2021).
  Note: `package.json` declares `"license": "MIT"` but the repo `LICENSE` file is Apache-2.0.
  A real mismatch — flag for a human to reconcile; do not silently change either.

## Local Contracts

- **Inherit org engineering standards:** `aipg-documentation/engineering-standards/`
  (core + git + the matching language file).
- **Thin over `openai`:** the OpenAI-compatible surface (`.chat`, `.images`, `.models`, …)
  comes from extending `OpenAI`. Do not reimplement it. Only Grid-specific additions belong
  here: env-key default, base URL default, `onlineModels()`, and `client.grid`.
- **One published name:** package is `grid-ai`; the client is `Grid`. `AIPG`/`AIPGOptions`
  are deprecated aliases kept for resolution — do not promote them.
- **Defaults:** key from `AIPG_API_KEY` env when not passed; base URL
  `https://api.aipowergrid.io/v1`. A missing key throws at construction.
- **One base, `/v1` throughout:** the OpenAI-compatible surface (`.chat`, `.images`, …) and the
  native `client.grid` media calls both live under `/v1`. `GridRaw` POSTs SYNCHRONOUSLY to
  `/v1/images/generations` and `/v1/videos/generations` (the call returns the finished result;
  no submit/poll). The retired horde `/api/v2` async queue is gone — do not reintroduce it.
- **ESM only:** `"type": "module"`; intra-package imports use the `.js` extension.

## Work Guidance

- Public API changes (`src/index.ts` exports) → bump `package.json` version and update
  README. Treat the OpenAI-compat passthrough as a contract: do not break drop-in use.
- Add a Vitest test for any new builder/helper; keep `test/` mirroring `src/`.
- Do not add runtime dependencies beyond `openai` without cause; the SDK is meant to stay thin.

## Verification

- `npm run build` — `tsc` must compile clean under `strict`.
- `npm test` — `vitest run`.

## Child DOX Index

- [src/AGENTS.md](src/AGENTS.md) — SDK source: the `Grid` client + `GridRaw` native access.
