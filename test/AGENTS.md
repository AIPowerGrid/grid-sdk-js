# grid-ai tests

## Purpose

Vitest contract tests for the public JavaScript/TypeScript SDK and native Grid
media helper.

## Ownership

- `client.test.ts` - constructor, defaults, aliases, and OpenAI-compatible client.
- `grid.test.ts` - synchronous `/v1` image/video request shapes and responses.

## Local Contracts

- Mock HTTP; never use production keys or consume live credits in unit tests.
- Assert exact method, URL, headers, body, sync semantics, and public exports.
- Keep tests paired with `src/` behavior and cover async/error paths as well as
  successful results.

## Work Guidance

- Add a regression for every public API or wire-contract change.
- Do not update snapshots merely to bless an unintended breaking change.

## Verification

- Run `npm test` and `npm run build` from the repository root.

## Child DOX Index

No child guides are currently required; this file owns `test/`.
