// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Grid,
  VideoJobs,
  VideoJobError,
  type VideoJob,
  type VideoJobRequest,
} from '../src/index.js';

const BASE = 'https://grid.example/v1';
const KEY = '00000000-0000-4000-8000-0000000000aa'; // Public request UUID, not a credential.
const JOB = '62964058-56d2-4b84-9ba3-cd8a26ebf831';
const MODEL = 'LTX-2.5 Distilled BF16';
const FEATURES = ['video-async-credit-jobs-v1', 'video-source-conditioning-v1'];
const BODY: VideoJobRequest = {
  model: MODEL,
  prompt: 'a person waving in a car',
  frames: 33,
  fps: 24,
  max_cost_micro_usd: 50000,
};

function receipt(
  state: VideoJob['state'] = 'queued',
  changes: Record<string, unknown> = {},
): VideoJob {
  return {
    schema: 'aipg.video-job.v1',
    job_id: JOB,
    model: MODEL,
    state,
    request_hash: 'a'.repeat(64),
    reserved_micro: 12000,
    max_cost_micro: 50000,
    actual_micro: state === 'completed' ? 12000 : null,
    result:
      state === 'completed'
        ? {
            model: MODEL,
            worker: 'fixture-worker',
            gen_time: 4.5,
            recipe_root: null,
            media: [
              {
                url: 'https://media.example/test.mp4',
                key: 'test.mp4',
                sha256: 'b'.repeat(64),
                seed: null,
              },
            ],
          }
        : null,
    ...changes,
  } as VideoJob;
}

function reply(value: unknown, code = 200): Response {
  return new Response(JSON.stringify(value), { status: code });
}

