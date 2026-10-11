// SPDX-License-Identifier: MIT
// Real loopback Core transport; the Python peer owns synthetic SQL fixtures.
import { createInterface } from 'node:readline';
import { VideoJobs, VideoJobError } from '../dist/video-jobs.js';

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const lines = input[Symbol.asyncIterator]();

async function read() {
  const item = await lines.next();
  if (item.done || Buffer.byteLength(item.value) > 2 * 1024 * 1024)
    throw new Error('invalid qualification input');
  return JSON.parse(item.value);
}

function emit(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

try {
  const fixture = await read();
  const origin = new URL(fixture.origin);
  if (
    origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' ||
    !origin.port || origin.pathname !== '/' || origin.search ||
    origin.hash || origin.username || origin.password
  ) throw new Error('qualification requires an ephemeral loopback server');
  const jobs = new VideoJobs(fixture.credential, origin.origin + '/v1');
  const options = { idempotencyKey: fixture.key, timeoutMs: 10_000 };
  let pending;
  try {
    pending = await jobs.submit(fixture.body, options);
    if (fixture.lost) throw new Error('expected uncertain submission');
  } catch (error) {
    if (
      !fixture.lost || !(error instanceof VideoJobError) ||
      !error.submissionUncertain || error.httpStatus !== 503
    ) throw error;
  }
  const recovered = await jobs.recover({ idempotencyKey: fixture.key }, options);
  if (pending && JSON.stringify(pending) !== JSON.stringify(recovered))
    throw new Error('request recovery changed the accepted receipt');
  pending = recovered;
  emit({ stage: 'pending', pending });

  const observation = await read();
  const denied = [];
  for (const [credential, expected] of observation.denied) {
    try {
      await new VideoJobs(credential, origin.origin + '/v1').recover(
        { jobId: pending.job_id }, { timeoutMs: 10_000 },
      );
      throw new Error('unauthorized recovery succeeded');
    } catch (error) {
      if (!(error instanceof VideoJobError) || error.httpStatus !== expected)
        throw error;
      denied.push(error.httpStatus);
    }
  }
  const terminal = await jobs.wait(pending, { timeoutMs: 10_000 });
  const replay = await jobs.recover({ idempotencyKey: fixture.key }, options);
  if (JSON.stringify(terminal) !== JSON.stringify(replay))
    throw new Error('terminal recovery changed the committed receipt');
  emit({ stage: 'completed', terminal, denied });
} catch (error) {
  // Never emit credentials, source bodies or upstream exception messages.
  emit({ stage: 'failed', error: error instanceof VideoJobError ? 'VideoJobError' : 'qualification_error' });
  process.exitCode = 1;
} finally {
  input.close();
}
