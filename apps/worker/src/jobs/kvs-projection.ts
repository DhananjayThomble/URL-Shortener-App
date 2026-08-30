import {
  DeleteKeyCommand,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
  type CloudFrontKeyValueStoreClient,
} from "@aws-sdk/client-cloudfront-keyvaluestore";
import { isEdgeEligible, kvsKey, kvsValue, type ProjectedLink } from "@snapurl/database";

/* ============================================================
   KvsWriter — the CloudFront KeyValueStore edge fast path (#289).

   For a plain, unconditional link (no password, no rules, no
   click limit, no time gate, not archived, safe-browsing clean —
   see isEdgeEligible in @snapurl/database) the redirect can be
   answered AT THE EDGE by a CloudFront Function reading a
   KeyValueStore entry: no Lambda invocation, no DynamoDB read, no
   VPC round trip. This writer is driven by the SAME outbox drain
   that writes the DynamoDB projection, so the two stores stay in
   step: every edge-eligible upsert PutKeys {destination,
   redirectType}; every ineligible-or-removed link DeleteKeys, so
   a link that gains a password/rule/limit stops being edge-served
   and falls back to the authoritative Lambda.

   The key format, eligibility rule and stored value all come from
   @snapurl/database (kvsKey / isEdgeEligible / kvsValue), the same
   definitions the CloudFront Function reads against, so the write
   here and the read there cannot drift.

   Store limits (AWS): 5 MB per store, 1 KB per value. A value is
   JSON `{destination, redirectType}` — a URL plus a 3-char code,
   comfortably under 1 KB, so no truncation guard is needed. The
   store-wide 5 MB cap is a capacity concern, not a per-write one.

   Optimistic concurrency: every KVS write is conditional on the
   store's current ETag. We DescribeKeyValueStore to read the ETag,
   pass it as IfMatch, and on a ConflictException (another writer
   moved the ETag between our read and our write) re-read the ETag
   and retry, bounded to MAX_ATTEMPTS so a hot store cannot loop
   forever — the outbox row then fails and is retried on the next
   drain.
   ============================================================ */

/** Bounded retries for the ETag optimistic-concurrency conflict. A conflict
 *  means another writer advanced the store's ETag between our Describe and our
 *  Put/Delete; we re-read and retry. If we still lose after this many attempts
 *  we give up and let the outbox row fail so the next drain retries it. */
const MAX_ATTEMPTS = 3;

/** The SDK error name raised when IfMatch does not match the store's current
 *  ETag (optimistic-concurrency conflict). */
const CONFLICT_ERROR = "ConflictException";

function isConflict(err: unknown): boolean {
  return err instanceof Error && err.name === CONFLICT_ERROR;
}

export class KvsWriter {
  constructor(
    private readonly client: CloudFrontKeyValueStoreClient,
    private readonly kvsArn: string,
  ) {}

  /** Project a link to the edge: PutKey when it is edge-eligible, DeleteKey
   *  otherwise. Called on every upsert, so a link that JUST became ineligible
   *  (gained a password, a rule, a click limit, an expiry…) is removed from the
   *  fast path in the same drain that projected the DynamoDB change — the edge
   *  stops serving it and traffic falls through to the Lambda. */
  async putIfEligible(link: ProjectedLink, host: string, slug: string): Promise<void> {
    const key = kvsKey(host, slug);
    if (isEdgeEligible(link)) {
      const value = kvsValue(link);
      await this.withEtag((etag) =>
        this.client.send(
          new PutKeyCommand({ KvsARN: this.kvsArn, Key: key, Value: value, IfMatch: etag }),
        ),
      );
    } else {
      await this.deleteByKey(key);
    }
  }

  /** Remove a link from the edge fast path (a delete op). */
  async deleteKey(host: string, slug: string): Promise<void> {
    await this.deleteByKey(kvsKey(host, slug));
  }

  private async deleteByKey(key: string): Promise<void> {
    await this.withEtag((etag) =>
      this.client.send(new DeleteKeyCommand({ KvsARN: this.kvsArn, Key: key, IfMatch: etag })),
    );
  }

  /** Read the store's current ETag, run the conditional write with it as
   *  IfMatch, and on an optimistic-concurrency conflict re-read the ETag and
   *  retry — bounded to MAX_ATTEMPTS. Any non-conflict error (or the final
   *  conflict) propagates so the outbox marks the row failed and retries it. */
  private async withEtag(write: (etag: string) => Promise<unknown>): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { ETag } = await this.client.send(
        new DescribeKeyValueStoreCommand({ KvsARN: this.kvsArn }),
      );
      try {
        await write(ETag ?? "");
        return;
      } catch (err) {
        if (!isConflict(err)) throw err;
        // Stale ETag: another writer moved it. Re-read and retry.
        lastErr = err;
      }
    }
    throw lastErr;
  }
}
