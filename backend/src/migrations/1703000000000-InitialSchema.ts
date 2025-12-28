import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1703000000000 implements MigrationInterface {
  name = 'InitialSchema1703000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable UUID extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Create users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "password_hash" character varying NOT NULL,
        "name" character varying NOT NULL,
        "is_email_verified" boolean NOT NULL DEFAULT false,
        "role" character varying NOT NULL DEFAULT 'user',
        "custom_domain_id" uuid,
        "email_verification_token" character varying,
        "password_reset_token" character varying,
        "password_reset_expires" TIMESTAMP,
        "last_login_at" TIMESTAMP,
        "last_login_ip" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);

    // Create custom_domains table
    await queryRunner.query(`
      CREATE TABLE "custom_domains" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "domain" character varying NOT NULL,
        "user_id" uuid NOT NULL,
        "is_verified" boolean NOT NULL DEFAULT false,
        "dns_records" jsonb,
        "ssl_certificate" text,
        "ssl_private_key" text,
        "ssl_expires_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_custom_domains_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_custom_domains_domain" UNIQUE ("domain")
      )
    `);

    // Create admin_users table
    await queryRunner.query(`
      CREATE TABLE "admin_users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "password_hash" character varying NOT NULL,
        "name" character varying NOT NULL,
        "permissions" jsonb NOT NULL DEFAULT '[]',
        "is_active" boolean NOT NULL DEFAULT true,
        "last_login_at" TIMESTAMP,
        "last_login_ip" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_admin_users_email" UNIQUE ("email")
      )
    `);

    // Create refresh_tokens table
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "token_hash" character varying NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens_id" PRIMARY KEY ("id")
      )
    `);

    // Create audit_logs table
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid,
        "admin_id" uuid,
        "action" character varying NOT NULL,
        "resource" character varying NOT NULL,
        "resource_id" character varying,
        "details" jsonb,
        "ip_address" character varying NOT NULL,
        "user_agent" character varying,
        "request_id" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "custom_domains" 
      ADD CONSTRAINT "FK_custom_domains_user_id" 
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD CONSTRAINT "FK_users_custom_domain_id" 
      FOREIGN KEY ("custom_domain_id") REFERENCES "custom_domains"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens" 
      ADD CONSTRAINT "FK_refresh_tokens_user_id" 
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // Create indexes for better performance
    await queryRunner.query(`CREATE INDEX "IDX_users_email" ON "users" ("email")`);
    await queryRunner.query(`CREATE INDEX "IDX_users_role" ON "users" ("role")`);
    await queryRunner.query(`CREATE INDEX "IDX_custom_domains_user_id" ON "custom_domains" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_custom_domains_domain" ON "custom_domains" ("domain")`);
    await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_expires_at" ON "refresh_tokens" ("expires_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_user_id_created_at" ON "audit_logs" ("user_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_action_created_at" ON "audit_logs" ("action", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_created_at" ON "audit_logs" ("created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraints
    await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_refresh_tokens_user_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_custom_domain_id"`);
    await queryRunner.query(`ALTER TABLE "custom_domains" DROP CONSTRAINT "FK_custom_domains_user_id"`);

    // Drop indexes
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_action_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_user_id_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_refresh_tokens_expires_at"`);
    await queryRunner.query(`DROP INDEX "IDX_refresh_tokens_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_custom_domains_domain"`);
    await queryRunner.query(`DROP INDEX "IDX_custom_domains_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_users_role"`);
    await queryRunner.query(`DROP INDEX "IDX_users_email"`);

    // Drop tables
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "admin_users"`);
    await queryRunner.query(`DROP TABLE "custom_domains"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}