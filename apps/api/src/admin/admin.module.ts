import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { AdminGuard } from "./admin.guard.js";

/* #968 — the platform-admin module. AdminService resolves the role from the
   live user row + PLATFORM_ADMIN_EMAILS; AdminGuard enforces it on every route.
   DB and ENV come from the global DatabaseModule/ConfigModule. */
@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
  exports: [AdminService],
})
export class AdminModule {}
