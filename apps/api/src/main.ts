import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";
import cors from "@fastify/cors";
import { AppModule } from "./app.module.js";
import { ENV, type Env } from "./config/env.js";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  const env = app.get<Env>(ENV);

  app.setGlobalPrefix(env.API_PREFIX);

  /* The dashboard is a separate origin, and the frontend sends its token in an
     Authorization header rather than a cookie — so credentials are not needed
     and the allowlist can stay narrow. */
  await app.register(cors, {
    origin: env.NODE_ENV === "development" ? true : [env.WEB_ORIGIN],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
    maxAge: 86_400,
  });

  app.enableShutdownHooks();

  await app.listen({ port: env.PORT, host: "0.0.0.0" });

  const logger = app.get(Logger);
  logger.log(`SnapURL API listening on http://localhost:${env.PORT}/${env.API_PREFIX}`);
  if (!env.GOOGLE_SAFE_BROWSING_API_KEY) {
    logger.warn(
      "Safe Browsing is off (no GOOGLE_SAFE_BROWSING_API_KEY). Links will be marked clean without being scanned.",
    );
  }
}

bootstrap().catch((err) => {
  // Config errors happen before the logger exists, so this is console on purpose.
  console.error("Failed to start the API:", err);
  process.exit(1);
});
