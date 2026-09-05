import "reflect-metadata";
/* Import order matters here, unusually: extendZodWithOpenApi() (inside
   ./openapi/registry.js, pulled in by document.js below) has to patch zod's
   prototypes before ANY zod schema anywhere in the app is constructed — the
   patch does not apply retroactively to schemas already built with the
   unpatched .object()/.extend()/.optional() etc, only to ones built after.
   AppModule transitively constructs every schema in packages/contract the
   moment it loads, so this import has to come first. This project compiles
   to CommonJS, where imports run in source order rather than being hoisted,
   which is what makes that ordering meaningful at all. */
import { buildOpenApiDocument } from "./openapi/document.js";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import cors from "@fastify/cors";
import { resolveSecrets } from "@snapurl/database";
import { AppModule } from "./app.module.js";
import { ENV, type Env } from "./config/env.js";
import { resolveCorsOrigins } from "./config/cors-origins.js";

/* Resolve the database and JWT secrets from Secrets Manager (see
   packages/database/src/secrets.ts) and assign them onto process.env BEFORE the
   ConfigModule's useFactory runs loadEnv(). When no *_SECRET_ARN env var is set
   this makes no SDK call and touches nothing, so the plain-env path (local dev,
   compose, single-node, Kubernetes) is byte-identical. Nothing in the API reads
   these vars at import time, so running this first is safe. */
async function hydrateSecretsIntoEnv(): Promise<void> {
  const { databaseUrl, jwtAccessSecret, jwtRefreshSecret } = await resolveSecrets();
  if (databaseUrl !== undefined) process.env.DATABASE_URL = databaseUrl;
  if (jwtAccessSecret !== undefined) process.env.JWT_ACCESS_SECRET = jwtAccessSecret;
  if (jwtRefreshSecret !== undefined) process.env.JWT_REFRESH_SECRET = jwtRefreshSecret;
}

async function bootstrap() {
  await hydrateSecretsIntoEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    /* Do NOT trust any proxy for Fastify's req.ip: `trustProxy: true` would
       surface the client-typed leftmost X-Forwarded-For entry, and Fastify 5's
       numeric hop-count is disabled as unsafe. The authoritative client IP for
       rate limiting is derived instead by ProxyAwareThrottlerGuard from the
       rightmost trustworthy X-Forwarded-For entry (see #279). Nothing else in
       the API reads req.ip. */
    new FastifyAdapter({ trustProxy: false }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  const env = app.get<Env>(ENV);

  app.setGlobalPrefix(env.API_PREFIX);

  /* The dashboard is a separate origin, and the frontend sends its token in an
     Authorization header rather than a cookie — so credentials are not needed
     and the allowlist can stay narrow. */
  await app.register(cors, {
    origin: resolveCorsOrigins({
      nodeEnv: env.NODE_ENV,
      webOrigin: env.WEB_ORIGIN,
      extensionOrigins: env.EXTENSION_ORIGINS,
    }),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
    maxAge: 86_400,
  });

  app.enableShutdownHooks();

  /* Generated from packages/contract (#339), not from decorators — see
     openapi/registry.ts for why. Mounted next to the prefix it documents
     (env.API_PREFIX/docs) rather than a fixed path, so it still lines up if
     that prefix is ever changed. */
  const openApiDocument = buildOpenApiDocument(env.API_PREFIX);
  // zod-to-openapi's OpenAPIObject (openapi3-ts) and @nestjs/swagger's own
  // OpenAPIObject type are two independent declarations of the same OpenAPI
  // 3.0 JSON shape — structurally compatible at runtime, nominally distinct
  // to the type checker. SwaggerModule.setup() only ever serializes this.
  SwaggerModule.setup(`${env.API_PREFIX}/docs`, app, openApiDocument as unknown as OpenAPIObject);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });

  const logger = app.get(Logger);
  logger.log(`SnapURL API listening on http://localhost:${env.PORT}/${env.API_PREFIX}`);
  logger.log(`API docs at http://localhost:${env.PORT}/${env.API_PREFIX}/docs`);
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
