import type { Database } from "@snapurl/database";
import type { Env } from "../config/env.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import type { ProjectionNudgeService } from "../links/projection-nudge.service.js";
import { BioPagesService } from "./bio-pages.service.js";

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

  const service = new BioPagesService(db, env, cacheBust, projectionNudge);
  return {
    service,
    busted,
    get nudges() {
      return nudges;
    },
  };
}
