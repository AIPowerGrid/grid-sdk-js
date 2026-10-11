// SPDX-License-Identifier: MIT
// Private two-phase IPC; only synthetic unfunded signatures, never a network.
import readline from "node:readline";
import { webcrypto } from "node:crypto";
import {
  prepareVideoAuthorization,
  signVideoAuthorization,
} from "../dist/index.js";

const lines = readline
  .createInterface({ input: process.stdin, crlfDelay: Infinity })
  [Symbol.asyncIterator]();
try {
  const first = await lines.next();
  if (first.done || Buffer.byteLength(first.value) > 128 * 1024)
    throw new Error("invalid fixture");
  const { quote, policy } = JSON.parse(first.value);
  const options = { ...policy, subtle: webcrypto.subtle };
  const preview = await prepareVideoAuthorization(quote, options);
  let called = false,
    blocked = false;
  try {
    await signVideoAuthorization(preview, () => {
      called = true;
      throw new Error("must not run");
    });
  } catch (error) {
    blocked = error.kind === "payment_disabled";
  }
  if (!blocked || called || quote.payment_enabled !== false)
    throw new Error("preview boundary failed");
  // Model only a future enabled server locally. This does not alter the SQL quote.
  const request = await prepareVideoAuthorization(
    { ...quote, payment_enabled: true },
    options,
  );
  process.stdout.write(
    JSON.stringify({
      phase: "unsigned",
      previewBlocked: blocked,
      called,
      authorization: request.authorization,
      typedData: request.typedData,
    }) + "\n",
  );
  const second = await lines.next();
  if (second.done || Buffer.byteLength(second.value) > 1024)
    throw new Error("invalid fixture");
  const { signature } = JSON.parse(second.value);
  const signed = await signVideoAuthorization(request, () => signature);
  process.stdout.write(
    JSON.stringify({
      phase: "signed",
      quoteId: signed.quoteId,
      jobId: signed.jobId,
      payload: signed.payload,
      hidden: !JSON.stringify(signed).includes(signature),
    }) + "\n",
  );
} catch {
  process.stderr.write("video payment protocol qualification failed\n");
  process.exitCode = 1;
} finally {
  await lines.return();
}
