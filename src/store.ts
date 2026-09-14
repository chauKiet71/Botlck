import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { chunkDocument } from "./chunk.js";
import type { PluginConfig } from "./config.js";
import { runMigrations, quoteIdentifier } from "./migrations.js";
import type {
  DocumentInput,
  DocumentRecord,
  DocumentSearchHit,
  MemoryInput,
  MemoryKind,
  MemoryRecord,
  StoredFileInput,
  StoredFileRecord,
} from "./types.js";

interface RawMemoryRow extends QueryResultRow {
  id: string;
  owner_key: string;
  kind: MemoryKind;
  subject: string | null;
  content: string;
  tags_json: unknown;
  source: string | null;
  source_ref: string | null;
  occurred_at: string | null;
  importance: number;
  sensitivity: "normal" | "sensitive";
  confidence: number;
  status: "active" | "superseded" | "deleted";
  superseded_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RawDocumentRow extends QueryResultRow {
  id: string;
  owner_key: string;
  title: string;
  source_uri: string | null;
  mime_type: string | null;
  tags_json: unknown;
  content_hash: string;
  chunk_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RawDocumentSearchRow extends QueryResultRow {
  document_id: string;
  title: string;
  source_uri: string | null;
  chunk_index: number;
  locator: string;
  content: string;
}

interface RawStoredFileRow extends QueryResultRow {
  id: string;
  owner_key: string;
  label: string;
  original_name: string;
  storage_ref: string;
  mime_type: string | null;
  file_size: string | number;
  tags_json: unknown;
  source_channel: string | null;
  source_message_id: string | null;
  status: "active" | "deleted";
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean))].slice(
    0,
    30,
  );
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function hashContent(value: string): string {
  return createHash("sha256").update(value.trim().replace(/\s+/g, " ")).digest("hex");
}

