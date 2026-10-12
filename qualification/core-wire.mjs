// SPDX-License-Identifier: MIT
import { VideoJobs, VideoJobError } from '../dist/video-jobs.js';

let raw = '';
for await (const chunk of process.stdin) {
  raw += chunk.toString('utf8');
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
    throw new Error('fixture too large');
}
const fixture = JSON.parse(raw);
let postCount = 0;
let postedBody;
globalThis.fetch = async (url, init) => {
  const response = (value) => new Response(JSON.stringify(value));
  if (url === 'http://test/health') {
    if (Object.keys(init.headers).length)
      throw new Error('credential on health');
    return response({
      features: ['video-async-credit-jobs-v1', 'video-source-conditioning-v1'],
    });
  }
  if (url === 'http://test/v1/videos/jobs' && init.method === 'POST') {
    postCount += 1;
    if (postCount !== 1 || init.headers['Idempotency-Key'] !== fixture.key)
      throw new Error('duplicate POST or key mismatch');
    postedBody = JSON.parse(init.body);
    if (fixture.lost) throw new Error('synthetic lost reply');
    return new Response(JSON.stringify(fixture.pending), { status: 202 });
  }
  if (
    url === 'http://test/v1/videos/jobs' &&
    init.method === 'GET' &&
    init.headers['Idempotency-Key'] === fixture.key
  ) {
    return response(fixture.pending);
  }
  if (
    url === 'http://test/v1/videos/jobs/' + fixture.pending.job_id &&
    init.method === 'GET'
  ) {
    return response(fixture.terminal);
  }
  throw new Error('unexpected wire request');
};
const jobs = new VideoJobs('synthetic-fixture', 'http://test/v1');
let receipt;
try {
  receipt = await jobs.submit(fixture.body, { idempotencyKey: fixture.key });
  if (fixture.lost) throw new Error('expected uncertainty');
} catch (error) {
  if (
    !fixture.lost ||
    !(error instanceof VideoJobError) ||
    !error.submissionUncertain
  )
    throw error;
  receipt = await jobs.recover({ idempotencyKey: fixture.key });
}
const terminal = await jobs.wait(receipt);
process.stdout.write(
  JSON.stringify({ body: postedBody, post_count: postCount, terminal }),
);
