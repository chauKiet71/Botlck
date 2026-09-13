import assert from "node:assert/strict";
import test from "node:test";

import { chunkDocument } from "../src/chunk.js";
import { resolvePluginConfig } from "../src/config.js";
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
  assert.match(statements, /ADD COLUMN IF NOT EXISTS owner_key/);
  assert.match(statements, /CREATE INDEX IF NOT EXISTS memories_search_gin/);
  assert.match(statements, /schema_migrations/);
});

test("rejects unsafe PostgreSQL schema identifiers", () => {
  assert.equal(quoteIdentifier("openclaw_assistant"), '"openclaw_assistant"');
  assert.throws(() => quoteIdentifier("public; DROP SCHEMA public"));
  assert.throws(() => resolvePluginConfig({ databaseSchema: "bad-name" }));
});
