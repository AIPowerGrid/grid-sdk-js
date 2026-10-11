// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  Grid,
  VideoJobs,
  prepareVideoAuthorization,
  signVideoAuthorization,
} from "../dist/index.js";

test("compiled SDK runtime: legacy media and source-aware video recovery", async () => {
  const original = globalThis.fetch;
  const calls = [];
  const key = "00000000-0000-4000-8000-0000000000aa"; // Public request UUID.
  const job = "62964058-56d2-4b84-9ba3-cd8a26ebf831";
  const model = "LTX-2.5 Distilled BF16";
  const pending = {
    schema: "aipg.video-job.v1",
    job_id: job,
    model,
    state: "pending_dispatch",
    request_hash: "a".repeat(64),
    reserved_micro: 12000,
    max_cost_micro: 50000,
    actual_micro: null,
    result: null,
  };
  const completed = {
    ...pending,
    state: "completed",
    actual_micro: 12000,
    result: {
      model,
      worker: "fixture",
      gen_time: 1,
      recipe_root: null,
      media: [
        {
          url: "https://media.example/test.mp4",
          key: "test.mp4",
          sha256: "b".repeat(64),
          seed: 42,
        },
      ],
    },
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    if (url.endsWith("/health"))
      return new Response(
        JSON.stringify({
          features: [
            "video-async-credit-jobs-v1",
            "video-source-conditioning-v1",
          ],
        }),
      );
    if (url.endsWith("/videos/jobs") && init.method === "POST") {
      assert.equal(init.headers["Idempotency-Key"], key);
      return new Response(JSON.stringify(pending), { status: 202 });
    }
    if (url.endsWith("/videos/jobs/" + job) && init.method === "GET") {
      return new Response(JSON.stringify(completed));
    }
    if (url.endsWith("/images/generations")) {
      return new Response(
        JSON.stringify({ data: [{ url: "https://media.example/test.webp" }] }),
      );
    }
    throw new Error("unexpected fixture request");
  };
  try {
    const grid = new Grid({
      apiKey: "fixture",
      baseURL: "https://grid.example/v1",
    });
    assert.ok(grid.grid.videoJobs instanceof VideoJobs);
    assert.ok(
      new Grid({ apiKey: "fixture", baseURL: "https://grid.example/custom" })
        .grid,
    );
    assert.equal(
      (await grid.grid.image("fixture", { model: "fixture" })).data.length,
      1,
    );
    for (const mode of ["generated", "audio", "video"]) {
      const body = {
        model,
        prompt: "fixture",
        frames: 33,
        fps: 24,
        max_cost_micro_usd: 50000,
        ...(mode !== "generated" ? { reference_audio: "inline-fixture" } : {}),
        ...(mode === "video"
          ? { reference_video: "inline-fixture", size: "768x512" }
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
        (call) => call.url.endsWith("/videos/jobs") && call.method === "POST",
      ).length,
      3,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("compiled SDK wallet preparation needs no development dependencies", async () => {
  const now = Math.floor(Date.now() / 1000),
    commitment = "c".repeat(64);
  const nonce =
    "0x" +
    Buffer.from(
      await webcrypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify({
            quote: commitment,
            schema: "aipg.video-authorization.v1",
          }),
        ),
      ),
    ).toString("hex");
  const asset = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
  const quote = {
    schema: "aipg.video-quote.v1",
    binding_schema: "aipg.video-quote-binding.v2",
    quote_id: "11111111-1111-4111-8111-111111111111",
    job_id: "22222222-2222-4222-8222-222222222222",
    model: "fixture",
    state: "quoted",
    payment_enabled: false,
    request_hash: "a".repeat(64),
    plan_hash: "b".repeat(64),
    commitment,
    authorization_nonce: nonce,
    created: now,
    expires: now + 300,
    max_cost_micro_usd: 100_000,
    payment: {
      scheme: "exact",
      network: "eip155:84532",
      asset,
      pay_to: "0x" + "1".repeat(40),
      amount_micro: 7500,
      valid_after: 0,
      valid_before: now + 300,
      eip712_domain: {
        name: "USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: asset,
      },
    },
  };
  const prepared = await prepareVideoAuthorization(quote, {
    payer: "0x" + "2".repeat(40),
    expectedModel: "fixture",
    expectedRequestHash: "a".repeat(64),
    expectedRecipient: quote.payment.pay_to,
    network: "eip155:84532",
    maxCostMicroUsd: 100_000,
    subtle: webcrypto.subtle,
  });
  assert.equal(prepared.authorization.nonce, nonce);
  let called = false;
  await assert.rejects(
    signVideoAuthorization(prepared, () => {
      called = true;
      return "";
    }),
    { kind: "payment_disabled" },
  );
  assert.equal(called, false);
});