describe('durable candidate video jobs', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function health(features = FEATURES): void {
    fetchMock.mockResolvedValueOnce(reply({ features }));
  }

  it('wires the new helper lazily without changing legacy custom bases', () => {
    expect(
      new Grid({ apiKey: 'fixture', baseURL: BASE }).grid.videoJobs,
    ).toBeInstanceOf(VideoJobs);
    const legacy = new Grid({
      apiKey: 'fixture',
      baseURL: 'https://grid.example/custom',
    }).grid;
    expect(() => legacy.videoJobs).toThrow(TypeError);
  });

  it.each(['generated', 'audio', 'video'])(
    'submits %s inputs once with delegation',
    async (mode) => {
      health();
      fetchMock.mockResolvedValueOnce(reply(receipt(), 202));
      const body = {
        ...BODY,
        ...(mode !== 'generated'
          ? { reference_audio: 'data:audio/wav;base64,fixture' }
          : {}),
        ...(mode === 'video'
          ? {
              reference_video: 'data:video/mp4;base64,fixture',
              size: '768x512',
            }
          : {}),
      };
      const result = await new VideoJobs('fixture', BASE).submit(body, {
        idempotencyKey: KEY,
        userToken: 'delegated-fixture',
      });
      expect(result.job_id).toBe(JOB);
      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toBe(BASE + '/videos/jobs');
      expect(JSON.parse(init!.body as string)).toEqual(body);
      expect(init!.headers).toMatchObject({
        Authorization: 'Bearer fixture',
        'Idempotency-Key': KEY,
        'X-Grid-User-Token': 'delegated-fixture',
      });
      expect(init!.redirect).toBe('error');
      expect(fetchMock.mock.calls[0][0]).toBe('https://grid.example/health');
      expect(fetchMock.mock.calls[0][1]!.headers).toEqual({});
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    { features: [] },
    { features: [FEATURES[1]] },
    { features: [FEATURES[0]] },
  ])(
    'never posts when a required capability is missing: %j',
    async ({ features }) => {
      health(features);
      await expect(
        new VideoJobs('fixture', BASE).submit(
          { ...BODY, reference_audio: 'fixture' },
          { idempotencyKey: KEY },
        ),
      ).rejects.toMatchObject({
        kind: 'contract_unavailable',
        submissionUncertain: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { max_cost_micro_usd: 0 },
    { max_cost_micro_usd: true },
    { max_cost_micro_usd: 1.2 },
    { max_cost_micro_usd: 2 ** 53 },
    { cfg_scale: NaN },
    { model: '' },
    { prompt: '' },
    { n: true },
    { n: 2 },
    { image: 'x', keyframes: [{ image: 'y' }] },
    { reference_video: 'x' },
    { reference_image: 'x' },
    { reference_image: 'x', reference_audio: 'y', size: '768x448', image: 'z' },
    {
      reference_image: 'x',
      reference_audio: 'y',
      size: '768x448',
      keyframes: [{ image: 'z' }],
    },
  ])('refuses invalid input before network: %j', async (changes) => {
    await expect(
      new VideoJobs('fixture', BASE).submit(
        { ...BODY, ...changes } as VideoJobRequest,
        { idempotencyKey: KEY },
      ),
    ).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('snapshots the body before awaiting capability checks', async () => {
    const body = { ...BODY };
    fetchMock.mockImplementationOnce(async () => {
      body.model = 'other';
      return reply({ features: FEATURES });
    });
    fetchMock.mockResolvedValueOnce(reply(receipt(), 202));
    await new VideoJobs('fixture', BASE).submit(body, { idempotencyKey: KEY });
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).model).toBe(
      MODEL,
    );
  });

  it.each([false, true])(
    'keeps appearance separate through lost-reply recovery (motion=%s)',
    async (motion) => {
      health();
      const model = 'LTX-2.5 Dev BF16 Ingredients';
      const body: VideoJobRequest = {
        ...BODY,
        model,
        size: '768x448',
        frames: 121,
        reference_image: 'data:image/png;base64,fixture',
        reference_audio: 'data:audio/wav;base64,fixture',
        reference_strength: 1,
        ...(motion
          ? {
              reference_video: 'data:video/mp4;base64,fixture',
              guide_strength: 0.5,
              motion_attention_strength: 0.25,
            }
          : {}),
      };
      fetchMock.mockRejectedValueOnce(new Error('private fixture'));
      const jobs = new VideoJobs('fixture', BASE);
      await expect(
        jobs.submit(body, { idempotencyKey: KEY }),
      ).rejects.toMatchObject({ submissionUncertain: true });
      const wire = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
      expect(wire).toEqual(body);
      expect(wire).not.toHaveProperty('image');
      expect(wire).not.toHaveProperty('keyframes');
      fetchMock.mockResolvedValueOnce(reply(receipt('queued', { model })));
      expect((await jobs.recover({ idempotencyKey: KEY })).model).toBe(model);
      expect(
        fetchMock.mock.calls.filter(([, init]) => init!.method === 'POST'),
      ).toHaveLength(1);
    },
  );

  it('recovers a lost POST reply by header without retries or health checks', async () => {
    health();
    fetchMock.mockRejectedValueOnce(new Error('private fixture'));
    const jobs = new VideoJobs('fixture', BASE);
    await expect(
      jobs.submit(BODY, { idempotencyKey: KEY }),
    ).rejects.toMatchObject({
      kind: 'transport_error',
      submissionUncertain: true,
    });
    fetchMock.mockResolvedValueOnce(reply(receipt('execution_uncertain')));
    expect(
      (
        await jobs.recover(
          { idempotencyKey: KEY },
          { userToken: 'fixture-token' },
        )
      ).state,
    ).toBe('execution_uncertain');
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe(BASE + '/videos/jobs');
    expect(init!.method).toBe('GET');
    expect(init!.headers).toMatchObject({
      'Idempotency-Key': KEY,
      'X-Grid-User-Token': 'fixture-token',
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init!.method === 'POST'),
    ).toHaveLength(1);
  });

  it.each([302, 402, 404, 409, 429, 500, 503])(
    'sanitizes HTTP %i without retrying',
    async (code) => {
      health();
      fetchMock.mockResolvedValueOnce(
        new Response('private prompt fixture', {
          status: code,
          headers: { Location: 'https://foreign.example' },
        }),
      );
      await expect(
        new VideoJobs('fixture', BASE).submit(BODY, { idempotencyKey: KEY }),
      ).rejects.toMatchObject({
        kind: 'http_error',
        httpStatus: code,
        submissionUncertain: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('waits using same-job GETs and verifies completed metadata', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(receipt('execution_uncertain')))
      .mockResolvedValueOnce(reply(receipt('completed')));
    expect(
      (
        await new VideoJobs('fixture', BASE).wait(receipt(), {
          pollIntervalMs: 1,
        })
      ).result!.media[0].sha256,
    ).toBe('b'.repeat(64));
    expect(
      fetchMock.mock.calls.every(
        ([url, init]) =>
          url === BASE + '/videos/jobs/' + JOB && init!.method === 'GET',
      ),
    ).toBe(true);
  });

  it.each([
    ['job_id', KEY],
    ['model', 'other'],
    ['request_hash', 'c'.repeat(64)],
    ['reserved_micro', 11000],
    ['max_cost_micro', 50001],
  ])('rejects changed %s identity while waiting', async (field, value) => {
    fetchMock.mockResolvedValueOnce(
      reply(receipt('queued', { [field as string]: value })),
    );
    await expect(
      new VideoJobs('fixture', BASE).wait(receipt()),
    ).rejects.toMatchObject({ kind: 'changed_identity' });
  });

  it.each([
    { schema: 'wrong' },
    { state: 'paid' },
    { actual_micro: 1 },
    { reserved_micro: true },
    { reserved_micro: 50001 },
    { max_cost_micro: 2 ** 53 },
    { request_hash: 'bad' },
    { result: {} },
    { job_id: '../other' },
  ])('rejects invalid status: %j', async (changes) => {
    fetchMock.mockResolvedValueOnce(reply(receipt('queued', changes)));
    await expect(
      new VideoJobs('fixture', BASE).recover({ jobId: JOB }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it.each(['not JSON', '{' + ' '.repeat(64 * 1024), '{"state":NaN}'])(
    'refuses malformed or oversized JSON',
    async (raw) => {
      fetchMock.mockResolvedValueOnce(new Response(raw));
      await expect(
        new VideoJobs('fixture', BASE).recover({ jobId: JOB }),
      ).rejects.toBeInstanceOf(VideoJobError);
    },
  );

  it.each([
    ['queued', 200],
    ['completed', 202],
  ] as const)('binds POST HTTP status to %s', async (state, code) => {
    health();
    fetchMock.mockResolvedValueOnce(reply(receipt(state), code));
    await expect(
      new VideoJobs('fixture', BASE).submit(BODY, { idempotencyKey: KEY }),
    ).rejects.toMatchObject({
      kind: 'invalid_response',
      submissionUncertain: true,
    });
  });

  it.each([0, -1, NaN, Infinity, 2 ** 53])(
    'rejects unsafe timeouts: %s',
    async (value) => {
      await expect(
        new VideoJobs('fixture', BASE).wait(receipt(), { timeoutMs: value }),
      ).rejects.toThrow(TypeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('deadline only polls, never creates a replacement job', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => reply(receipt()));
    const result = new VideoJobs('fixture', BASE).wait(receipt(), {
      timeoutMs: 20,
      pollIntervalMs: 5,
    });
    const assertion = expect(result).rejects.toMatchObject({
      kind: 'deadline',
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(
      fetchMock.mock.calls.every(([, init]) => init!.method === 'GET'),
    ).toBe(true);
  });

  it('cancels waiting without a POST', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      queueMicrotask(() => controller.abort());
      return reply(receipt());
    });
    await expect(
      new VideoJobs('fixture', BASE).wait(receipt(), {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(VideoJobError);
    expect(
      fetchMock.mock.calls.every(([, init]) => init!.method === 'GET'),
    ).toBe(true);
  });

  it('does not label a closed paid job as refunded', async () => {
    const closed = receipt('closed_without_result', { actual_micro: 12000 });
    expect(await new VideoJobs('fixture', BASE).wait(closed)).toEqual(closed);
    expect(fetchMock).not.toHaveBeenCalled();
    expect('refunded' in closed).toBe(false);
  });

  it.each(['', 'private\r\nInjected: x', 'private\0', 'private\u2603'])(
    'rejects invalid credentials before network',
    async (token) => {
      await expect(
        new VideoJobs('fixture', BASE).recover(
          { jobId: JOB },
          { userToken: token },
        ),
      ).rejects.toThrow('printable ASCII header values');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { jobId: JOB, idempotencyKey: KEY },
    { jobId: '../x' },
    { idempotencyKey: KEY.toUpperCase() },
    { idempotencyKey: '00000000-0000-1000-8000-000000000000' },
  ])('rejects invalid recovery selectors', async (selector) => {
    await expect(
      new VideoJobs('fixture', BASE).recover(
        selector as Parameters<VideoJobs['recover']>[0],
      ),
    ).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses completed media with non-HTTP URLs', async () => {
    const value = receipt('completed');
    value.result!.media[0].url = 'file:///private/fixture';
    fetchMock.mockResolvedValueOnce(reply(value));
    await expect(
      new VideoJobs('fixture', BASE).recover({ jobId: JOB }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
