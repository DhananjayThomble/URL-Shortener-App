import { MigrationInterface, QueryRunner, Table, Index, ForeignKey } from 'typeorm';

export class CreateLinksSchema1703100000000 implements MigrationInterface {
  name = 'CreateLinksSchema1703100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create links table
    await queryRunner.createTable(
      new Table({
        name: 'links',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'original_url',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'short_code',
            type: 'varchar',
            length: '10',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'custom_alias',
            type: 'varchar',
            length: '50',
            isUnique: true,
            isNullable: true,
          },
          {
            name: 'title',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'password_hash',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'password_hint',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'ios_url',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'android_url',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'utm_source',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'utm_medium',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'utm_campaign',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'utm_term',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'utm_content',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'meta_pixel_id',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'google_analytics_id',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'tiktok_pixel_id',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'visit_count',
            type: 'integer',
            default: 0,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create geo_rules table
    await queryRunner.createTable(
      new Table({
        name: 'geo_rules',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'link_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'country_code',
            type: 'varchar',
            length: '2',
            isNullable: false,
          },
          {
            name: 'redirect_url',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create tags table
    await queryRunner.createTable(
      new Table({
        name: 'tags',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'color',
            type: 'varchar',
            length: '7',
            default: "'#6366f1'",
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create link_tags junction table
    await queryRunner.createTable(
      new Table({
        name: 'link_tags',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'link_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'tag_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create indexes using raw SQL for compatibility
    await queryRunner.query(`CREATE INDEX "IDX_links_short_code" ON "links" ("short_code")`);
    await queryRunner.query(`CREATE INDEX "IDX_links_user_id_created_at" ON "links" ("user_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_links_user_id_is_active" ON "links" ("user_id", "is_active")`);
    await queryRunner.query(`CREATE INDEX "IDX_links_expires_at" ON "links" ("expires_at")`);

    await queryRunner.query(`CREATE INDEX "IDX_geo_rules_link_id" ON "geo_rules" ("link_id")`);
    
    await queryRunner.query(`CREATE INDEX "IDX_tags_user_id" ON "tags" ("user_id")`);
    
    await queryRunner.query(`CREATE INDEX "IDX_link_tags_link_id" ON "link_tags" ("link_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_link_tags_tag_id" ON "link_tags" ("tag_id")`);

    // Create unique constraints
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_tags_user_id_name" ON "tags" ("user_id", "name")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_link_tags_link_id_tag_id" ON "link_tags" ("link_id", "tag_id")`);

    // Create foreign keys using raw SQL for compatibility
    await queryRunner.query(`ALTER TABLE "links" ADD CONSTRAINT "FK_links_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "geo_rules" ADD CONSTRAINT "FK_geo_rules_link_id" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "tags" ADD CONSTRAINT "FK_tags_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "link_tags" ADD CONSTRAINT "FK_link_tags_link_id" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "link_tags" ADD CONSTRAINT "FK_link_tags_tag_id" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys
    const linksTable = await queryRunner.getTable('links');
    const geoRulesTable = await queryRunner.getTable('geo_rules');
    const tagsTable = await queryRunner.getTable('tags');
    const linkTagsTable = await queryRunner.getTable('link_tags');

    if (linksTable) {
      const linksForeignKeys = linksTable.foreignKeys;
      for (const foreignKey of linksForeignKeys) {
        await queryRunner.dropForeignKey('links', foreignKey);
      }
    }

    if (geoRulesTable) {
      const geoRulesForeignKeys = geoRulesTable.foreignKeys;
      for (const foreignKey of geoRulesForeignKeys) {
        await queryRunner.dropForeignKey('geo_rules', foreignKey);
      }
    }

    if (tagsTable) {
      const tagsForeignKeys = tagsTable.foreignKeys;
      for (const foreignKey of tagsForeignKeys) {
        await queryRunner.dropForeignKey('tags', foreignKey);
      }
    }

    if (linkTagsTable) {
      const linkTagsForeignKeys = linkTagsTable.foreignKeys;
      for (const foreignKey of linkTagsForeignKeys) {
        await queryRunner.dropForeignKey('link_tags', foreignKey);
      }
    }

    // Drop tables
    await queryRunner.dropTable('link_tags');
    await queryRunner.dropTable('tags');
    await queryRunner.dropTable('geo_rules');
    await queryRunner.dropTable('links');
  }
}