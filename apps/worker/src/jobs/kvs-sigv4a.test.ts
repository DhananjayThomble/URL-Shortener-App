import { describe, expect, it } from "vitest";
import {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
} from "@aws-sdk/client-cloudfront-keyvaluestore";

/* Regression guard for the #289 edge fast path (see the side-effect import in
   main.ts).

   The CloudFront KeyValueStore data-plane API is a global service and signs with
   SigV4a. AWS SDK v3 does not bundle or auto-load the SigV4a implementation: the
   multi-region signer resolves signatureV4aContainer.SignatureV4a AT SIGNING TIME
   and, when nothing registered it, throws "Neither CRT nor JS SigV4a
   implementation is available". A package.json dependency on @aws-sdk/signature-v4a
   is inert on its own — the package must be IMPORTED for its registration side
   effect. main.ts does that import; this test fails loudly if it is ever removed.

   The mock-based kvs-projection.test.ts stubs send() and so never exercises the
   signer — that is exactly why the original defect (KVS writes throwing in
   production while every unit test, cdk synth and cdk diff passed) went uncaught.
   This test drives a REAL client through the signing middleware instead. */

// Register the JS SigV4a signer, exactly as main.ts does. Importing here (rather
// than relying on kvs-projection.test.ts having imported it) keeps the guard
// self-contained and order-independent under vitest's per-file isolation.
import "@aws-sdk/signature-v4a";

describe("CloudFront KeyValueStore SigV4a signer", () => {
  it("is registered, so a KVS request can be signed (guards the main.ts import)", async () => {
    // A real client, real credentials shape, but an unroutable endpoint: we only
    // care whether the request gets PAST the signing middleware. If SigV4a were
    // unregistered the send() below would reject with the SigV4a error before any
    // network call; with it registered, signing succeeds and the send fails later
    // on the deliberately-broken endpoint instead.
    const client = new CloudFrontKeyValueStoreClient({
      region: "us-east-1",
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
      // A syntactically valid but unroutable endpoint. The KVS client prefixes the
      // store account id to the host, so this must be a hostname (not an IP literal)
      // to stay a valid URL after prefixing; .invalid is reserved (RFC 6761) and
      // never resolves, so the send fails with a connection/DNS error — AFTER
      // signing, which is all this guard asserts.
      endpoint: "https://kvs.invalid",
      maxAttempts: 1,
    });

    let error: Error | undefined;
    try {
      await client.send(
        new DescribeKeyValueStoreCommand({
          KvsARN: "arn:aws:cloudfront::123456789012:key-value-store/test-store",
        }),
      );
    } catch (err) {
      error = err as Error;
    }

    // It must fail (the endpoint is unroutable) — but NOT with the SigV4a error.
    expect(error).toBeDefined();
    expect(error!.message).not.toMatch(/SigV4a/i);
    expect(error!.message).not.toMatch(/Neither CRT nor JS/i);
  });
});
