import { Module } from "@nestjs/common";
import { WorkspacesController } from "./workspaces.controller.js";
import { WorkspacesService } from "./workspaces.service.js";
import { WorkspaceRemovalService } from "./workspace-removal.service.js";

@Module({ controllers: [WorkspacesController], providers: [WorkspacesService, WorkspaceRemovalService], exports: [WorkspacesService, WorkspaceRemovalService] })
export class WorkspacesModule {}
