# OpenClaw Personal Assistant Memory

An OpenClaw native plugin that adds structured, owner-scoped long-term memory and document retrieval backed by Neon PostgreSQL.

## What the MVP includes

- Durable memory with categories, source, timestamps, importance, sensitivity, and confidence.
- Deduplication, conflict replacement (`supersedesId`), and soft deletion.
- Owner isolation using the agent, requester, channel/requester pair, or session.
- Document chunking and PostgreSQL full-text retrieval with citations.
- Neon PostgreSQL persistence shared safely by multiple OpenClaw Gateway processes.
- Automatic, idempotent database migrations for missing schemas, tables, columns, and indexes.
- Workspace instructions that teach the agent when to remember, recall, cite, and request confirmation.

This plugin complements OpenClaw's built-in `memory-core`. The built-in memory remains useful for curated Markdown notes and semantic search; this plugin is the system of record for structured memories and indexed document text.

## Requirements

- OpenClaw `2026.6.9` (pinned to match the target runtime because the plugin API is experimental).
- Node.js `>=22.19.0`.
- npm or pnpm.

## Develop and test

```powershell
npm install
npm test
npm run plugin:validate
```

Unit tests do not require a live Neon database. For one PowerShell session, configure the Neon connection string with:

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@YOUR-ENDPOINT-pooler.REGION.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
```

When the Gateway runs as a Windows Scheduled Task, persist the same value in OpenClaw's private runtime environment file instead:

```text
C:\Users\DELL\.openclaw\.env
```

The file must contain one line (replace the placeholder with the pooled connection string copied from Neon Console):

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@YOUR-ENDPOINT-pooler.REGION.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Restart the Gateway after saving the file:

```powershell
openclaw gateway restart
openclaw gateway status
```

Do not put a real connection string in `openclaw.json5`, this repository, or chat messages. The `.env` file is loaded by the Gateway process and is not part of the plugin package.

## Install into OpenClaw

Build, then link the local plugin:

```powershell
npm run build
openclaw plugins install -l D:\Code\Bot_agent_LCK
openclaw plugins enable personal-assistant-memory
openclaw plugins inspect personal-assistant-memory
```

Copy the workspace templates into your OpenClaw workspace. Review existing files before replacing them:

```powershell
Copy-Item .\workspace\AGENTS.md "$env:USERPROFILE\.openclaw\workspace\AGENTS.md"
Copy-Item .\workspace\SOUL.md "$env:USERPROFILE\.openclaw\workspace\SOUL.md"
Copy-Item .\workspace\USER.md "$env:USERPROFILE\.openclaw\workspace\USER.md"
Copy-Item .\workspace\MEMORY.md "$env:USERPROFILE\.openclaw\workspace\MEMORY.md"
```

Merge the relevant parts of `examples/openclaw.json5` into your OpenClaw config, then restart the Gateway.

On the first database operation, the plugin automatically:

1. Connects using the environment variable configured by `databaseUrlEnv`.
2. Acquires a PostgreSQL transaction-scoped advisory lock so concurrent Gateway instances cannot race migrations.
3. Creates the `openclaw_assistant` schema if it is missing.
4. Creates missing tables and adds missing columns with `IF NOT EXISTS`.
5. Creates uniqueness, owner lookup, and full-text GIN indexes.
6. Records the migration in `schema_migrations`.

The Neon database role must have permission to create the configured schema, tables, and indexes.

## Tool behavior

| Tool | Purpose |
| --- | --- |
| `assistant_remember` | Save one durable fact or event |
| `assistant_recall` | Search active structured memories |
| `assistant_list_memories` | Let the user review stored memory |
| `assistant_forget` | Soft-delete a confirmed memory |
| `assistant_index_document` | Chunk and index previously extracted text |
| `assistant_search_documents` | Retrieve evidence with citations |
| `assistant_list_documents` | Review indexed documents and their IDs |
| `assistant_remove_document` | Permanently remove a confirmed document index |

## Owner isolation

`ownerMode: "agent"` lets one personal agent share its memory across all channels. Do not use this setting on a gateway shared by unrelated people.

For a shared but trusted gateway, use `channel-requester`. For mutually untrusted tenants, run separate gateways and credentials or put an authenticated multi-tenant service in front of a production database.

## Current document boundary

The MVP indexes extracted text, not binary PDF/DOCX files directly. OpenClaw or another extractor must first produce the text. A later production phase should add:

1. An upload API and object storage for original files.
2. PDF/DOCX/OCR extraction workers.
3. Embeddings and reranking in addition to FTS5.
4. Page/section locators rather than generic chunk locators.
5. pgvector embeddings and reranking in addition to PostgreSQL full-text search.

## Security baseline

- Start with `sandbox.mode: "all"` and no agent workspace mount.
- Give the agent only the tools it needs.
- Require explicit confirmation before deleting memory/documents or performing external actions.
- Never store passwords, API keys, payment-card data, or one-time codes as memory.
- Rotate the Neon role password if a connection string is exposed, and use a dedicated least-privilege database role in production.
