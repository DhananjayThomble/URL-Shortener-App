import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { SnapUrlStack } from "./snapurl-stack.js";

/**
 * Oracle: `infra/lib/snapurl-stack.ts` itself, specifically the invariant its
 * own comments assert — RedirectFn's `CACHE_DRIVER=dynamodb` /
 * `CACHE_DYNAMO_TABLE` env block ("AWS profile: back the CacheStore with
 * DynamoDB, not the per-instance in-memory default") — extended to ApiFn,
 * which the #470/#426 fix (`apps/api/src/common/link-cache-bust.service.ts`)
 * requires but the stack did not originally wire. This is a same-repo
 * cross-check, not implementation-as-oracle: the bug this test catches is
 * ApiFn and RedirectFn disagreeing about which CacheStore backs
 * `linkCacheKey(host, slug)`, which is an invariant regardless of which side
 * you read the requirement from — `LinkCacheBustService.bust()` calling
 * `CacheStore.del()` on a store the redirect never reads is observably wrong
 * no matter what the code happens to do.
 *
 * This is the regression the reviewer's real-stack run against PR #594 found
 * (`LINK_PROJECTION=dynamo smoke`): ApiFn had no `CACHE_DRIVER`/
 * `CACHE_DYNAMO_TABLE`, so `env.CACHE_DRIVER` defaulted to `memory`
 * (`apps/api/src/config/env.ts`) and `LinkCacheBustService.getCache()` built
 * a CacheStore backed by a private in-memory Map nothing else ever reads —
 * silently, because that call never throws. `cdk synth` succeeded either way,
 * so only an assertion on the synthesized template — not "the stack still
 * synths" — catches it. Same failure mode as the earlier CACHE_DRIVER=memory
 * gap `cache-bust-listener.ts`'s pg_notify/LISTEN fixes for every OTHER
 * profile; this one has no such fallback because the redirect holds no
 * Postgres connection under LINK_PROJECTION=dynamo.
 *
 * Deliberately not a full `cdk deploy` / integration check: this only proves
 * the CloudFormation template the stack would deploy contains the matching
 * env vars and IAM grant. It cannot prove DynamoDB actually enforces them —
 * that half is the `dynamo-smoke` CI job's real-stack "immediate cache
 * invalidation" assertions (`scripts/smoke-redirect.sh`), against a real
 * dynamodb-local table. The two are complementary, not redundant: this test
 * fails fast on a wiring regression without needing Docker/dynamodb-local at
 * all, in the couple of seconds `cdk synth` costs in-process; the CI job is
 * the only one that proves eviction actually happens end to end.
 */

function synthTemplate(natStrategy: "instance" | "gateway" | "none" = "none") {
  const app = new App();
  const stack = new SnapUrlStack(app, "TestStack", {
    env: { account: "111111111111", region: "us-east-1" },
    configPrefix: "/test/snapurl",
    natStrategy,
  });
  return Template.fromStack(stack);
}