function memoryFromRow(row: RawMemoryRow): MemoryRecord {
  return {
    id: row.id,
    ownerKey: row.owner_key,
    kind: row.kind,
    subject: row.subject,
    content: row.content,
    tags: parseTags(row.tags_json),
    source: row.source,
    sourceRef: row.source_ref,
    occurredAt: row.occurred_at,
    importance: Number(row.importance),
    sensitivity: row.sensitivity,
    confidence: Number(row.confidence),
    status: row.status,
    supersededBy: row.superseded_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function documentFromRow(row: RawDocumentRow): DocumentRecord {
  return {
    id: row.id,
    ownerKey: row.owner_key,
    title: row.title,
    sourceUri: row.source_uri,
    mimeType: row.mime_type,
    tags: parseTags(row.tags_json),
    contentHash: row.content_hash,
    chunkCount: Number(row.chunk_count),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function storedFileFromRow(row: RawStoredFileRow): StoredFileRecord {
  return {
    id: row.id,
    ownerKey: row.owner_key,
    label: row.label,
    originalName: row.original_name,
    storageRef: row.storage_ref,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    tags: parseTags(row.tags_json),
    sourceChannel: row.source_channel,
    sourceMessageId: row.source_message_id,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
  };
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export class AssistantStore {
  readonly #pool: Pool;
  readonly #schema: string;
  readonly #config: PluginConfig;
  readonly #readyPromise: Promise<void>;

  constructor(config: PluginConfig) {
    this.#config = config;
    this.#schema = quoteIdentifier(config.databaseSchema);
    this.#pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.maxPoolSize,
      connectionTimeoutMillis: config.connectionTimeoutMs,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      application_name: "openclaw-personal-assistant",
    });
    this.#readyPromise = runMigrations(this.#pool, config.databaseSchema);
  }

  async ready(): Promise<void> {
    await this.#readyPromise;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async remember(ownerKey: string, input: MemoryInput): Promise<{ memory: MemoryRecord; created: boolean }> {
    await this.ready();
    const tags = normalizeTags(input.tags);
    const subject = input.subject?.trim() || null;
    const content = input.content.trim();
    if (!content) throw new Error("Memory content cannot be empty.");
    const dedupeHash = hashContent(`${input.kind}\n${subject ?? ""}\n${content}`);

    const existing = await this.#pool.query<RawMemoryRow>(
      `SELECT * FROM ${this.#schema}.memories
       WHERE owner_key = $1 AND dedupe_hash = $2 AND status = 'active'
       LIMIT 1`,
      [ownerKey, dedupeHash],
    );
    if (existing.rows[0]) return { memory: memoryFromRow(existing.rows[0]), created: false };

    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      if (input.supersedesId) {
        const old = await client.query(
          `SELECT id FROM ${this.#schema}.memories
           WHERE id = $1 AND owner_key = $2 AND status = 'active'
           FOR UPDATE`,
          [input.supersedesId, ownerKey],
        );
        if (!old.rows[0]) throw new Error("The memory to supersede was not found for this owner.");
      }

      const id = randomUUID();
      const inserted = await client.query<RawMemoryRow>(
        `INSERT INTO ${this.#schema}.memories (
          id, owner_key, kind, subject, content, tags_json, source, source_ref,
          occurred_at, importance, sensitivity, confidence, status, superseded_by,
          dedupe_hash, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, 'active', NULL, $13, now(), now())
        ON CONFLICT (owner_key, dedupe_hash) WHERE status = 'active' DO NOTHING
        RETURNING *`,
        [
          id,
          ownerKey,
          input.kind,
          subject,
          content,
          JSON.stringify(tags),
          input.source?.trim() || null,
          input.sourceRef?.trim() || null,
          input.occurredAt?.trim() || null,
          Math.trunc(clamp(input.importance, 3, 1, 5)),
          input.sensitivity ?? "normal",
          clamp(input.confidence, 1, 0, 1),
          dedupeHash,
        ],
      );

      if (!inserted.rows[0]) {
        const duplicate = await client.query<RawMemoryRow>(
          `SELECT * FROM ${this.#schema}.memories
           WHERE owner_key = $1 AND dedupe_hash = $2 AND status = 'active'
           LIMIT 1`,
          [ownerKey, dedupeHash],
        );
        if (!duplicate.rows[0]) throw new Error("Memory insert conflicted but the existing row could not be loaded.");
        await client.query("COMMIT");
        return { memory: memoryFromRow(duplicate.rows[0]), created: false };
      }

      if (input.supersedesId) {
        await client.query(
          `UPDATE ${this.#schema}.memories
           SET status = 'superseded', superseded_by = $1, updated_at = now()
           WHERE id = $2 AND owner_key = $3 AND status = 'active'`,
          [id, input.supersedesId, ownerKey],
        );
      }
      await client.query("COMMIT");
      return { memory: memoryFromRow(inserted.rows[0]), created: true };
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getMemory(ownerKey: string, id: string): Promise<MemoryRecord | null> {
    await this.ready();
    const result = await this.#pool.query<RawMemoryRow>(
      `SELECT * FROM ${this.#schema}.memories WHERE owner_key = $1 AND id = $2`,
      [ownerKey, id],
    );
    return result.rows[0] ? memoryFromRow(result.rows[0]) : null;
  }

  async listMemories(
    ownerKey: string,
    options: { kind?: MemoryKind; limit?: number } = {},
  ): Promise<MemoryRecord[]> {
    await this.ready();
    const limit = Math.trunc(clamp(options.limit, 20, 1, 100));
    const result = await this.#pool.query<RawMemoryRow>(
      `SELECT * FROM ${this.#schema}.memories
       WHERE owner_key = $1 AND status = 'active' AND ($2::text IS NULL OR kind = $2)
       ORDER BY importance DESC, updated_at DESC
       LIMIT $3`,
      [ownerKey, options.kind ?? null, limit],
    );
    return result.rows.map(memoryFromRow);
  }

  async searchMemories(
    ownerKey: string,
    query: string,
    options: { kind?: MemoryKind; limit?: number } = {},
  ): Promise<MemoryRecord[]> {
    await this.ready();
    const cleanedQuery = query.trim();
    if (!cleanedQuery) return this.listMemories(ownerKey, options);
    const limit = Math.trunc(clamp(options.limit, 8, 1, 30));
    const result = await this.#pool.query<RawMemoryRow>(
      `SELECT * FROM ${this.#schema}.memories
       WHERE owner_key = $1
         AND status = 'active'
         AND ($3::text IS NULL OR kind = $3)
         AND (
           to_tsvector('simple'::regconfig, coalesce(subject, '') || ' ' || coalesce(content, ''))
             @@ websearch_to_tsquery('simple'::regconfig, $2)
           OR coalesce(subject, '') ILIKE '%' || $2 || '%'
           OR content ILIKE '%' || $2 || '%'
           OR tags_json::text ILIKE '%' || $2 || '%'
         )
       ORDER BY
         ts_rank_cd(
           to_tsvector('simple'::regconfig, coalesce(subject, '') || ' ' || coalesce(content, '')),
           websearch_to_tsquery('simple'::regconfig, $2)
         ) DESC,
         importance DESC,
         updated_at DESC
       LIMIT $4`,
      [ownerKey, cleanedQuery, options.kind ?? null, limit],
    );
    return result.rows.map(memoryFromRow);
  }

  async forget(ownerKey: string, id: string): Promise<boolean> {
    await this.ready();
    const result = await this.#pool.query(
      `UPDATE ${this.#schema}.memories
       SET status = 'deleted', deleted_at = now(), updated_at = now()
       WHERE id = $1 AND owner_key = $2 AND status = 'active'`,
      [id, ownerKey],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async indexDocument(
    ownerKey: string,
    input: DocumentInput,
  ): Promise<{ document: DocumentRecord; created: boolean }> {
    await this.ready();
    const title = input.title.trim();
    const content = input.content.trim();
    if (!title) throw new Error("Document title cannot be empty.");
    if (!content) throw new Error("Document content cannot be empty.");

    const sourceUri = input.sourceUri?.trim() || null;
    const contentHash = hashContent(content);
    const existing = sourceUri
      ? await this.#pool.query<RawDocumentRow>(
          `SELECT * FROM ${this.#schema}.documents WHERE owner_key = $1 AND source_uri = $2 LIMIT 1`,
          [ownerKey, sourceUri],
        )
      : null;
    const existingRow = existing?.rows[0];

    if (existingRow && existingRow.content_hash === contentHash) {
      return { document: documentFromRow(existingRow), created: false };
    }
    if (existingRow && !input.replaceExisting) {
      throw new Error("A document with this source URI already exists. Set replaceExisting to true.");
    }

    const chunks = chunkDocument(
      content,
      this.#config.documentChunkChars,
      this.#config.documentChunkOverlapChars,
    );
    const id = existingRow?.id ?? randomUUID();
    const tags = normalizeTags(input.tags);
    const client = await this.#pool.connect();

    try {
      await client.query("BEGIN");
      let documentRow: RawDocumentRow;
      if (existingRow) {
        await client.query(`DELETE FROM ${this.#schema}.document_chunks WHERE document_id = $1`, [id]);
        const updated = await client.query<RawDocumentRow>(
          `UPDATE ${this.#schema}.documents
           SET title = $1, mime_type = $2, tags_json = $3::jsonb, content_hash = $4,
               chunk_count = $5, updated_at = now()
           WHERE id = $6 AND owner_key = $7
           RETURNING *`,
          [title, input.mimeType?.trim() || null, JSON.stringify(tags), contentHash, chunks.length, id, ownerKey],
        );
        if (!updated.rows[0]) throw new Error("The document disappeared while it was being replaced.");
        documentRow = updated.rows[0];
      } else {
        const inserted = await client.query<RawDocumentRow>(
          `INSERT INTO ${this.#schema}.documents (
            id, owner_key, title, source_uri, mime_type, tags_json, content_hash,
            chunk_count, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now(), now())
          RETURNING *`,
          [
            id,
            ownerKey,
            title,
            sourceUri,
            input.mimeType?.trim() || null,
            JSON.stringify(tags),
            contentHash,
            chunks.length,
          ],
        );
        if (!inserted.rows[0]) throw new Error("Document insert did not return a row.");
        documentRow = inserted.rows[0];
      }

      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO ${this.#schema}.document_chunks (
            id, document_id, owner_key, chunk_index, locator, content, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, now())`,
          [randomUUID(), id, ownerKey, chunk.index, chunk.locator, chunk.content],
        );
      }
      await client.query("COMMIT");
      return { document: documentFromRow(documentRow), created: !existingRow };
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async searchDocuments(ownerKey: string, query: string, limit = 6): Promise<DocumentSearchHit[]> {
    await this.ready();
    const cleanedQuery = query.trim();
    if (!cleanedQuery) return [];
    const safeLimit = Math.trunc(clamp(limit, 6, 1, 20));
    const result = await this.#pool.query<RawDocumentSearchRow>(
      `SELECT
         c.document_id, d.title, d.source_uri, c.chunk_index, c.locator, c.content
       FROM ${this.#schema}.document_chunks c
       JOIN ${this.#schema}.documents d ON d.id = c.document_id
       WHERE c.owner_key = $1
         AND (
           to_tsvector('simple'::regconfig, coalesce(c.content, ''))
             @@ websearch_to_tsquery('simple'::regconfig, $2)
           OR c.content ILIKE '%' || $2 || '%'
           OR d.title ILIKE '%' || $2 || '%'
           OR d.tags_json::text ILIKE '%' || $2 || '%'
         )
       ORDER BY
         ts_rank_cd(
           to_tsvector('simple'::regconfig, coalesce(c.content, '')),
           websearch_to_tsquery('simple'::regconfig, $2)
         ) DESC,
         d.updated_at DESC,
         c.chunk_index ASC
       LIMIT $3`,
      [ownerKey, cleanedQuery, safeLimit],
    );

    return result.rows.map((row) => ({
      documentId: row.document_id,
      title: row.title,
      sourceUri: row.source_uri,
      chunkIndex: Number(row.chunk_index),
      locator: row.locator,
      content: row.content,
      citation: row.source_uri
        ? `${row.title} (${row.source_uri}, ${row.locator})`
        : `${row.title} (${row.locator})`,
    }));
  }

  async listDocuments(ownerKey: string, limit = 20): Promise<DocumentRecord[]> {
    await this.ready();
    const safeLimit = Math.trunc(clamp(limit, 20, 1, 100));
    const result = await this.#pool.query<RawDocumentRow>(
      `SELECT * FROM ${this.#schema}.documents
       WHERE owner_key = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [ownerKey, safeLimit],
    );
    return result.rows.map(documentFromRow);
  }

  async removeDocument(ownerKey: string, documentId: string): Promise<boolean> {
    await this.ready();
    const result = await this.#pool.query(
      `DELETE FROM ${this.#schema}.documents WHERE id = $1 AND owner_key = $2`,
      [documentId, ownerKey],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findActiveFileByLabel(ownerKey: string, label: string): Promise<StoredFileRecord | null> {
    await this.ready();
    const result = await this.#pool.query<RawStoredFileRow>(
      `SELECT * FROM ${this.#schema}.stored_files
       WHERE owner_key = $1 AND lower(label) = lower($2) AND status = 'active'
       LIMIT 1`,
      [ownerKey, label.trim()],
    );
    return result.rows[0] ? storedFileFromRow(result.rows[0]) : null;
  }

  async rememberFile(
    ownerKey: string,
    input: StoredFileInput,
  ): Promise<{ file: StoredFileRecord; replacedStorageRef: string | null }> {
    await this.ready();
    const label = input.label.trim();
    const originalName = input.originalName.trim();
    const storageRef = input.storageRef.trim();
    if (!label) throw new Error("File label cannot be empty.");
    if (!originalName) throw new Error("Original file name cannot be empty.");
    if (!storageRef) throw new Error("Stored file reference cannot be empty.");

    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<RawStoredFileRow>(
        `SELECT * FROM ${this.#schema}.stored_files
         WHERE owner_key = $1 AND lower(label) = lower($2) AND status = 'active'
         FOR UPDATE`,
        [ownerKey, label],
      );
      const existingRow = existing.rows[0];
      if (existingRow && !input.replaceExisting) {
        throw new Error(`A stored file already uses the label “${label}”. Set replaceExisting to true to replace it.`);
      }
      if (existingRow) {
        await client.query(
          `UPDATE ${this.#schema}.stored_files
           SET status = 'deleted', deleted_at = now(), updated_at = now()
           WHERE id = $1 AND owner_key = $2`,
          [existingRow.id, ownerKey],
        );
      }

      const inserted = await client.query<RawStoredFileRow>(
        `INSERT INTO ${this.#schema}.stored_files (
          id, owner_key, label, original_name, storage_ref, mime_type, file_size,
          tags_json, source_channel, source_message_id, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 'active', now(), now())
        RETURNING *`,
        [
          randomUUID(),
          ownerKey,
          label,
          originalName,
          storageRef,
          input.mimeType?.trim() || null,
          Math.max(0, Math.trunc(input.fileSize)),
          JSON.stringify(normalizeTags(input.tags)),
          input.sourceChannel?.trim() || null,
          input.sourceMessageId?.trim() || null,
        ],
      );
      if (!inserted.rows[0]) throw new Error("Stored file insert did not return a row.");
      await client.query("COMMIT");
      return {
        file: storedFileFromRow(inserted.rows[0]),
        replacedStorageRef: existingRow?.storage_ref ?? null,
      };
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getStoredFile(ownerKey: string, fileId: string): Promise<StoredFileRecord | null> {
    await this.ready();
    const result = await this.#pool.query<RawStoredFileRow>(
      `SELECT * FROM ${this.#schema}.stored_files
       WHERE owner_key = $1 AND id = $2 AND status = 'active'`,
      [ownerKey, fileId],
    );
    return result.rows[0] ? storedFileFromRow(result.rows[0]) : null;
  }

  async searchStoredFiles(ownerKey: string, query: string, limit = 10): Promise<StoredFileRecord[]> {
    await this.ready();
    const cleanedQuery = query.trim();
    if (!cleanedQuery) return this.listStoredFiles(ownerKey, limit);
    const safeLimit = Math.trunc(clamp(limit, 10, 1, 30));
    const result = await this.#pool.query<RawStoredFileRow>(
      `SELECT * FROM ${this.#schema}.stored_files
       WHERE owner_key = $1
         AND status = 'active'
         AND (
           to_tsvector('simple'::regconfig, coalesce(label, '') || ' ' || coalesce(original_name, ''))
             @@ websearch_to_tsquery('simple'::regconfig, $2)
           OR label ILIKE '%' || $2 || '%'
           OR original_name ILIKE '%' || $2 || '%'
           OR tags_json::text ILIKE '%' || $2 || '%'
         )
       ORDER BY
         ts_rank_cd(
           to_tsvector('simple'::regconfig, coalesce(label, '') || ' ' || coalesce(original_name, '')),
           websearch_to_tsquery('simple'::regconfig, $2)
         ) DESC,
         updated_at DESC
       LIMIT $3`,
      [ownerKey, cleanedQuery, safeLimit],
    );
    return result.rows.map(storedFileFromRow);
  }

  async listStoredFiles(ownerKey: string, limit = 20): Promise<StoredFileRecord[]> {
    await this.ready();
    const safeLimit = Math.trunc(clamp(limit, 20, 1, 100));
    const result = await this.#pool.query<RawStoredFileRow>(
      `SELECT * FROM ${this.#schema}.stored_files
       WHERE owner_key = $1 AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT $2`,
      [ownerKey, safeLimit],
    );
    return result.rows.map(storedFileFromRow);
  }

  async forgetStoredFile(ownerKey: string, fileId: string): Promise<StoredFileRecord | null> {
    await this.ready();
    const result = await this.#pool.query<RawStoredFileRow>(
      `UPDATE ${this.#schema}.stored_files
       SET status = 'deleted', deleted_at = now(), updated_at = now()
       WHERE id = $1 AND owner_key = $2 AND status = 'active'
       RETURNING *`,
      [fileId, ownerKey],
    );
    return result.rows[0] ? storedFileFromRow(result.rows[0]) : null;
  }

  async #rollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
  }
}
