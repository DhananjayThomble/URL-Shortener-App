import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { and, apiKeys, desc, eq, isNull, webhooks, type Database } from "@snapurl/database";
import type { ApiKey, CreateApiKeyInput, CreateWebhookInput, CreatedApiKey, Webhook } from "@snapurl/contract";
import { DB } from "../database/database.module.js";

@Injectable()
export class DevelopersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /* ---------- API keys ---------- */

  async listKeys(workspaceId: string): Promise<ApiKey[]> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      // Enough to recognise the key, never enough to reconstruct it.
      maskedKey: `${row.keyPrefix}...${row.keyLast4}`,
      scopes: row.scopes,
      lastUsed: row.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Issue a key. The full value is returned exactly once and never stored.
   *
   * There is deliberately no endpoint to read a key back. If someone loses it
   * they issue a new one — which is the only design where a database dump does
   * not hand over working credentials.
   */
  async createKey(workspaceId: string, userId: string | null, input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const secret = randomBytes(24).toString("base64url");
    const key = `snap_live_${secret}`;
    const keyPrefix = key.slice(0, 15);
    const keyLast4 = key.slice(-4);

    const [row] = await this.db
      .insert(apiKeys)
      .values({
        workspaceId,
        name: input.name,
        keyHash: createHash("sha256").update(key).digest("hex"),
        keyPrefix,
        keyLast4,
        scopes: [...input.scopes],
        createdBy: userId,
      })
      .returning();

    return {
      id: row!.id,
      name: row!.name,
      maskedKey: `${keyPrefix}...${keyLast4}`,
      scopes: row!.scopes,
      lastUsed: null,
      key,
    };
  }

  /** Revoked, not deleted — the audit trail should keep showing that the key
   *  existed and what it did. */
  async revokeKey(workspaceId: string, id: string): Promise<void> {
    const result = await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (result.length === 0) throw new NotFoundException("That API key doesn't exist, or is already revoked.");
  }

  /* ---------- Webhooks ---------- */

  async listWebhooks(workspaceId: string): Promise<Webhook[]> {
    const rows = await this.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.workspaceId, workspaceId))
      .orderBy(desc(webhooks.createdAt));

    return rows.map((row) => ({
      id: row.id,
      endpoint: row.endpoint,
      events: row.events,
      health: row.health as Webhook["health"],
      detail: detailFor(row),
    }));
  }

  async createWebhook(workspaceId: string, input: CreateWebhookInput): Promise<Webhook & { secret: string }> {
    // Shown once, like an API key. The receiver uses it to verify our signature.
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;

    const [row] = await this.db
      .insert(webhooks)
      .values({ workspaceId, endpoint: input.endpoint, events: [...input.events], secret })
      .returning();

    return {
      id: row!.id,
      endpoint: row!.endpoint,
      events: row!.events,
      health: "healthy",
      detail: "No deliveries yet",
      secret,
    };
  }

  async removeWebhook(workspaceId: string, id: string): Promise<void> {
    const result = await this.db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, workspaceId)))
      .returning({ id: webhooks.id });
    if (result.length === 0) throw new NotFoundException("That webhook doesn't exist in this workspace.");
  }
}

/** The UI shows one line of context under each webhook's health pill. */
function detailFor(row: typeof webhooks.$inferSelect): string {
  if (!row.lastDeliveryAt) return "No deliveries yet";
  if (row.health === "failing") {
    return `${row.consecutiveFailures} failures in a row — ${row.lastError ?? "no response"}`;
  }
  if (row.health === "retrying") return `Retrying — ${row.lastError ?? "last attempt failed"}`;
  return `Last delivered ${relative(row.lastDeliveryAt)}`;
}

function relative(at: Date): string {
  const seconds = Math.floor((Date.now() - at.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}