describe("SnapUrlStack — API/redirect CacheStore pairing for immediate cache invalidation (#470, #426)", () => {
  // Synth is a real (if asset-hash-only, no Docker build) CDK synthesis —
  // ~25-30s in this repo (see the dockerignore test's header for the same
  // cost noted against the CLI's `cdk synth`). One synth shared across all
  // three assertions in this file, rather than one per `it`, keeps the whole
  // suite close to that single cost instead of multiplying it by 3.
  let template: Template;

  beforeAll(() => {
    template = synthTemplate();
  }, 60_000);

  it("gives ApiFn the same CACHE_DRIVER=dynamodb + CACHE_DYNAMO_TABLE env RedirectFn gets", () => {
    const cacheTables = template.findResources("AWS::DynamoDB::Table", {
      Properties: {
        KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
      },
    });
    const cacheTableLogicalIds = Object.keys(cacheTables);
    // Exactly one single-key-on-`pk` table: the CacheTable. (The link
    // projection table is PK/SK, so it does not match this shape and is not
    // conflated with the cache table here.)
    expect(cacheTableLogicalIds).toHaveLength(1);

    const functions = template.findResources("AWS::Lambda::Function");
    const byHandlerRole = (namePart: string) =>
      Object.entries(functions).find(([id]) => id.startsWith(namePart));

    const apiFnEntry = byHandlerRole("ApiFn");
    const redirectFnEntry = byHandlerRole("RedirectFn");
    expect(apiFnEntry, "ApiFn not found in the synthesized template").toBeDefined();
    expect(redirectFnEntry, "RedirectFn not found in the synthesized template").toBeDefined();

    const apiEnv = apiFnEntry![1].Properties.Environment.Variables;
    const redirectEnv = redirectFnEntry![1].Properties.Environment.Variables;

    expect(apiEnv.CACHE_DRIVER, "ApiFn.CACHE_DRIVER").toBe("dynamodb");
    expect(redirectEnv.CACHE_DRIVER, "RedirectFn.CACHE_DRIVER").toBe("dynamodb");

    // Both point at the SAME table (a { Ref: <logicalId> } to the one
    // CacheTable resource found above) — not just "some" DynamoDB table name.
    const cacheTableLogicalId = cacheTableLogicalIds[0];
    expect(apiEnv.CACHE_DYNAMO_TABLE).toEqual({ Ref: cacheTableLogicalId });
    expect(redirectEnv.CACHE_DYNAMO_TABLE).toEqual({ Ref: cacheTableLogicalId });
  });

  it("grants ApiFn IAM write access to the cache table (least-privilege: no read/scan)", () => {
    // grantWriteData's action set for a DynamoDB table (aws-cdk-lib's Table
    // construct) — PutItem/UpdateItem/DeleteItem/BatchWriteItem, the same
    // actions RedirectFn's grantReadWriteData includes for its write half.
    // Asserting the write actions are present (Match.arrayWith, not an exact
    // array) rather than the full read+write set is what actually
    // distinguishes "ApiFn can bust a key" from "ApiFn accidentally got the
    // broader grant redirectFn has" — the service only ever calls
    // CacheStore.del(), never get()/set().
    //
    // Scoped to ApiFn's OWN role (via Roles: Match.arrayWith([{ Ref:
    // apiRoleLogicalId }])) rather than "any IAM::Policy in the stack has a
    // DeleteItem statement somewhere" — the latter is satisfied by
    // RedirectFn's pre-existing grantReadWriteData regardless of whether
    // ApiFn ever got its own grant, so an unscoped version of this assertion
    // cannot actually distinguish "fixed" from "still broken".
    const apiFnEntry = Object.entries(template.findResources("AWS::Lambda::Function")).find(([id]) =>
      id.startsWith("ApiFn"),
    )!;
    const apiRoleLogicalId = apiFnEntry[1].Properties.Role["Fn::GetAtt"][0];

    template.hasResourceProperties("AWS::IAM::Policy", {
      Roles: Match.arrayWith([{ Ref: apiRoleLogicalId }]),
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([Match.stringLikeRegexp("dynamodb:DeleteItem")]),
            Effect: "Allow",
          }),
        ]),
      },
    });
  });

  it("does not grant ApiFn dynamodb:Scan or dynamodb:GetItem on the cache table", () => {
    // Least-privilege check for the grant added above: bust() only deletes,
    // so a broad read grant here would be unused surface, not a feature —
    // this pins grantWriteData (not grantReadWriteData) as the intended
    // shape rather than something a future edit could widen unnoticed.
    const policies = template.findResources("AWS::IAM::Policy");

    const cacheTables = template.findResources("AWS::DynamoDB::Table", {
      Properties: { KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }] },
    });
    const cacheTableLogicalId = Object.keys(cacheTables)[0];

    const apiFnEntry = Object.entries(template.findResources("AWS::Lambda::Function")).find(
      ([id]) => id.startsWith("ApiFn"),
    )!;
    const apiRoleLogicalId = apiFnEntry[1].Properties.Role["Fn::GetAtt"][0];

    // Find the policy attached to ApiFn's role and confirm its statements
    // referencing the cache table never include a read action.
    const apiFnPolicies = Object.entries(policies).filter(([, res]) =>
      (res.Properties.Roles ?? []).some(
        (r: unknown) => typeof r === "object" && r !== null && "Ref" in r && (r as { Ref: string }).Ref === apiRoleLogicalId,
      ),
    );

    const readActions = ["dynamodb:GetItem", "dynamodb:Scan", "dynamodb:Query"];
    for (const [, policy] of apiFnPolicies) {
      const statements = Array.isArray(policy.Properties.PolicyDocument.Statement)
        ? policy.Properties.PolicyDocument.Statement
        : [policy.Properties.PolicyDocument.Statement];
      for (const statement of statements) {
        const referencesCacheTable = JSON.stringify(statement).includes(cacheTableLogicalId);
        if (!referencesCacheTable) continue;
        const actions: string[] = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        for (const readAction of readActions) {
          expect(actions, `ApiFn's cache-table policy statement: ${JSON.stringify(statement)}`).not.toContain(
            readAction,
          );
        }
      }
    }
  });
});
