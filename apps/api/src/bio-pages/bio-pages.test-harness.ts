import type { Database } from "@snapurl/database";
import type { Env } from "../config/env.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import type { ProjectionNudgeService } from "../links/projection-nudge.service.js";
import type { Actor } from "../common/activity.js";
import type { UpsertBioPageInput } from "@snapurl/contract";
import { BioPagesService } from "./bio-pages.service.js";

/** #783 — upsert/remove now write the audit trail and take who-did-it. The
 *  #650 suites are about rows, not the trail, so the harness supplies this
 *  actor when a call omits one; the audit suite passes its own. */
export const TEST_ACTOR: Actor = { userId: null, label: "bio-test@example.com" };

class HarnessBioPagesService extends BioPagesService {
  override upsert(workspaceId: string, input: UpsertBioPageInput, actor: Actor = TEST_ACTOR) {
    return super.upsert(workspaceId, input, actor);
  }

  override remove(workspaceId: string, id: string, actor: Actor = TEST_ACTOR) {
    return super.remove(workspaceId, id, actor);
  }
}

/* #650 — BioPagesService now manages the link that fronts a published page, so
   it depends on WEB_ORIGIN (to build the managed-link destination), the
   cache-bust service and the projection nudge. The integration tests do not
   need the real redirect-cache or Lambda wiring to prove the Postgres-side
   invariants, so this stubs the two side-effect collaborators and lets the
   test choose WEB_ORIGIN. The cache-bust/nudge calls are recorded so a test
   can assert they fired on publish/unpublish/delete. */

export interface BioServiceHarness {
  service: BioPagesService;
  busted: Array<{ host: string; slug: string }>;
  nudges: number;
}

export function makeBioService(db: Database, webOrigin = "https://app.snapurl.test"): BioServiceHarness {
  const busted: Array<{ host: string; slug: string }> = [];
  let nudges = 0;

  const cacheBust = {
    bust: async (host: string, slug: string) => {
      busted.push({ host, slug });
    },
  } as unknown as LinkCacheBustService;

  const projectionNudge = {
    nudge: () => {
      nudges += 1;
    },
  } as unknown as ProjectionNudgeService;

  const env = { WEB_ORIGIN: webOrigin } as unknown as Env;

  const service = new HarnessBioPagesService(db, env, cacheBust, projectionNudge);
  return {
    service,
    busted,
    get nudges() {
      return nudges;
    },
  };
}
