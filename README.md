# AI Power Grid — JavaScript / TypeScript SDK

Free, decentralized, OpenAI-compatible AI inference.

The Grid API speaks the OpenAI protocol, so this SDK is a thin subclass of the
official `openai` package: it points at the Grid, reads your key from the
environment, and adds Grid-specific conveniences. Everything you know from the
OpenAI SDK works unchanged.

## Install

```bash
npm install aipowergrid
```

## Quick start

Get a free API key at [api.aipowergrid.io/register](https://api.aipowergrid.io/register),
then set it as `AIPG_API_KEY`:

```ts
import { AIPG } from 'aipg';

const client = new AIPG(); // reads AIPG_API_KEY from the environment

const stream = await client.chat.completions.create({
  model: 'grid/llama-3.3-70b-versatile',
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
const client = new AIPG();
console.log(await client.onlineModels());
// ['grid/llama-3.3-70b-versatile', 'grid/qwen3-32b', ...]
```

An empty array means no workers are connected — requests will 503 until one is.

## It's just OpenAI underneath

`AIPG` extends the `openai` client, so anything the OpenAI SDK does — images,
tool calling, structured output, the full `.chat` / `.images` / `.models`
surface — works here too. You can also point existing OpenAI code at the Grid
by setting `baseURL: 'https://api.aipowergrid.io/v1'` if you'd rather not
switch packages.

## Config

| | |
|---|---|
| `new AIPG({ apiKey })` | Explicit key (overrides env) |
| `AIPG_API_KEY` | Env var read when no key is passed |
| `new AIPG({ baseURL })` | Override the endpoint (default `https://api.aipowergrid.io/v1`) |

All other [`openai` client options](https://github.com/openai/openai-node) are
passed straight through.

## Links

- [Docs](https://aipowergrid.io/docs)
- [Get a free API key](https://api.aipowergrid.io/register)
- [Discord](https://discord.gg/W9D8j6HCtC)

## License

MIT
