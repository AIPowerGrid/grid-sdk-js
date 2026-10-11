// SPDX-License-Identifier: MIT
// Quote-bound wallet preparation only; no HTTP, private keys or sending.

const MAX_MONEY = Number.MAX_SAFE_INTEGER;
const DOMAINS: Record<
  string,
  { chainId: number; name: string; asset: string }
> = {
  "eip155:8453": {
    chainId: 8453,
    name: "USD Coin",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  "eip155:84532": {
    chainId: 84532,
    name: "USDC",
    asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  },
};
const TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export interface VideoTransferAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface VideoTypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: "TransferWithAuthorization";
  message: VideoTransferAuthorization;
}

export interface VideoAuthorizationPolicy {
  payer: string;
  expectedModel: string;
  expectedRequestHash: string;
  expectedRecipient: string;
  network: "eip155:8453" | "eip155:84532";
  maxCostMicroUsd: number;
  /** Supply node:crypto.webcrypto.subtle on Node 18 if global Web Crypto is absent. */
  subtle?: VideoDigestProvider;
}

export interface VideoDigestProvider {
  digest(algorithm: "SHA-256", data: ArrayBuffer): Promise<ArrayBuffer>;
}

export class VideoPaymentError extends Error {
  constructor(readonly kind: string) {
    super(`Grid video payment ${kind}`);
    this.name = "VideoPaymentError";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid object");
  return value as Record<string, unknown>;
}

function address(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(value) ||
    /^0x0{40}$/.test(value)
  ) {
    throw new Error("invalid address");
  }
  return value.toLowerCase();
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new Error("invalid digest");
  return value;
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throw new Error("invalid UUIDv4");
  }
  return value;
}

function integer(value: unknown, minimum = 1): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > MAX_MONEY
  ) {
    throw new Error("invalid integer");
  }
  return value;
}

export class VideoAuthorizationRequest {
  #encoded: string;

  constructor(
    readonly quoteId: string,
    readonly jobId: string,
    readonly requestHash: string,
    readonly expires: number,
    readonly paymentEnabled: boolean,
    encoded: string,
  ) {
    this.#encoded = encoded;
    Object.freeze(this);
  }

