import type { Pool } from "pg";

const MIGRATION_VERSION = 2;

export function quoteIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function migrationStatements(schemaName: string): string[] {
  const schema = quoteIdentifier(schemaName);
  return [
    `CREATE SCHEMA IF NOT EXISTS ${schema}`,
    `CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.memories (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject TEXT,
      content TEXT NOT NULL,
      tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      source TEXT,
      source_ref TEXT,
      occurred_at TEXT,
      importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
      sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'sensitive')),
      confidence DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'deleted')),
      superseded_by TEXT REFERENCES ${schema}.memories(id),
      dedupe_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS id TEXT DEFAULT gen_random_uuid()::text`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS owner_key TEXT NOT NULL DEFAULT 'legacy'`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'note'`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS subject TEXT`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS tags_json JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS source_ref TEXT`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS occurred_at TEXT`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS importance SMALLINT NOT NULL DEFAULT 3`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS sensitivity TEXT NOT NULL DEFAULT 'normal'`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NOT NULL DEFAULT 1`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS superseded_by TEXT`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS dedupe_hash TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text)`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    `ALTER TABLE ${schema}.memories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `UPDATE ${schema}.memories SET id = gen_random_uuid()::text WHERE id IS NULL OR btrim(id) = ''`,
    `ALTER TABLE ${schema}.memories ALTER COLUMN id SET NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS memories_id_unique ON ${schema}.memories(id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS memories_owner_dedupe_active
      ON ${schema}.memories(owner_key, dedupe_hash) WHERE status = 'active'`,
    `CREATE INDEX IF NOT EXISTS memories_owner_status_updated
      ON ${schema}.memories(owner_key, status, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS memories_search_gin
      ON ${schema}.memories USING GIN (
        to_tsvector('simple'::regconfig, coalesce(subject, '') || ' ' || coalesce(content, ''))
      )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.documents (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      title TEXT NOT NULL,
      source_uri TEXT,
      mime_type TEXT,
      tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      content_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE ${schema}.documents ADD COLUMN IF NOT EXISTS id TEXT DEFAULT gen_random_uuid()::text`,
    `ALTER TABLE ${schema}.documents ADD COLUMN IF NOT EXISTS owner_key TEXT NOT NULL DEFAULT 'legacy'`,
    `ALTER TABLE ${schema}.documents ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Untitled'`,
    `ALTER TABLE ${schema}.documents ADD COLUMN IF NOT EXISTS source_uri TEXT`,
    `ALTER TABLE ${schema}.documents ADD COLUMN IF NOT EXISTS mime_type TEXT`,
    `ALTER TABLE ${schema}.documents ADD COLUMN IF NOT EXISTS tags_json JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE ${schema}.documents ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE ${schema}.documents ADD COLUMN IF NOT EXISTS chunk_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE ${schema}.documents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    `ALTER TABLE ${schema}.documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    `UPDATE ${schema}.documents SET id = gen_random_uuid()::text WHERE id IS NULL OR btrim(id) = ''`,
    `ALTER TABLE ${schema}.documents ALTER COLUMN id SET NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS documents_id_unique ON ${schema}.documents(id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS documents_owner_source
      ON ${schema}.documents(owner_key, source_uri) WHERE source_uri IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS documents_owner_updated
      ON ${schema}.documents(owner_key, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS ${schema}.document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES ${schema}.documents(id) ON DELETE CASCADE,
      owner_key TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      locator TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(document_id, chunk_index)
    )`,
    `ALTER TABLE ${schema}.document_chunks ADD COLUMN IF NOT EXISTS id TEXT DEFAULT gen_random_uuid()::text`,
    `ALTER TABLE ${schema}.document_chunks ADD COLUMN IF NOT EXISTS document_id TEXT`,
    `ALTER TABLE ${schema}.document_chunks ADD COLUMN IF NOT EXISTS owner_key TEXT NOT NULL DEFAULT 'legacy'`,
    `ALTER TABLE ${schema}.document_chunks ADD COLUMN IF NOT EXISTS chunk_index INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE ${schema}.document_chunks ADD COLUMN IF NOT EXISTS locator TEXT NOT NULL DEFAULT 'chunk:1'`,
    `ALTER TABLE ${schema}.document_chunks ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE ${schema}.document_chunks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    `UPDATE ${schema}.document_chunks SET id = gen_random_uuid()::text WHERE id IS NULL OR btrim(id) = ''`,
    `ALTER TABLE ${schema}.document_chunks ALTER COLUMN id SET NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS document_chunks_id_unique ON ${schema}.document_chunks(id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS document_chunks_document_position
      ON ${schema}.document_chunks(document_id, chunk_index)`,
    `CREATE INDEX IF NOT EXISTS document_chunks_owner_document
      ON ${schema}.document_chunks(owner_key, document_id)`,
    `CREATE INDEX IF NOT EXISTS document_chunks_search_gin
      ON ${schema}.document_chunks USING GIN (to_tsvector('simple'::regconfig, coalesce(content, '')))`,
    `CREATE TABLE IF NOT EXISTS ${schema}.stored_files (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      label TEXT NOT NULL,
      original_name TEXT NOT NULL,
      storage_ref TEXT NOT NULL,
      mime_type TEXT,
      file_size BIGINT NOT NULL DEFAULT 0 CHECK (file_size >= 0),
      tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_channel TEXT,
      source_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS id TEXT DEFAULT gen_random_uuid()::text`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS owner_key TEXT NOT NULL DEFAULT 'legacy'`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT 'Tệp không có nhãn'`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS original_name TEXT NOT NULL DEFAULT 'file'`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS storage_ref TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS mime_type TEXT`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS file_size BIGINT NOT NULL DEFAULT 0`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS tags_json JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS source_channel TEXT`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS source_message_id TEXT`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    `ALTER TABLE ${schema}.stored_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `UPDATE ${schema}.stored_files SET id = gen_random_uuid()::text WHERE id IS NULL OR btrim(id) = ''`,
    `ALTER TABLE ${schema}.stored_files ALTER COLUMN id SET NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS stored_files_id_unique ON ${schema}.stored_files(id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS stored_files_owner_label_active
      ON ${schema}.stored_files(owner_key, lower(label)) WHERE status = 'active'`,
    `CREATE INDEX IF NOT EXISTS stored_files_owner_updated
      ON ${schema}.stored_files(owner_key, status, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS stored_files_search_gin
      ON ${schema}.stored_files USING GIN (
        to_tsvector('simple'::regconfig, coalesce(label, '') || ' ' || coalesce(original_name, ''))
      )`,
    `INSERT INTO ${schema}.schema_migrations(version, name)
      VALUES (1, 'initial_neon_postgresql_schema')
      ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name`,
    `INSERT INTO ${schema}.schema_migrations(version, name)
      VALUES (${MIGRATION_VERSION}, 'stored_file_metadata')
      ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name`,
  ];
}

export async function runMigrations(pool: Pool, schemaName: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `openclaw-personal-assistant:${schemaName}`,
    ]);
    for (const statement of migrationStatements(schemaName)) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
