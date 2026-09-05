import { z } from "zod";
import { IdParam, refs, route } from "../registry.js";

route({
  method: "get",
  path: "/members",
  tag: "Members",
  summary: "List workspace members",
  responses: { 200: { description: "Members", schema: z.array(refs.Member) } },
});

route({
  method: "post",
  path: "/members",
  tag: "Members",
  summary: "Invite a member",
  body: refs.InviteMemberInput,
  responses: { 201: { description: "The invited member", schema: refs.Member } },
});

route({
  method: "patch",
  path: "/members/{id}",
  tag: "Members",
  summary: "Change a member's role",
  params: IdParam,
  body: refs.ChangeRoleInput,
  responses: { 204: { description: "Changed" } },
});

route({
  method: "delete",
  path: "/members/{id}",
  tag: "Members",
  summary: "Remove a member",
  params: IdParam,
  responses: { 204: { description: "Removed" } },
});

route({
  method: "get",
  path: "/audit",
  tag: "Audit",
  summary: "The workspace's audit log",
  responses: { 200: { description: "Audit entries", schema: z.array(refs.AuditEntry) } },
});
