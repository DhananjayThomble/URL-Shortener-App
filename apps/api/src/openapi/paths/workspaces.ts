import { refs, route } from "../registry.js";

route({
  method: "get",
  path: "/workspaces/current",
  tag: "Workspace",
  summary: "Get the caller's workspace",
  responses: { 200: { description: "The workspace", schema: refs.Workspace } },
});

route({
  method: "patch",
  path: "/workspaces/current",
  tag: "Workspace",
  summary: "Update workspace settings",
  body: refs.UpdateWorkspaceInput,
  responses: { 200: { description: "The updated workspace", schema: refs.Workspace } },
});
