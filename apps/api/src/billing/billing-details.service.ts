import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, subscriptions, workspaceBillingDetails, type Database } from "@snapurl/database";
import type { BillingDetails, BillingDetailsInput } from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { BILLING_PROVIDER, type BillingProvider } from "./billing-provider.js";

/* ============================================================
   #992 §5 — billing details.

   One row per workspace with the company identity that goes on an invoice: a
   billing email, a company/legal name, a tax id (a GSTIN in India), and a
   billing address. The workspace OWNER edits them (through the owner-facing
   BillingController); a platform ADMIN reads them (AdminController).

   Two guarantees:
   - The SnapURL record is the source of truth. The owner's edit always lands in
     the DB; pushing to the provider is BEST-EFFORT (exactly like #987's price
     sync), so a provider hiccup never loses the owner's input.
   - They are attached to the provider's customer so the invoices it raises
     carry them — done through the provider.syncBillingDetails seam, called only
     when a provider subscription exists to attach to.

   Nothing here is a secret: a tax id and an address are the same facts that
   already print on an invoice.
   ============================================================ */

/** The stored billing-details row, as drizzle returns it. */
type BillingDetailsRow = typeof workspaceBillingDetails.$inferSelect;

@Injectable()
export class BillingDetailsService {
  private readonly logger = new Logger(BillingDetailsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
  ) {}

  /** Read a workspace's billing details, or the all-null record when none have
   *  been set — so the Settings form always has a shape to bind to and the
   *  admin view never 404s on a workspace that simply has not entered any. */
  async get(workspaceId: string): Promise<BillingDetails> {
    const [row] = await this.db
      .select()
      .from(workspaceBillingDetails)
      .where(eq(workspaceBillingDetails.workspaceId, workspaceId))
      .limit(1);
    return toWire(row ?? null);
  }

  /**
   * Set (upsert) a workspace's billing details. Each field in `input` is applied
   * as given — a provided value sets it, an explicit null clears it, and an
   * omitted field is LEFT UNCHANGED (a partial edit). The write is upserted on
   * the one-row-per-workspace unique index. Then the details are pushed to the
   * provider best-effort so its invoices carry them; a provider failure is
   * logged and swallowed — the DB write already succeeded.
   */
  async set(workspaceId: string, input: BillingDetailsInput): Promise<BillingDetails> {
    const [existing] = await this.db
      .select()
      .from(workspaceBillingDetails)
      .where(eq(workspaceBillingDetails.workspaceId, workspaceId))
      .limit(1);

    // Merge: an omitted (undefined) field keeps the stored value; a provided
    // value (including null) overwrites. The address is merged as a whole object
    // when provided, so setting `address` replaces the full address block.
    const next = mergeInput(existing ?? null, input);

    await this.db
      .insert(workspaceBillingDetails)
      .values({ workspaceId, ...next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: workspaceBillingDetails.workspaceId,
        set: { ...next, updatedAt: new Date() },
      });

    // Best-effort provider sync. Resolve the workspace's provider ids from its
    // subscription row (none → nothing to attach to, the sync is a no-op).
    await this.syncToProvider(workspaceId, next).catch((err) =>
      this.logger.warn(
        { err, workspaceId },
        "billing details saved, but the provider sync did not complete",
      ),
    );

    return this.get(workspaceId);
  }

  /** Push the current details to the provider customer, best-effort. */
  private async syncToProvider(workspaceId: string, d: NormalisedDetails): Promise<void> {
    if (!this.provider.syncBillingDetails) return;
    const [sub] = await this.db
      .select({
        providerCustomerId: subscriptions.providerCustomerId,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
      })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);
    if (!sub) return; // no provider subscription → nothing to attach to

    await this.provider.syncBillingDetails({
      providerCustomerId: sub.providerCustomerId ?? null,
      providerSubscriptionId: sub.providerSubscriptionId ?? null,
      billingEmail: d.billingEmail ?? null,
      companyName: d.companyName ?? null,
      taxId: d.taxId ?? null,
      address:
        d.addressLine1 || d.addressLine2 || d.city || d.state || d.postalCode || d.country
          ? {
              line1: d.addressLine1 ?? null,
              line2: d.addressLine2 ?? null,
              city: d.city ?? null,
              state: d.state ?? null,
              postalCode: d.postalCode ?? null,
              country: d.country ?? null,
            }
          : null,
    });
  }
}

/** The column shape stored on the table (flat), after merging an input over any
 *  existing row. */
interface NormalisedDetails {
  billingEmail: string | null;
  companyName: string | null;
  taxId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

/** A blank value for a field the owner either cleared or never set. An empty
 *  string is normalised to null so "" is never stored as a value. */
function blank(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Merge an input over the existing row: an omitted field keeps the stored
 *  value; a provided value (or null) overwrites. */
function mergeInput(existing: BillingDetailsRow | null, input: BillingDetailsInput): NormalisedDetails {
  const base: NormalisedDetails = {
    billingEmail: existing?.billingEmail ?? null,
    companyName: existing?.companyName ?? null,
    taxId: existing?.taxId ?? null,
    addressLine1: existing?.addressLine1 ?? null,
    addressLine2: existing?.addressLine2 ?? null,
    city: existing?.city ?? null,
    state: existing?.state ?? null,
    postalCode: existing?.postalCode ?? null,
    country: existing?.country ?? null,
  };

  if (input.billingEmail !== undefined) base.billingEmail = blank(input.billingEmail);
  if (input.companyName !== undefined) base.companyName = blank(input.companyName);
  if (input.taxId !== undefined) base.taxId = blank(input.taxId);
  if (input.address !== undefined) {
    // A provided address replaces the whole block (null clears it entirely).
    const a = input.address;
    base.addressLine1 = blank(a?.line1);
    base.addressLine2 = blank(a?.line2);
    base.city = blank(a?.city);
    base.state = blank(a?.state);
    base.postalCode = blank(a?.postalCode);
    base.country = blank(a?.country);
  }
  return base;
}

/** Map a stored row (or null) onto the wire shape. A null row is the all-null
 *  record with a null updatedAt. */
function toWire(row: BillingDetailsRow | null): BillingDetails {
  if (!row) {
    return {
      billingEmail: null,
      companyName: null,
      taxId: null,
      address: null,
      updatedAt: null,
    };
  }
  const hasAddress =
    row.addressLine1 || row.addressLine2 || row.city || row.state || row.postalCode || row.country;
  return {
    billingEmail: row.billingEmail,
    companyName: row.companyName,
    taxId: row.taxId,
    address: hasAddress
      ? {
          line1: row.addressLine1,
          line2: row.addressLine2,
          city: row.city,
          state: row.state,
          postalCode: row.postalCode,
          country: row.country,
        }
      : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}
