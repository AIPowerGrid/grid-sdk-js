// SPDX-License-Identifier: MIT
/** Candidate credit-backed video jobs; no POST retries or asset downloads. */

export type VideoJobState =
  | 'pending_dispatch'
  | 'queued'
  | 'execution_uncertain'
  | 'completed'
  | 'closed_without_result';

export interface VideoJobRequest {
  prompt: string;
  model: string;
  max_cost_micro_usd: number;
  frames?: number;
  seconds?: number;
  fps?: number;
  size?: string;
  /** Literal opening frame, NOT appearance-only character guidance. */
  image?: string;
  keyframes?: Array<{ image: string; frame: number; strength?: number }>;
  /** Inline WAV; the server validates sample rate, channels and exact duration. */
  reference_audio?: string;
  /** Inline MP4; requires separate reference_audio and explicit size. */
  reference_video?: string;
  [field: string]: unknown;
}

export interface VideoMedia {
  url: string;
  key: string;
  sha256: string;
  seed?: number | null;
}

export interface VideoResult {
  model: string;
  worker: string;
  gen_time: number;
  recipe_root?: string | null;
  media: VideoMedia[];
}

export interface VideoJob {
  schema: 'aipg.video-job.v1';
  job_id: string;
  model: string;
  state: VideoJobState;
  request_hash: string;
  reserved_micro: number;
  max_cost_micro: number;
  actual_micro: number | null;
  result: VideoResult | null;
}

export interface VideoJobOptions {
  /** Optional delegated user credential for a bounded service key. */
  userToken?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type VideoJobSelector =
  | { jobId: string; idempotencyKey?: never }
  | { idempotencyKey: string; jobId?: never };

export class VideoJobError extends Error {
  constructor(
    readonly kind: string,
    readonly httpStatus?: number,
    readonly submissionUncertain = false,
  ) {
    super(`Grid video job ${kind}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`);
    this.name = 'VideoJobError';
  }
}

const FEATURE = 'video-async-credit-jobs-v1';
const SOURCE_FEATURE = 'video-source-conditioning-v1';
const MAX_JSON = 64 * 1024;
const MAX_BODY = 64 * 1024 * 1024 + MAX_JSON;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const STATES = new Set([
  'pending_dispatch',
  'queued',
  'execution_uncertain',
  'completed',
  'closed_without_result',
]);
const TERMINAL = new Set(['completed', 'closed_without_result']);

function positive(value: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 2_147_483_647
  ) {
    throw new TypeError(
      'timeouts and poll intervals must be positive, finite timer-safe values',
    );
  }
  return value;
}

function uuid(value: string, key = false): string {
  if (
    typeof value !== 'string' ||
    !UUID.test(value) ||
    (key && (value[14] !== '4' || !/[89ab]/.test(value[19])))
  ) {
    throw new TypeError('use a canonical UUIDv4 key or canonical UUID job id');
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function money(value: unknown, zero = false): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= (zero ? 0 : 1)
  );
}

function text(value: unknown, max: number, empty = false): value is string {
  return (
    typeof value === 'string' &&
    value.length >= (empty ? 0 : 1) &&
    value.length <= max
  );
}

