// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { Grid, VideoJobs } from '../dist/index.js';

test('compiled SDK runtime: legacy media and source-aware video recovery', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const key = '00000000-0000-4000-8000-0000000000aa'; // Public request UUID.
  const job = '62964058-56d2-4b84-9ba3-cd8a26ebf831';
  const model = 'LTX-2.5 Distilled BF16';
  const pending = {
    schema: 'aipg.video-job.v1',
    job_id: job,
    model,
    state: 'pending_dispatch',
    request_hash: 'a'.repeat(64),
    reserved_micro: 12000,
    max_cost_micro: 50000,
    actual_micro: null,
    result: null,
  };
  const completed = {
    ...pending,
    state: 'completed',
    actual_micro: 12000,
    result: {
      model,
      worker: 'fixture',
      gen_time: 1,
      recipe_root: null,
      media: [
        {
          url: 'https://media.example/test.mp4',
          key: 'test.mp4',
          sha256: 'b'.repeat(64),
          seed: 42,
        },
      ],
    },
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    if (url.endsWith('/health'))
      return new Response(
        JSON.stringify({
          features: [
            'video-async-credit-jobs-v1',
            'video-source-conditioning-v1',
          ],
        }),
      );
    if (url.endsWith('/videos/jobs') && init.method === 'POST') {
      assert.equal(init.headers['Idempotency-Key'], key);
      return new Response(JSON.stringify(pending), { status: 202 });
    }
    if (url.endsWith('/videos/jobs/' + job) && init.method === 'GET') {
      return new Response(JSON.stringify(completed));
    }
    if (url.endsWith('/images/generations')) {
      return new Response(
        JSON.stringify({ data: [{ url: 'https://media.example/test.webp' }] }),
      );
    }
    throw new Error('unexpected fixture request');
  };
  try {
    const grid = new Grid({
      apiKey: 'fixture',
      baseURL: 'https://grid.example/v1',
    });
    assert.ok(grid.grid.videoJobs instanceof VideoJobs);
    assert.ok(
      new Grid({ apiKey: 'fixture', baseURL: 'https://grid.example/custom' })
        .grid,
    );
    assert.equal(
      (await grid.grid.image('fixture', { model: 'fixture' })).data.length,
      1,
    );
    for (const mode of ['generated', 'audio', 'video']) {
      const body = {
        model,
        prompt: 'fixture',
        frames: 33,
        fps: 24,
        max_cost_micro_usd: 50000,
        ...(mode !== 'generated' ? { reference_audio: 'inline-fixture' } : {}),
        ...(mode === 'video'
          ? { reference_video: 'inline-fixture', size: '768x512' }
          : {}),
      };
      const receipt = await grid.grid.videoJobs.submit(body, {
        idempotencyKey: key,
      });
      assert.deepEqual(await grid.grid.videoJobs.wait(receipt), completed);
      assert.deepEqual(JSON.parse(calls.at(-2).body), body);
    }
    assert.equal(
      calls.filter(
        (call) => call.url.endsWith('/videos/jobs') && call.method === 'POST',
      ).length,
      3,
    );
  } finally {
    globalThis.fetch = original;
  }
});
