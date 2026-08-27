import { Global, Module } from "@nestjs/common";
import { ENV, loadEnv } from "./env.js";

/* Validated once, injected everywhere. Nothing else reads process.env. */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
