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
OpenAI-shaped result. Use `timeoutMs` for long media jobs; there is no SDK
submit/poll mode on this `/v1` client.

## It's just OpenAI underneath

`Grid` extends the `openai` client, so anything the OpenAI SDK does — images,
tool calling, structured output, the full `.chat` / `.images` / `.models`
surface — works here too. You can also point existing OpenAI code at the Grid
by setting `baseURL: 'https://api.aipowergrid.io/v1'` if you'd rather not
switch packages.

## Config

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
