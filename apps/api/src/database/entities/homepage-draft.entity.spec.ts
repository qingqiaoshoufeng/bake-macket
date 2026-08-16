import 'reflect-metadata';

import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AdminUser } from './admin-user.entity.js';
import { HomepageDraft } from './homepage-draft.entity.js';
import { HomepagePage } from './homepage-page.entity.js';
import { User } from './user.entity.js';

describe('HomepageDraft entity metadata', () => {
  it('maps per-page drafts with unique names and cascade-safe relations', async () => {
    const dataSource = new DataSource({
      type: 'mysql',
      database: 'metadata_test',
      entities: [User, AdminUser, HomepagePage, HomepageDraft],
    });

    await (
      dataSource as DataSource & { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    const pageMetadata = dataSource.getMetadata(HomepagePage);
    const draftMetadata = dataSource.getMetadata(HomepageDraft);

    expect(
      pageMetadata.columns.map(({ databaseName }) => databaseName).toSorted(),
    ).toEqual([
      'created_at',
      'id',
      'page_key',
      'published_at',
      'published_by_admin_id',
      'published_config',
      'published_draft_id',
      'published_draft_version',
      'published_version',
      'updated_at',
    ]);
    expect(
      pageMetadata.indices.some(
        ({ givenName, isUnique, columns }) =>
          givenName === 'uniq_homepage_pages_page_key' &&
          isUnique &&
          columns.map(({ propertyName }) => propertyName).join(',') ===
            'pageKey',
      ),
    ).toBe(true);

    expect(
      draftMetadata.columns.map(({ databaseName }) => databaseName).toSorted(),
    ).toEqual([
      'created_at',
      'draft_config',
      'homepage_page_id',
      'id',
      'name',
      'updated_at',
      'updated_by_admin_id',
      'version',
    ]);
    expect(
      draftMetadata.indices.some(
        ({ givenName, isUnique, columns }) =>
          givenName === 'uniq_homepage_drafts_page_name' &&
          isUnique &&
          columns.map(({ propertyName }) => propertyName).join(',') ===
            'homepagePageId,name',
      ),
    ).toBe(true);
    expect(
      draftMetadata.indices.some(
        ({ name, columns }) =>
          name === 'idx_homepage_drafts_page_updated' &&
          columns.map(({ propertyName }) => propertyName).join(',') ===
            'homepagePageId,updatedAt,id',
      ),
    ).toBe(true);

    const pageRelation = draftMetadata.relations.find(
      ({ propertyName }) => propertyName === 'homepagePage',
    );
    expect(pageRelation?.onDelete).toBe('CASCADE');
    expect(pageRelation?.onUpdate).toBe('CASCADE');
    expect(
      pageRelation?.joinColumns.map(({ databaseName }) => databaseName),
    ).toEqual(['homepage_page_id']);
    expect(pageRelation?.foreignKeys[0]?.name).toBe('fk_homepage_drafts_page');

    const editorRelation = draftMetadata.relations.find(
      ({ propertyName }) => propertyName === 'updatedByAdmin',
    );
    expect(editorRelation?.isNullable).toBe(true);
    expect(editorRelation?.onDelete).toBe('SET NULL');
    expect(editorRelation?.onUpdate).toBe('CASCADE');
    expect(
      editorRelation?.joinColumns.map(({ databaseName }) => databaseName),
    ).toEqual(['updated_by_admin_id']);
    expect(editorRelation?.foreignKeys[0]?.name).toBe(
      'fk_homepage_drafts_updated_admin',
    );

    const publishedDraftRelation = pageMetadata.relations.find(
      ({ propertyName }) => propertyName === 'publishedDraft',
    );
    expect(publishedDraftRelation?.isNullable).toBe(true);
    expect(publishedDraftRelation?.onDelete).toBe('RESTRICT');
    expect(publishedDraftRelation?.onUpdate).toBe('CASCADE');
    expect(
      publishedDraftRelation?.joinColumns.map(
        ({ databaseName }) => databaseName,
      ),
    ).toEqual(['published_draft_id']);
    expect(publishedDraftRelation?.foreignKeys[0]?.name).toBe(
      'fk_homepage_pages_published_draft',
    );
  });
});