  get authorization(): VideoTransferAuthorization {
    return JSON.parse(this.#encoded)
      .authorization as VideoTransferAuthorization;
  }

  get typedData(): VideoTypedData {
    return JSON.parse(this.#encoded).typedData as VideoTypedData;
  }

  assertSignable(): void {
    if (!this.paymentEnabled) throw new VideoPaymentError("payment_disabled");
    if (Math.floor(Date.now() / 1000) >= this.expires)
      throw new VideoPaymentError("expired_quote");
  }
}

export class SignedVideoAuthorization {
  #encoded: string;

  constructor(
    readonly quoteId: string,
    readonly jobId: string,
    encoded: string,
  ) {
    this.#encoded = encoded;
    Object.freeze(this);
  }

  /** Temporary spending capability; explicitly export it, never log it. */
  get payload(): {
    authorization: VideoTransferAuthorization;
    signature: string;
  } {
    return JSON.parse(this.#encoded) as {
      authorization: VideoTransferAuthorization;
      signature: string;
    };
  }
}

/** Check a trusted Core quote against independently retained intent and spending policy. */
export async function prepareVideoAuthorization(
  quote: unknown,
  policy: VideoAuthorizationPolicy,
): Promise<VideoAuthorizationRequest> {
  try {
    const encoded = JSON.stringify(quote, (_key, item: unknown) => {
      if (typeof item === "number" && !Number.isFinite(item))
        throw new Error("nonfinite quote");
      return item;
    });
    if (!encoded || new TextEncoder().encode(encoded).length > 64 * 1024)
      throw new Error("invalid quote");
    const value = object(JSON.parse(encoded) as unknown);
    const ceiling = integer(policy.maxCostMicroUsd);
    const intent = digest(policy.expectedRequestHash);
    const payer = address(policy.payer),
      recipient = address(policy.expectedRecipient);
    if (policy.network !== "eip155:8453" && policy.network !== "eip155:84532")
      throw new Error("unsupported network");
    const chosen = DOMAINS[policy.network];
    if (!chosen) throw new Error("unsupported network");
    const quoteId = uuid(value.quote_id),
      jobId = uuid(value.job_id);
    const created = integer(value.created),
      expires = integer(value.expires);
    if (
      value.schema !== "aipg.video-quote.v1" ||
      value.binding_schema !== "aipg.video-quote-binding.v2" ||
      value.state !== "quoted" ||
      typeof value.payment_enabled !== "boolean" ||
      typeof policy.expectedModel !== "string" ||
      !policy.expectedModel ||
      value.model !== policy.expectedModel ||
      value.request_hash !== intent ||
      integer(value.max_cost_micro_usd) !== ceiling ||
      payer === recipient ||
      expires - created !== 300 ||
      !(
        created <= Math.floor(Date.now() / 1000) &&
        Math.floor(Date.now() / 1000) < expires
      )
    ) {
      throw new Error("quote policy mismatch");
    }
    digest(value.plan_hash);
    const commitment = digest(value.commitment);
    const subtle = policy.subtle ?? globalThis.crypto?.subtle;
    if (!subtle) throw new VideoPaymentError("crypto_unavailable");
    const sealed = JSON.stringify({
      quote: commitment,
      schema: "aipg.video-authorization.v1",
    });
    const hash = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(sealed).buffer,
    );
    if (hash.byteLength !== 32) throw new Error("invalid SHA-256 result");
    const nonce =
      "0x" +
      Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    if (value.authorization_nonce !== nonce) throw new Error("unbound nonce");
    const payment = object(value.payment),
      suppliedDomain = object(payment.eip712_domain);
    const amount = integer(payment.amount_micro);
    const domain = {
      name: chosen.name,
      version: "2",
      chainId: chosen.chainId,
      verifyingContract: chosen.asset,
    };
    if (
      payment.scheme !== "exact" ||
      payment.network !== policy.network ||
      payment.asset !== chosen.asset ||
      address(payment.pay_to) !== recipient ||
      Object.keys(suppliedDomain).length !== 4 ||
      suppliedDomain.name !== domain.name ||
      suppliedDomain.version !== domain.version ||
      suppliedDomain.chainId !== domain.chainId ||
      suppliedDomain.verifyingContract !== domain.verifyingContract ||
      integer(payment.valid_after, 0) !== 0 ||
      integer(payment.valid_before) !== expires ||
      amount > ceiling
    ) {
      throw new Error("payment policy mismatch");
    }
    if (Math.floor(Date.now() / 1000) >= expires)
      throw new Error("expired quote");
    const authorization: VideoTransferAuthorization = {
      from: payer,
      to: recipient,
      value: String(amount),
      validAfter: "0",
      validBefore: String(expires),
      nonce,
    };
    const typedData: VideoTypedData = {
      domain,
      types: TYPES,
      primaryType: "TransferWithAuthorization",
      message: authorization,
    };
    return new VideoAuthorizationRequest(
      quoteId,
      jobId,
      intent,
      expires,
      value.payment_enabled,
      JSON.stringify({ authorization, typedData }),
    );
  } catch (error) {
    if (error instanceof VideoPaymentError) throw error;
    throw new VideoPaymentError("invalid_quote_or_policy");
  }
}

/** Callback signs only; this helper never sends or retries a payment. */
export async function signVideoAuthorization(
  request: VideoAuthorizationRequest,
  signer: (data: VideoTypedData) => string | Promise<string>,
): Promise<SignedVideoAuthorization> {
  request.assertSignable();
  let signature: string;
  try {
    signature = await signer(request.typedData);
  } catch {
    throw new VideoPaymentError("signer_failed");
  }
  request.assertSignable();
  if (
    typeof signature !== "string" ||
    !/^0x[0-9a-fA-F]{130}$/.test(signature) ||
    ![27, 28].includes(parseInt(signature.slice(-2), 16))
  ) {
    throw new VideoPaymentError("unsupported_signature");
  }
  return new SignedVideoAuthorization(
    request.quoteId,
    request.jobId,
    JSON.stringify({ authorization: request.authorization, signature }),
  );
}
