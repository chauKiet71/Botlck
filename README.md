# OpenClaw Personal Assistant Memory

An OpenClaw native plugin that adds structured, owner-scoped long-term memory and document retrieval backed by Neon PostgreSQL.

## What the MVP includes

- Durable memory with categories, source, timestamps, importance, sensitivity, and confidence.
- Deduplication, conflict replacement (`supersedesId`), and soft deletion.
- Owner isolation using the agent, requester, channel/requester pair, or session.
- Document chunking and PostgreSQL full-text retrieval with citations.
- Labeled attachment storage without reading or extracting the file contents.
- File metadata search in Neon and persistent file copies on the OpenClaw workspace volume.
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

## Deploy to Railway

The repository includes a production `Dockerfile`, an idempotent startup script, and `railway.json`.
The first container start on an empty volume onboards OpenClaw, copies missing workspace files, links and enables this plugin, and configures Telegram when its token is present. Existing state and workspace files are preserved.

In Railway:

1. Deploy this GitHub repository as one service with one replica.
2. Attach a persistent volume at `/data`.
3. Enable Public Networking with target port `8080`.
4. Configure these service variables (seal all secret values):

```dotenv
OPENCLAW_GATEWAY_PORT=8080
OPENCLAW_STATE_DIR=/data/.openclaw
OPENCLAW_WORKSPACE_DIR=/data/workspace
OPENCLAW_GATEWAY_TOKEN=<random-admin-secret>
NINE_ROUTER_API_KEY=<9router-api-key>
NINE_ROUTER_BASE_URL=http://9router.railway.internal:20128/v1
NINE_ROUTER_MODELS=openclaw
OPENCLAW_PRIMARY_MODEL=9router/openclaw
OPENROUTER_API_KEY=<openrouter-api-key>
OPENCLAW_FALLBACK_MODELS=openrouter/google/gemini-3-flash
OPENCLAW_ALLOWED_MODELS=9router/*,openrouter/*
OPENCLAW_MODEL_ALIASES=router=9router/openclaw,fast=openrouter/google/gemini-3-flash
DATABASE_URL=<neon-pooled-connection-string>
TELEGRAM_BOT_TOKEN=<telegram-bot-token>
RAILWAY_RUN_UID=0
```

`TELEGRAM_BOT_TOKEN` is optional for Gateway startup; omit it only when Telegram should remain disabled. `RAILWAY_RUN_UID=0` lets the process initialize a newly attached Railway volume, whose mount is owned by root.
Set at least one model credential: `NINE_ROUTER_API_KEY`, `OPENROUTER_API_KEY`, or `OPENAI_API_KEY`. When using 9Router, set `NINE_ROUTER_BASE_URL` as well; services in the same Railway project should use the private URL shown above. `NINE_ROUTER_MODELS` is an optional comma-separated list of 9Router combo/model IDs and defaults to `openclaw`. Model references must use the provider-qualified `provider/model` format.

- `OPENCLAW_PRIMARY_MODEL` sets the default model. It defaults to `openrouter/deepseek/deepseek-v4-flash-0731` with OpenRouter, or `openai/gpt-5.5` with OpenAI.
- `OPENCLAW_FALLBACK_MODELS` is an optional, ordered comma-separated fallback chain.
- `OPENCLAW_ALLOWED_MODELS` controls which models appear in the picker. It accepts exact models and provider wildcards such as `openrouter/*`. When omitted, every authenticated provider is added as a wildcard automatically.
- `OPENCLAW_MODEL_ALIASES` is an optional comma-separated list in `alias=provider/model` format. Each model can have one alias.

The container validates these variables on startup and applies them on every deploy. After it is running, send `/model` or `/model list` in Telegram (or use the Control UI picker) to select an allowed model for the current session without restarting. Send `/model default` to return that session to `OPENCLAW_PRIMARY_MODEL`; use `/model status` to inspect the active selection.

The health check is `/startupz`. After deployment, open `https://<railway-domain>/openclaw`, enter `OPENCLAW_GATEWAY_TOKEN`, then run these read-only checks in the Railway shell:

```bash
openclaw doctor --json
openclaw plugins inspect personal-assistant-memory --runtime
openclaw channels status
```

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
| `assistant_remember_file` | Copy an inbound attachment to persistent storage and save its label |
| `assistant_find_files` | Search file metadata without reading file contents |
| `assistant_get_file` | Resolve one stored file so the message tool can send it back |
| `assistant_list_files` | Review active remembered files and their IDs |
| `assistant_forget_file` | Remove a confirmed file record and its persistent copy |

## Owner isolation

`ownerMode: "agent"` lets one personal agent share its memory across all channels. Do not use this setting on a gateway shared by unrelated people.

For a shared but trusted gateway, use `channel-requester`. For mutually untrusted tenants, run separate gateways and credentials or put an authenticated multi-tenant service in front of a production database.

## Labeled file workflow

When a user sends a Telegram attachment with a caption such as `đây là CV của tôi`, OpenClaw stages the inbound file under the active workspace. The plugin copies those bytes—without parsing them—to:

```text
/data/workspace/.assistant-files/<owner-hash>/<generated-id>.pdf
```

Neon stores only the owner-scoped label, original filename, MIME type, size, tags, source channel, and managed storage reference in `openclaw_assistant.stored_files`. The Railway volume at `/data` must remain attached; deleting or replacing that volume removes the stored file bytes even though Neon metadata may remain.

When the user later asks for the file, the agent searches metadata, resolves the managed path, and passes that path to OpenClaw's `message` tool for Telegram delivery. `maxStoredFileMb` defaults to 20 MB and can be set from 1–25 MB in the plugin config.

## Current document boundary

The document index still requires extracted text. Labeled attachment storage is separate and intentionally does not inspect file contents. A later production phase may add:

1. S3-compatible object storage when files need to survive outside one Railway volume.
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
