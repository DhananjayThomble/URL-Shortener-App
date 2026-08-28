/* ============================================================
   Every data hook in the app.

   This was one 177-line hooks.ts. It is now one file per API domain, matching
   the NestJS module that serves each group — links.ts talks to LinksController,
   members.ts to MembersController, and so on. Finding the hook for an endpoint
   no longer means scrolling past every unrelated one.

   The barrel keeps `@/lib/api/hooks` resolving exactly as it did, so no call
   site had to change to make the split. Import from here or from the specific
   module; both work.
   ============================================================ */

export { qk } from "./keys";

export * from "./analytics";
export * from "./auth";
export * from "./bio-pages";
export * from "./developers";
export * from "./domains";
export * from "./links";
export * from "./members";
export * from "./public";
export * from "./workspace";
