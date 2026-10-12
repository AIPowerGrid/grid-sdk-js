# grid-ai tests

## Purpose

Vitest contract tests for the public JavaScript/TypeScript SDK and native Grid
media helper.

## Ownership

- `client.test.ts` - constructor, defaults, aliases, and OpenAI-compatible client.
- `grid.test.ts` - synchronous `/v1` image/video request shapes and responses.
- `video-jobs.test.ts` - candidate source-aware submission, delegated auth,
  uncertain replies, GET-only recovery, bounded polling and immutable identity.
  Appearance cases keep reference PNG/audio/optional video and controls intact
  after reply loss; mixed opening pins reject before HTTP. These synthetic
  inline strings are wire fixtures, not decoded or native quality evidence.
  Omitted/explicit reference attention is covered for both appearance modes;
  lost accepted replies retain the exact original submission body.
- `runtime.smoke.mjs` - dependency-free Node test of the compiled package with
  runtime dependencies only on Node 18/20/22/24; build first. It uses synthetic
  fetch responses, not live media, and is separate from Vitest discovery.
  It also covers quote preparation and preview signer refusal with explicit
  built-in Web Crypto for environments without global crypto.
- `video-payments.test.ts` - independent policy/domain/nonce/type/window bounds,
  immutable views, preview-before-callback and signer/expiry errors. Synthetic
  callbacks are not live wallet, ECDSA, chain or funding qualification.
  Require binding-v3 upfront/EIP-3009 and explicit acceptance; default/false,
  coerced consent, legacy terms and mutation during digest work reject signing.

## Local Contracts

- Mock HTTP; never use production keys or consume live credits in unit tests.
- Assert exact method, URL, headers, body, sync semantics, and public exports.
- Keep tests paired with `src/` behavior and cover async/error paths as well as
  successful results.
- Preserve legacy custom-base construction. The candidate helper validates
  its own `/v1` base without tightening old generation behavior. Mock actual
  streamed Response bodies, not only `json()` return values.

## Work Guidance

- Add a regression for every public API or wire-contract change.
- Do not update snapshots merely to bless an unintended breaking change.

## Verification

- Run `npm test` and `npm run build` from the repository root.

## Child DOX Index

No child guides are currently required; this file owns `test/`.
