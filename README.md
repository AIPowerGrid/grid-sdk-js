# AI Power Grid — JavaScript / TypeScript SDK

Open-model, OpenAI-compatible inference across community-operated GPUs.

> **Release status:** `grid-ai` is staged for its initial npm publication. The
> install command below becomes available when the first verified release is
> published; until then, use the OpenAI SDK with the Grid base URL shown below.

The Grid API speaks the OpenAI protocol, so this SDK is a thin subclass of the
official `openai` package: it points at the Grid, reads your key from the
environment, and adds Grid-specific conveniences. Everything you know from the
OpenAI SDK works unchanged.

## Install

```bash
npm install grid-ai
```

## Quick start

Sign in at the [Grid developer console](https://console.aipowergrid.io/dashboard/api-key),
create an API key, then set it as `AIPG_API_KEY`:

```ts
import { Grid } from 'grid-ai';

const client = new Grid(); // reads AIPG_API_KEY from the environment

const stream = await client.chat.completions.create({
  model: 'gpt-oss-120b',
  messages: [{ role: 'user', content: 'Explain AI Power Grid in one line.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

## See what's online

The Grid's available models change as workers connect and disconnect. Don't
hardcode a model blindly — ask which ones are servable right now:

```ts
const client = new Grid();
console.log(await client.onlineModels());
// ['gpt-oss-120b', 'qwen3-27b', ...]
```

An empty array means no workers are connected — requests will 503 until one is.

## Credits

```ts
const credits = await client.grid.credits();
console.log(credits.total_spendable_usd);
```

This is Core's canonical promotional, daily-free, and purchased account view.
The SDK does not maintain a local free-use counter.

## Video, img2img, ControlNet, LoRAs — the full Grid

The OpenAI-compatible surface covers text and basic txt2img. For the full media
parameter surface, use `client.grid`, which calls the synchronous `/v1` image
and video endpoints:

```ts
const client = new Grid();

// Video:
const result = await client.grid.video('a timelapse of a city at night', {
  model: 'LTX-2.3',
  width: 768,
  height: 512,
  seconds: 4,
  fps: 24,
});

// img2img / ControlNet / LoRAs — anything the workers support:
const img = await client.grid.image('make it watercolor', {
  models: ['FLUX.2 Klein 4B FP8'],
  sourceImage: '<base64>',
  params: { loras: [{ name: 'watercolor', model: 1.0 }] },
});

// Or full control with a raw payload:
const raw = await client.grid.generate({ prompt: '...', models: ['...'], params: {} });
```

`client.grid` waits for the synchronous Grid response and returns the finished
OpenAI-shaped result. Use `timeoutMs` for long media jobs. These existing calls
do not use the separate video-jobs lifecycle below.

## Candidate Durable Video Jobs

This branch's `0.2.0-preview.1` adds `client.grid.videoJobs`. It requires the
candidate Core `/v1/videos/jobs` contract, which is default-off and **not a
public production feature yet**. Installing this SDK does not enable admission,
qualify a worker or authorize spending.

```ts
import { randomUUID } from 'node:crypto';

const jobs = client.grid.videoJobs;
const key = randomUUID();
const body = {
  model: 'LTX-2.5 Distilled BF16',
  prompt: 'A person waves from inside a parked car',
  frames: 33,
  fps: 24,
  max_cost_micro_usd: 50_000, // $0.05 ceiling, not a quote
  // Audio-to-video: reference_audio: 'data:audio/wav;base64,...'
  // Video-to-video: also reference_video: 'data:video/mp4;base64,...'
  // Video reference requires an explicit size, e.g. size: '768x512'.
};
// Durably save key + immutable body in your application's private journal FIRST.
// Do not generate a fresh key when recovering this operation.
const receipt = await jobs.submit(body, { idempotencyKey: key });
// Save the accepted receipt before waiting or downloading any result.
const terminal = await jobs.wait(receipt, { timeoutMs: 600_000 });
```

`submit` checks `/health` contract features without credentials, then sends
**one POST**. Core still owns worker availability, recipe/input validation,
live pricing and the atomic credit hold. There is no model fallback, automatic
POST retry, asset download or client-side billing counter. Costs are integer
micro-USD, limited to `Number.MAX_SAFE_INTEGER` for exact parity with Python.

If the reply is lost, malformed, cancelled or fails after POST begins, preserve
the saved key and use `jobs.recover({ idempotencyKey: key })`. Once you have a
job ID, use `jobs.recover({ jobId: receipt.job_id })` or `jobs.wait(receipt)`.
Recovery is **GET-only**, does not re-upload sources, and bypasses capability
preflight so accepted jobs remain recoverable after new admission is disabled.
404/409/5xx are surfaced; none triggers another submission. A `VideoJobError`
reports sanitized `kind`, `httpStatus`, and `submissionUncertain`; HTTP errors
after POST are conservatively uncertain, even if Core probably rejected them.
`signal: AbortSignal` supports cancellation; cancellation still requires
recovery and does not prove the job was cancelled.

`wait` returns `completed` or `closed_without_result`, validating stable job,
model, request hash, held amount and ceiling on every poll. The latter means
no recoverable output, **not proof of a refund**. Timeout does not release a
hold or start another render. The returned hashes are metadata commitments;
the SDK does not download, hash or quality-check the output.

For delegated service calls, pass `{ userToken }` to submit/recover/wait;
it travels only in `X-Grid-User-Token`, never a URL. Keep service credentials
server-side. The SDK refuses redirects on the new authenticated paths.

Source inputs must be inline, server-validated WAV/MP4, not arbitrary remote
URLs. Audio uses stereo PCM16 WAV at 48 kHz, exactly `frames * 2000` samples
at 24 fps. Video uses frame-matched 24-fps H.264 MP4 plus a separate WAV and
explicit output size. Current LTX frame/recipe gates remain authoritative.
An `image` or timed `keyframes` pin constrains actual frames: **it is not an
appearance-only identity reference**. Character-reference adapters are separate
qualification work, not supported by this helper. x402 video payments are a
proposal, not an implemented SDK payment rail.

## It's just OpenAI underneath

`Grid` extends the `openai` client, so anything the OpenAI SDK does — images,
tool calling, structured output, the full `.chat` / `.images` / `.models`
surface — works here too. You can also point existing OpenAI code at the Grid
by setting `baseURL: 'https://api.aipowergrid.io/v1'` if you'd rather not
switch packages.

## Config

Optional Core wire replay lives in `qualification/core-wire.mjs`; the Python
peer's `qualification/test_core_video_jobs.py` supplies actual synthetic-Core
receipts after scoped-auth/SQL tests. Build this SDK first. This proves receipt
parity and no-resubmission behavior, not live JavaScript HTTP-to-Core, GPU output,
funded R2 lifecycle or production availability.

Development: use Node 22.12+ or Node 24 for `npm ci`, `npm run build` and
`npm test` (pinned Vitest 5). The published SDK runtime still supports Node 18+.

| | |
|---|---|
| `new Grid({ apiKey })` | Explicit key (overrides env) |
| `AIPG_API_KEY` | Env var read when no key is passed |
| `new Grid({ baseURL })` | Override the endpoint (default `https://api.aipowergrid.io/v1`) |

All other [`openai` client options](https://github.com/openai/openai-node) are
passed straight through.

## Links

- [Docs](https://aipowergrid.io/docs)
- [Get an API key](https://console.aipowergrid.io/dashboard/api-key)
- [Discord](https://discord.gg/W9D8j6HCtC)

## License

MIT
