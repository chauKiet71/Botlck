import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { resolvePluginConfig } from "../src/config.js";
import { quoteIdentifier } from "../src/migrations.js";
import { AssistantStore } from "../src/store.js";

const testDatabaseUrl = process.env.TEST_NEON_DATABASE_URL?.trim();

test(
  "runs migrations and memory/document operations against Neon",
  { skip: testDatabaseUrl ? false : "Set TEST_NEON_DATABASE_URL to run the Neon integration test." },
  async () => {
    const schema = `assistant_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    process.env.OPENCLAW_TEST_DATABASE_URL = testDatabaseUrl!;
    const config = resolvePluginConfig({
      databaseUrlEnv: "OPENCLAW_TEST_DATABASE_URL",
      databaseSchema: schema,
      ownerMode: "agent",
      maxPoolSize: 2,
      documentChunkChars: 500,
      documentChunkOverlapChars: 50,
    });
    const store = new AssistantStore(config);

    try {
      await store.ready();

      const original = await store.remember("agent:main", {
        kind: "preference",
        subject: "Backend",
        content: "Tôi ưu tiên PostgreSQL cho dịch vụ backend.",
        tags: ["postgresql", "backend"],
      });
      assert.equal(original.created, true);

      const duplicate = await store.remember("agent:main", {
        kind: "preference",
        subject: "Backend",
        content: "Tôi ưu tiên PostgreSQL cho dịch vụ backend.",
      });
      assert.equal(duplicate.created, false);
      assert.equal(duplicate.memory.id, original.memory.id);
      assert.equal((await store.searchMemories("agent:main", "PostgreSQL backend")).length, 1);
      assert.equal((await store.searchMemories("agent:other", "PostgreSQL")).length, 0);

      const replacement = await store.remember("agent:main", {
        kind: "preference",
        subject: "Backend",
        content: "Tôi ưu tiên Neon PostgreSQL cho dịch vụ backend.",
        supersedesId: original.memory.id,
      });
      assert.equal((await store.getMemory("agent:main", original.memory.id))?.status, "superseded");
      assert.equal((await store.listMemories("agent:main")).length, 1);
      assert.equal(await store.forget("agent:main", replacement.memory.id), true);

      const indexed = await store.indexDocument("agent:main", {
        title: "Quyết định dự án Phoenix",
        sourceUri: "file:///phoenix.md",
        content: "Dự án Phoenix dùng Neon PostgreSQL. Mốc phát hành dự kiến là ngày 30 tháng 9.",
      });
      assert.equal(indexed.created, true);
      assert.ok((await store.searchDocuments("agent:main", "Neon PostgreSQL")).length >= 1);
      assert.equal((await store.listDocuments("agent:main")).length, 1);
      assert.equal(await store.removeDocument("agent:main", indexed.document.id), true);
    } finally {
      await store.close();
      const cleanupPool = new Pool({ connectionString: testDatabaseUrl! });
      try {
        await cleanupPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      } finally {
        await cleanupPool.end();
        delete process.env.OPENCLAW_TEST_DATABASE_URL;
      }
    }
  },
);
