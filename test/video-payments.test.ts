// SPDX-License-Identifier: MIT
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareVideoAuthorization,
  signVideoAuthorization,
  VideoPaymentError,
} from "../src/index.js";

const NOW = 2_000_000_000;
const SIG = "0x" + "12".repeat(64) + "1b";

async function fixture() {
  const commitment = "c".repeat(64);
  const hash = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        quote: commitment,
        schema: "aipg.video-authorization.v1",
      }),
    ),
  );
  const nonce = "0x" + Buffer.from(hash).toString("hex");
  const asset = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
  const quote = {
    schema: "aipg.video-quote.v1",
    binding_schema: "aipg.video-quote-binding.v2",
    quote_id: "11111111-1111-4111-8111-111111111111",
    job_id: "22222222-2222-4222-8222-222222222222",
    state: "quoted",
    payment_enabled: false,
    created: NOW,
    expires: NOW + 300,
    model: "LTX-2.5 Distilled BF16",
    request_hash: "a".repeat(64),
    plan_hash: "b".repeat(64),
    commitment,
    authorization_nonce: nonce,
    max_cost_micro_usd: 100_000,
    payment: {
      scheme: "exact",
      network: "eip155:84532",
      asset,
      pay_to: "0x" + "1".repeat(40),
      amount_micro: 7500,
      valid_after: 0,
      valid_before: NOW + 300,
      eip712_domain: {
        name: "USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: asset,
      },
    },
  };
  const policy = {
    payer: "0x" + "2".repeat(40),
    expectedModel: quote.model,
    expectedRequestHash: quote.request_hash,
    expectedRecipient: quote.payment.pay_to,
    network: "eip155:84532" as const,
    maxCostMicroUsd: 100_000,
    subtle: webcrypto.subtle,
  };
  return { quote, policy };
}

describe("explicit video wallet preparation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not prompt a wallet for Core preview quotes and protects mutable views", async () => {
    const { quote, policy } = await fixture();
    const request = await prepareVideoAuthorization(quote, policy);
    expect(request.authorization.nonce).toBe(quote.authorization_nonce);
    expect(
      request.typedData.types.EIP712Domain.map((field) => field.name),
    ).toEqual(["name", "version", "chainId", "verifyingContract"]);
    request.typedData.domain.name = "changed";
    quote.payment.amount_micro = 1;
    expect(request.authorization.value).toBe("7500");
    expect(request.typedData.domain.name).toBe("USDC");
    const signer = vi.fn(() => SIG);
    await expect(signVideoAuthorization(request, signer)).rejects.toMatchObject(
      { kind: "payment_disabled" },
    );
    expect(signer).not.toHaveBeenCalled();
  });

  it.each(["hash", "model", "recipient", "network", "ceiling", "payer"])(
    "rejects independent policy mismatch: %s",
    async (kind) => {
      const { quote, policy } = await fixture();
      if (kind === "hash") policy.expectedRequestHash = "d".repeat(64);
      if (kind === "model") policy.expectedModel = "wrong model";
      if (kind === "recipient")
        policy.expectedRecipient = "0x" + "3".repeat(40);
      if (kind === "ceiling") policy.maxCostMicroUsd = 99_999;
      if (kind === "payer") policy.payer = policy.expectedRecipient;
      const altered =
        kind === "network"
          ? { ...policy, network: "__proto__" as never }
          : policy;
      await expect(
        prepareVideoAuthorization(quote, altered),
      ).rejects.toBeInstanceOf(VideoPaymentError);
    },
  );

  it.each([
    "legacy",
    "nonce",
    "expired",
    "future",
    "domain",
    "amount",
    "nonfinite",
    "unbounded",
  ])("rejects altered quote: %s", async (kind) => {
    const { quote, policy } = await fixture();
    if (kind === "legacy") quote.binding_schema = "aipg.video-quote-binding.v1";
    if (kind === "nonce") quote.authorization_nonce = "0x" + "0".repeat(64);
    if (kind === "expired") quote.expires = NOW;
    if (kind === "future") quote.created = NOW + 1;
    if (kind === "domain") quote.payment.eip712_domain.chainId = 1;
    if (kind === "amount") quote.payment.amount_micro = 100_001;
    const altered =
      kind === "nonfinite"
        ? { ...quote, unused: Number.NaN }
        : kind === "unbounded"
          ? { ...quote, unused: "private-marker".repeat(6000) }
          : quote;
    await expect(
      prepareVideoAuthorization(altered, policy),
    ).rejects.toBeInstanceOf(VideoPaymentError);
  });

  it("exports a spending capability explicitly, not through JSON or mutable views", async () => {
    const { quote, policy } = await fixture();
    quote.payment_enabled = true; // Synthetic future server, not live admission.
    const request = await prepareVideoAuthorization(quote, policy);
    const signer = vi.fn(async () => SIG);
    const signed = await signVideoAuthorization(request, signer);
    expect(signer).toHaveBeenCalledTimes(1);
    expect(signed.payload).toEqual({
      authorization: request.authorization,
      signature: SIG,
    });
    expect(JSON.stringify(signed)).not.toContain(SIG);
    signed.payload.signature = "changed";
    expect(signed.payload.signature).toBe(SIG);
  });

  it("refuses expiry after wallet work and sanitizes signer errors", async () => {
    const { quote, policy } = await fixture();
    quote.payment_enabled = true;
    const request = await prepareVideoAuthorization(quote, policy);
    await expect(
      signVideoAuthorization(request, () => {
        vi.setSystemTime((NOW + 300) * 1000);
        return SIG;
      }),
    ).rejects.toMatchObject({ kind: "expired_quote" });
    vi.setSystemTime(NOW * 1000);
    await expect(
      signVideoAuthorization(request, () => {
        throw new Error("private-signer-marker");
      }),
    ).rejects.toMatchObject({ message: "Grid video payment signer_failed" });
    await expect(
      signVideoAuthorization(request, () => "private-signer-marker"),
    ).rejects.toMatchObject({ kind: "unsupported_signature" });
  });
});