function media(value: unknown): value is VideoMedia {
  if (
    !record(value) ||
    !text(value.url, 4096) ||
    !text(value.key, 2048) ||
    typeof value.sha256 !== 'string' ||
    !HASH.test(value.sha256) ||
    (value.seed != null && !money(value.seed, true))
  )
    return false;
  try {
    const url = new URL(value.url);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function status(value: unknown): VideoJob {
  if (!record(value)) throw new VideoJobError('invalid_response');
  const valid =
    value.schema === 'aipg.video-job.v1' &&
    typeof value.job_id === 'string' &&
    UUID.test(value.job_id) &&
    text(value.model, 255) &&
    typeof value.state === 'string' &&
    STATES.has(value.state) &&
    typeof value.request_hash === 'string' &&
    HASH.test(value.request_hash) &&
    money(value.reserved_micro) &&
    money(value.max_cost_micro) &&
    value.reserved_micro <= value.max_cost_micro &&
    (value.actual_micro === null ||
      (money(value.actual_micro, true) &&
        value.actual_micro <= value.max_cost_micro));
  if (!valid) throw new VideoJobError('invalid_response');
  if (value.state === 'completed') {
    const result = value.result;
    if (
      value.actual_micro === null ||
      !record(result) ||
      result.model !== value.model ||
      !text(result.worker, 255, true) ||
      typeof result.gen_time !== 'number' ||
      !Number.isFinite(result.gen_time) ||
      result.gen_time < 0 ||
      (result.recipe_root != null && !text(result.recipe_root, 255, true)) ||
      !Array.isArray(result.media) ||
      result.media.length !== 1 ||
      !result.media.every(media)
    ) {
      throw new VideoJobError('invalid_response');
    }
  } else if (
    value.result !== null ||
    (!TERMINAL.has(value.state as string) && value.actual_micro !== null)
  ) {
    throw new VideoJobError('invalid_response');
  }
  return value as unknown as VideoJob;
}

function bound(current: VideoJob, expected: VideoJob): VideoJob {
  for (const field of [
    'job_id',
    'model',
    'request_hash',
    'reserved_micro',
    'max_cost_micro',
  ] as const) {
    if (current[field] !== expected[field])
      throw new VideoJobError('changed_identity');
  }
  return current;
}

function submission(body: VideoJobRequest): {
  encoded: string;
  model: string;
  ceiling: number;
  source: boolean;
} {
  let encoded: string;
  try {
    encoded = JSON.stringify(body, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new TypeError();
      return value;
    });
  } catch {
    throw new TypeError('video body must be finite JSON');
  }
  if (
    typeof encoded !== 'string' ||
    new TextEncoder().encode(encoded).byteLength > MAX_BODY
  ) {
    throw new TypeError('video body exceeds the request limit');
  }
  const snapshot: unknown = JSON.parse(encoded);
  if (
    !record(snapshot) ||
    !text(snapshot.model, 255) ||
    !text(snapshot.prompt, 8000) ||
    !money(snapshot.max_cost_micro_usd) ||
    (snapshot.n !== undefined && snapshot.n !== 1) ||
    (snapshot.image &&
      Array.isArray(snapshot.keyframes) &&
      snapshot.keyframes.length) ||
    (snapshot.reference_video && (!snapshot.reference_audio || !snapshot.size))
  ) {
    throw new TypeError(
      'invalid video body; explicit model, prompt and positive exact cost ceiling required',
    );
  }
  return {
    encoded,
    model: snapshot.model,
    ceiling: snapshot.max_cost_micro_usd,
    source: !!(snapshot.reference_audio || snapshot.reference_video),
  };
}

/** Persist key + immutable body before submit. Recovery and waiting are GET-only. */
export class VideoJobs {
  private readonly base: string;
  private readonly health: string;

  constructor(
    private readonly apiKey: string,
    baseURL: string,
  ) {
    let url: URL;
    try {
      url = new URL(baseURL);
    } catch {
      throw new TypeError('video jobs require a valid http(s) /v1 base');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.replace(/\/+$/, '').endsWith('/v1')
    ) {
      throw new TypeError(
        'video jobs require an http(s) /v1 base without credentials, query or fragment',
      );
    }
    this.base = baseURL.replace(/\/+$/, '');
    this.health = this.base.slice(0, -3) + '/health';
    this.headers();
  }

  private headers(userToken?: string, key?: string): Record<string, string> {
    if (
      [this.apiKey, ...(userToken !== undefined ? [userToken] : [])].some(
        (value) =>
          typeof value !== 'string' || !value || /[^\x20-\x7e]/.test(value),
      )
    ) {
      throw new TypeError(
        'credentials must be nonempty printable ASCII header values',
      );
    }
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...(userToken !== undefined ? { 'X-Grid-User-Token': userToken } : {}),
      ...(key !== undefined ? { 'Idempotency-Key': uuid(key, true) } : {}),
    };
  }

  private async request(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
    body?: string,
    signal?: AbortSignal,
  ): Promise<{ value: unknown; code: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), positive(timeoutMs));
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (signal?.aborted) throw new VideoJobError('cancelled');
      const response = await fetch(url, {
        method,
        headers,
        body,
        redirect: 'error',
        signal: controller.signal,
      });
      if (!(method === 'POST' ? [200, 202] : [200]).includes(response.status)) {
        await response.body?.cancel();
        throw new VideoJobError('http_error', response.status);
      }
      if (!response.body) throw new VideoJobError('invalid_response');
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0;
      let raw = '';
      try {
        while (true) {
          const next = await reader.read();
          if (controller.signal.aborted) throw new VideoJobError('deadline');
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_JSON) throw new VideoJobError('response_too_large');
          raw += decoder.decode(next.value, { stream: true });
        }
        raw += decoder.decode();
        try {
          return { value: JSON.parse(raw) as unknown, code: response.status };
        } catch {
          throw new VideoJobError('invalid_response');
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    } catch (error: unknown) {
      if (error instanceof VideoJobError) throw error;
      throw new VideoJobError(
        signal?.aborted
          ? 'cancelled'
          : controller.signal.aborted
            ? 'deadline'
            : 'transport_error',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  /** Contract support only; not admission, pricing or worker availability. */
  async capabilities(opts: VideoJobOptions = {}): Promise<string[]> {
    const { value } = await this.request(
      'GET',
      this.health,
      {},
      opts.timeoutMs ?? 30_000,
      undefined,
      opts.signal,
    );
    if (
      !record(value) ||
      !Array.isArray(value.features) ||
      !value.features.every((item) => typeof item === 'string')
    ) {
      throw new VideoJobError('invalid_capabilities');
    }
    return value.features as string[];
  }

  async submit(
    body: VideoJobRequest,
    opts: VideoJobOptions & { idempotencyKey: string },
  ): Promise<VideoJob> {
    const input = submission(body);
    const headers = this.headers(opts.userToken, opts.idempotencyKey);
    const features = await this.capabilities(opts);
    if (
      !features.includes(FEATURE) ||
      (input.source && !features.includes(SOURCE_FEATURE))
    ) {
      throw new VideoJobError('contract_unavailable');
    }
    try {
      const response = await this.request(
        'POST',
        this.base + '/videos/jobs',
        headers,
        opts.timeoutMs ?? 30_000,
        input.encoded,
        opts.signal,
      );
      const result = status(response.value);
      if (
        result.model !== input.model ||
        result.max_cost_micro !== input.ceiling ||
        response.code !== (TERMINAL.has(result.state) ? 200 : 202)
      )
        throw new VideoJobError('invalid_response');
      return result;
    } catch (error: unknown) {
      if (error instanceof VideoJobError)
        throw new VideoJobError(error.kind, error.httpStatus, true);
      throw error;
    }
  }

  async recover(
    selector: VideoJobSelector,
    opts: VideoJobOptions = {},
  ): Promise<VideoJob> {
    if (
      (selector.jobId === undefined) ===
      (selector.idempotencyKey === undefined)
    ) {
      throw new TypeError('provide exactly one of jobId and idempotencyKey');
    }
    const path =
      selector.jobId === undefined
        ? '/videos/jobs'
        : '/videos/jobs/' + uuid(selector.jobId);
    const result = status(
      (
        await this.request(
          'GET',
          this.base + path,
          this.headers(opts.userToken, selector.idempotencyKey),
          opts.timeoutMs ?? 30_000,
          undefined,
          opts.signal,
        )
      ).value,
    );
    if (selector.jobId !== undefined && result.job_id !== selector.jobId)
      throw new VideoJobError('changed_identity');
    return result;
  }

  async wait(
    receipt: VideoJob,
    opts: VideoJobOptions & {
      pollIntervalMs?: number;
      requestTimeoutMs?: number;
    } = {},
  ): Promise<VideoJob> {
    const deadline = performance.now() + positive(opts.timeoutMs ?? 600_000);
    const interval = positive(opts.pollIntervalMs ?? 5_000);
    const requestTimeout = positive(opts.requestTimeoutMs ?? 30_000);
    const anchor = { ...status(receipt) };
    let current = status(receipt);
    while (!TERMINAL.has(current.state)) {
      if (opts.signal?.aborted) throw new VideoJobError('cancelled');
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new VideoJobError('deadline');
      current = bound(
        await this.recover(
          { jobId: anchor.job_id },
          {
            userToken: opts.userToken,
            timeoutMs: Math.min(remaining, requestTimeout),
            signal: opts.signal,
          },
        ),
        anchor,
      );
      if (!TERMINAL.has(current.state)) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () =>
            opts.signal?.removeEventListener('abort', cancel);
          const timer = setTimeout(
            () => {
              cleanup();
              resolve();
            },
            Math.min(interval, Math.max(0, deadline - performance.now())),
          );
          const cancel = () => {
            clearTimeout(timer);
            cleanup();
            reject(new VideoJobError('cancelled'));
          };
          opts.signal?.addEventListener('abort', cancel, { once: true });
          if (opts.signal?.aborted) cancel();
        });
      }
    }
    return current;
  }
}
