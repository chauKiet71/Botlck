import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { chunkDocument } from "../src/chunk.js";
import { resolvePluginConfig } from "../src/config.js";
import { persistInboundFile, removeStoredFile, resolveStoredFilePath } from "../src/file-storage.js";
import { migrationStatements, quoteIdentifier } from "../src/migrations.js";
import { resolveOwnerKey } from "../src/owner.js";

test("resolves personal and shared owner scopes", () => {
  const context = {
    agentId: "main",
    sessionKey: "agent:main:telegram:42",
    requesterSenderId: "user-42",
    nativeChannelId: "telegram",
  };

  assert.equal(resolveOwnerKey(context, "agent"), "agent:main");
  assert.equal(resolveOwnerKey(context, "requester"), "requester:user-42");
  assert.equal(
    resolveOwnerKey(context, "channel-requester"),
    "channel:telegram:requester:user-42",
  );
  assert.equal(resolveOwnerKey(context, "session"), "session:agent:main:telegram:42");
});

test("chunks documents with bounded overlap", () => {
  const text = `${"Đoạn thứ nhất về PostgreSQL. ".repeat(20)}\n\n${"Đoạn thứ hai về OpenClaw. ".repeat(20)}`;
  const chunks = chunkDocument(text, 500, 50);

  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0]?.locator, "chunk:1");
  assert.ok(chunks.every((chunk) => chunk.content.length <= 500));
});

test("resolves Neon config from an environment variable", () => {
  const previous = process.env.TEST_NEON_DATABASE_URL;
  process.env.TEST_NEON_DATABASE_URL = "postgresql://user:password@example.neon.tech/neondb?sslmode=require";
  try {
    const config = resolvePluginConfig({
      databaseUrlEnv: "TEST_NEON_DATABASE_URL",
      databaseSchema: "assistant_test",
      ownerMode: "channel-requester",
      maxPoolSize: 7,
    });
    assert.equal(config.databaseUrl, process.env.TEST_NEON_DATABASE_URL);
    assert.equal(config.databaseSchema, "assistant_test");
    assert.equal(config.ownerMode, "channel-requester");
    assert.equal(config.maxPoolSize, 7);
    assert.equal(config.maxStoredFileMb, 20);
  } finally {
    if (previous === undefined) delete process.env.TEST_NEON_DATABASE_URL;
    else process.env.TEST_NEON_DATABASE_URL = previous;
  }
});

test("migration is idempotent and covers tables, columns and indexes", () => {
  const statements = migrationStatements("openclaw_assistant").join("\n");
  assert.match(statements, /CREATE SCHEMA IF NOT EXISTS "openclaw_assistant"/);
  assert.match(statements, /CREATE TABLE IF NOT EXISTS "openclaw_assistant"\.memories/);
  assert.match(statements, /CREATE TABLE IF NOT EXISTS "openclaw_assistant"\.documents/);
  assert.match(statements, /CREATE TABLE IF NOT EXISTS "openclaw_assistant"\.document_chunks/);
  assert.match(statements, /CREATE TABLE IF NOT EXISTS "openclaw_assistant"\.stored_files/);
  assert.match(statements, /ADD COLUMN IF NOT EXISTS owner_key/);
  assert.match(statements, /CREATE INDEX IF NOT EXISTS memories_search_gin/);
  assert.match(statements, /CREATE UNIQUE INDEX IF NOT EXISTS stored_files_owner_label_active/);
  assert.match(statements, /schema_migrations/);
});

test("copies inbound files into owner-scoped persistent storage without parsing them", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "assistant-file-test-"));
  try {
    const inboundDirectory = join(workspace, "media", "inbound");
    await mkdir(inboundDirectory, { recursive: true });
    const bytes = Buffer.from("%PDF-1.7\nopaque-test-content", "utf8");
    await writeFile(join(inboundDirectory, "upload.pdf"), bytes);

    const persisted = await persistInboundFile({
      workspaceDir: workspace,
      ownerKey: "agent:main",
      fileRef: "media://inbound/upload.pdf",
      originalName: "CV của tôi.pdf",
      maxBytes: 1024,
    });

    assert.equal(persisted.originalName, "CV của tôi.pdf");
    assert.equal(persisted.mimeType, "application/pdf");
    assert.deepEqual(await readFile(persisted.deliveryPath), bytes);
    assert.equal(resolveStoredFilePath(workspace, persisted.storageRef), persisted.deliveryPath);
    assert.equal(await removeStoredFile(workspace, persisted.storageRef), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rejects file references outside the inbound media directory", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "assistant-file-test-"));
  try {
    await assert.rejects(() =>
      persistInboundFile({
        workspaceDir: workspace,
        ownerKey: "agent:main",
        fileRef: "../secret.txt",
        maxBytes: 1024,
      }),
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("resolves canonical inbound media from the OpenClaw state directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "assistant-file-test-"));
  const workspace = join(root, "workspace");
  const stateDir = join(root, ".openclaw");
  try {
    const inboundDirectory = join(stateDir, "media", "inbound");
    await mkdir(inboundDirectory, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(inboundDirectory, "telegram-upload.pdf"), "opaque");

    const persisted = await persistInboundFile({
      workspaceDir: workspace,
      stateDir,
      ownerKey: "agent:main",
      fileRef: "media://inbound/telegram-upload.pdf",
      maxBytes: 1024,
    });
    assert.equal((await readFile(persisted.deliveryPath, "utf8")), "opaque");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsafe PostgreSQL schema identifiers", () => {
  assert.equal(quoteIdentifier("openclaw_assistant"), '"openclaw_assistant"');
  assert.throws(() => quoteIdentifier("public; DROP SCHEMA public"));
  assert.throws(() => resolvePluginConfig({ databaseSchema: "bad-name" }));
});
