# SDK/Core Wire Qualification

`core-wire.mjs` consumes synthetic Core router receipts on stdin and exercises
the built MIT VideoJobs client against mocked fetch responses. It is invoked
by the Python peer's optional Core SQL/auth qualification test. It makes no
network calls, reads no credentials and cannot prove GPU/media quality.

Build with `npm run build` first. The fixture must have one immutable body/key,
pending/completed envelopes and an explicit lost-reply flag. Require one POST
and GET-only recovery; emit bounded synthetic results for the parent test.
