import { MigrationInterface, QueryRunner, Table, Index, ForeignKey } from 'typeorm';

export class CreateBioPagesSchema1703200000000 implements MigrationInterface {
  name = 'CreateBioPagesSchema1703200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create bio_pages table
    await queryRunner.createTable(
      new Table({
        name: 'bio_pages',
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
            name: 'username',
            type: 'varchar',
            length: '50',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'title',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'bio',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'avatar_url',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'theme',
            type: 'varchar',
            length: '20',
            default: "'default'",
            isNullable: false,
          },
          {
            name: 'background_color',
            type: 'varchar',
            length: '7',
            default: "'#ffffff'",
            isNullable: false,
          },
          {
            name: 'text_color',
            type: 'varchar',
            length: '7',
            default: "'#000000'",
            isNullable: false,
          },
          {
            name: 'button_style',
            type: 'varchar',
            length: '20',
            default: "'rounded'",
            isNullable: false,
          },
          {
            name: 'is_public',
            type: 'boolean',
            default: true,
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Create bio_links table
    await queryRunner.createTable(
      new Table({
        name: 'bio_links',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'bio_page_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'title',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'url',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'icon',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'position',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'bio_pages',
      new Index('IDX_bio_pages_username', ['username'], { isUnique: true }),
    );

    await queryRunner.createIndex(
      'bio_pages',
      new Index('IDX_bio_pages_user_id', ['user_id']),
    );

    await queryRunner.createIndex(
      'bio_links',
      new Index('IDX_bio_links_bio_page_id', ['bio_page_id']),
    );

    await queryRunner.createIndex(
      'bio_links',
      new Index('IDX_bio_links_position', ['bio_page_id', 'position']),
    );

    // Create foreign key constraints
    await queryRunner.createForeignKey(
      'bio_pages',
      new ForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
        name: 'FK_bio_pages_user_id',
      }),
    );

    await queryRunner.createForeignKey(
      'bio_links',
      new ForeignKey({
        columnNames: ['bio_page_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'bio_pages',
        onDelete: 'CASCADE',
        name: 'FK_bio_links_bio_page_id',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys
    await queryRunner.dropForeignKey('bio_links', 'FK_bio_links_bio_page_id');
    await queryRunner.dropForeignKey('bio_pages', 'FK_bio_pages_user_id');

    // Drop indexes
    await queryRunner.dropIndex('bio_links', 'IDX_bio_links_position');
    await queryRunner.dropIndex('bio_links', 'IDX_bio_links_bio_page_id');
    await queryRunner.dropIndex('bio_pages', 'IDX_bio_pages_user_id');
    await queryRunner.dropIndex('bio_pages', 'IDX_bio_pages_username');

    // Drop tables
    await queryRunner.dropTable('bio_links');
    await queryRunner.dropTable('bio_pages');
  }
}