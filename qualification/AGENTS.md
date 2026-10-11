# SDK/Core Wire Qualification

`core-wire.mjs` consumes synthetic Core router receipts on stdin and exercises
the built MIT VideoJobs client against mocked fetch responses. It is invoked
by the Python peer's optional Core SQL/auth qualification test. It makes no
network calls, reads no credentials and cannot prove GPU/media quality.

`core-http.mjs` separately uses unmocked SDK fetch against an explicitly supplied
ephemeral `127.0.0.1` Core server. The parent supplies only isolated fixture keys
on stdin, commits a synthetic completion between the pending/observe handshake,
and records actual requests. Never use production keys/URLs, inherit proxy or
Node-option environment variables, or print source bodies/credentials. Require
one POST, GET-only lost-reply/terminal recovery, and 401/403/404 isolation after
admission rollback. No real workers, storage or funds are involved.

Build with `npm run build` first. The fixture must have one immutable body/key,
pending/completed envelopes and an explicit lost-reply flag. Require one POST
and GET-only recovery; emit bounded synthetic results for the parent test.
