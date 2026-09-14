import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import { requireDatabaseUrl, resolvePluginConfig, type PluginConfig } from "./src/config.js";
import {
  persistInboundFile,
  removeStoredFile,
  resolveStoredFilePath,
} from "./src/file-storage.js";
import { resolveOwnerKey } from "./src/owner.js";
import { AssistantStore } from "./src/store.js";
import {
  MEMORY_KINDS,
  type DocumentInput,
  type MemoryInput,
  type MemoryKind,
  type StoredFileInput,
} from "./src/types.js";

const MemoryKindSchema = Type.Union(MEMORY_KINDS.map((kind) => Type.Literal(kind)));
const OptionalTags = Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 30 }));

const ConfigSchema = Type.Object(
  {
    databaseUrlEnv: Type.Optional(
      Type.String({
        default: "DATABASE_URL",
        description: "Environment variable containing the Neon PostgreSQL connection string.",
      }),
    ),
    databaseSchema: Type.Optional(
      Type.String({
        default: "openclaw_assistant",
        pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$",
        description: "PostgreSQL schema automatically managed by this plugin.",
      }),
    ),
    ownerMode: Type.Optional(
      Type.Union(
        [Type.Literal("agent"), Type.Literal("requester"), Type.Literal("channel-requester"), Type.Literal("session")],
        {
          default: "agent",
          description: "Use agent for one personal owner; use channel-requester for a shared gateway.",
        },
      ),
    ),
    maxPoolSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 4 })),
    connectionTimeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 60000, default: 10000 })),
    maxRecallResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 8 })),
    documentChunkChars: Type.Optional(Type.Integer({ minimum: 500, maximum: 6000, default: 1600 })),
    documentChunkOverlapChars: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000, default: 200 })),
    maxStoredFileMb: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 25,
        default: 20,
        description: "Maximum size of one remembered file copied to the persistent workspace.",
      }),
    ),
  },
  { additionalProperties: false },
);

const RememberParameters = Type.Object(
  {
    kind: MemoryKindSchema,
    subject: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    content: Type.String({ minLength: 1, maxLength: 5000 }),
    tags: OptionalTags,
    source: Type.Optional(Type.String({ maxLength: 120 })),
    sourceRef: Type.Optional(Type.String({ maxLength: 500 })),
    occurredAt: Type.Optional(Type.String({ maxLength: 80 })),
    importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
    sensitivity: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("sensitive")])),
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    supersedesId: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  },
  { additionalProperties: false },
);

const RecallParameters = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 500 }),
    kind: Type.Optional(MemoryKindSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
  },
  { additionalProperties: false },
);

const ListMemoryParameters = Type.Object(
  {
    kind: Type.Optional(MemoryKindSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

const ForgetParameters = Type.Object(
  {
    memoryId: Type.String({ minLength: 1, maxLength: 80 }),
    confirmed: Type.Literal(true, { description: "Must be true only after explicit user confirmation." }),
  },
  { additionalProperties: false },
);

const IndexDocumentParameters = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 300 }),
    content: Type.String({ minLength: 1, maxLength: 500000 }),
    sourceUri: Type.Optional(Type.String({ maxLength: 2000 })),
    mimeType: Type.Optional(Type.String({ maxLength: 120 })),
    tags: OptionalTags,
    replaceExisting: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const SearchDocumentParameters = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 500 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  },
  { additionalProperties: false },
);

const ListDocumentParameters = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

const RemoveDocumentParameters = Type.Object(
  {
    documentId: Type.String({ minLength: 1, maxLength: 80 }),
    confirmed: Type.Literal(true, { description: "Must be true only after explicit user confirmation." }),
  },
  { additionalProperties: false },
);

const RememberFileParameters = Type.Object(
  {
    label: Type.String({
      minLength: 1,
      maxLength: 300,
      description: "Human description used to find the file later, for example: CV của tôi.",
    }),
    fileRef: Type.String({
      minLength: 1,
      maxLength: 2000,
      description:
        "The media://inbound/... or media/inbound/... reference shown for the attachment in the current message. Do not read or extract the file.",
    }),
    originalName: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    mimeType: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    tags: OptionalTags,
    replaceExisting: Type.Optional(
      Type.Boolean({ description: "Replace the active file with the same label after the user requests it." }),
    ),
  },
  { additionalProperties: false },
);

const FindFileParameters = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 500 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
  },
  { additionalProperties: false },
);

const GetFileParameters = Type.Object(
  { fileId: Type.String({ minLength: 1, maxLength: 80 }) },
  { additionalProperties: false },
);

const ListFileParameters = Type.Object(
  { limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) },
  { additionalProperties: false },
);

const ForgetFileParameters = Type.Object(
  {
    fileId: Type.String({ minLength: 1, maxLength: 80 }),
    confirmed: Type.Literal(true, { description: "Must be true only after explicit user confirmation." }),
  },
  { additionalProperties: false },
);

const stores = new Map<string, AssistantStore>();

function storeFor(config: PluginConfig): AssistantStore {
  const databaseUrl = requireDatabaseUrl(config);
  const key = `${config.databaseSchema}\u0000${databaseUrl}`;
  const existing = stores.get(key);
  if (existing) return existing;
  const store = new AssistantStore(config);
  stores.set(key, store);
  return store;
}

function success(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export default defineToolPlugin({
  id: "personal-assistant-memory",
  name: "Personal Assistant Memory",
  description: "Structured long-term memory and local document retrieval for OpenClaw.",
  configSchema: ConfigSchema,
  tools: (tool) => [
    tool({
      name: "assistant_remember",
      label: "Ghi nhớ thông tin",
      description:
        "Save one durable fact, preference, decision, event, commitment, person, project, or note. Use only for information worth remembering across sessions. If it replaces an old fact, pass supersedesId.",
      parameters: RememberParameters,
      factory({ config: rawConfig, toolContext, api }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_remember",
          label: "Ghi nhớ thông tin",
          description:
            "Save one durable fact, preference, decision, event, commitment, person, project, or note. Use only for information worth remembering across sessions. If it replaces an old fact, pass supersedesId.",
          parameters: RememberParameters,
          executionMode: "sequential",
          async execute(_id, params) {
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const result = await store.remember(ownerKey, params as MemoryInput);
            api.logger.debug?.(`assistant_remember owner=${ownerKey} created=${result.created}`);
            return success(
              result.created ? `Đã ghi nhớ: ${result.memory.content}` : "Thông tin này đã được ghi nhớ trước đó.",
              { created: result.created, memory: result.memory },
            );
          },
        };
      },
    }),
    tool({
      name: "assistant_recall",
      label: "Tìm trong trí nhớ",
      description:
        "Search durable structured memories belonging to the current owner. Call this before answering questions about the user's people, preferences, projects, decisions, events, or commitments.",
      parameters: RecallParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_recall",
          label: "Tìm trong trí nhớ",
          description:
            "Search durable structured memories belonging to the current owner. Call this before answering questions about the user's people, preferences, projects, decisions, events, or commitments.",
          parameters: RecallParameters,
          executionMode: "parallel",
          async execute(_id, params) {
            const input = params as { query: string; kind?: MemoryKind; limit?: number };
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const memories = await store.searchMemories(ownerKey, input.query, {
              ...(input.kind ? { kind: input.kind } : {}),
              limit: input.limit ?? config.maxRecallResults,
            });
            return success(
              memories.length
                ? `Tìm thấy ${memories.length} thông tin liên quan.`
                : "Không tìm thấy thông tin đã ghi nhớ phù hợp.",
              { memories },
            );
          },
        };
      },
    }),
    tool({
      name: "assistant_list_memories",
      label: "Liệt kê trí nhớ",
      description: "List active memories for the current owner so they can review what the assistant remembers.",
      parameters: ListMemoryParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_list_memories",
          label: "Liệt kê trí nhớ",
          description: "List active memories for the current owner so they can review what the assistant remembers.",
          parameters: ListMemoryParameters,
          executionMode: "parallel",
          async execute(_id, params) {
            const input = params as { kind?: MemoryKind; limit?: number };
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const memories = await store.listMemories(ownerKey, {
              ...(input.kind ? { kind: input.kind } : {}),
              limit: input.limit ?? 20,
            });
            return success(`Có ${memories.length} thông tin đang được ghi nhớ.`, { memories });
          },
        };
      },
    }),
    tool({
      name: "assistant_forget",
      label: "Quên một thông tin",
      description:
        "Soft-delete one memory by ID. Call only after the user explicitly asks to forget/delete that specific memory and confirms the displayed memory ID.",
      parameters: ForgetParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_forget",
          label: "Quên một thông tin",
          description:
            "Soft-delete one memory by ID. Call only after the user explicitly asks to forget/delete that specific memory and confirms the displayed memory ID.",
          parameters: ForgetParameters,
          executionMode: "sequential",
          async execute(_id, params) {
            const input = params as { memoryId: string; confirmed: true };
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const forgotten = await store.forget(ownerKey, input.memoryId);
            return success(
              forgotten ? "Đã quên thông tin được yêu cầu." : "Không tìm thấy memory đang hoạt động với ID này.",
              { forgotten, memoryId: input.memoryId },
            );
          },
        };
      },
    }),
    tool({
      name: "assistant_index_document",
      label: "Lập chỉ mục tài liệu",
      description:
        "Index extracted text from a document into the owner's local knowledge base. The content should already be extracted from PDF, Word, email, or text before calling this tool.",
      parameters: IndexDocumentParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_index_document",
          label: "Lập chỉ mục tài liệu",
          description:
            "Index extracted text from a document into the owner's local knowledge base. The content should already be extracted from PDF, Word, email, or text before calling this tool.",
          parameters: IndexDocumentParameters,
          executionMode: "sequential",
          async execute(_id, params) {
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const result = await store.indexDocument(ownerKey, params as DocumentInput);
            return success(
              result.created
                ? `Đã lập chỉ mục tài liệu “${result.document.title}” với ${result.document.chunkCount} đoạn.`
                : `Tài liệu “${result.document.title}” đã có trong kho và không thay đổi.`,
              result,
            );
          },
        };
      },
    }),
    tool({
      name: "assistant_search_documents",
      label: "Tìm trong tài liệu",
      description:
        "Search indexed documents for evidence. Use returned citation values in the answer and say when the documents do not contain enough evidence.",
      parameters: SearchDocumentParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_search_documents",
          label: "Tìm trong tài liệu",
          description:
            "Search indexed documents for evidence. Use returned citation values in the answer and say when the documents do not contain enough evidence.",
          parameters: SearchDocumentParameters,
          executionMode: "parallel",
          async execute(_id, params) {
            const input = params as { query: string; limit?: number };
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const results = await store.searchDocuments(ownerKey, input.query, input.limit ?? 6);
            return success(
              results.length
                ? `Tìm thấy ${results.length} đoạn tài liệu liên quan.`
                : "Không tìm thấy bằng chứng phù hợp trong kho tài liệu.",
              { results },
            );
          },
        };
      },
    }),
    tool({
      name: "assistant_list_documents",
      label: "Liệt kê tài liệu",
      description: "List documents indexed for the current owner, including IDs needed for review or removal.",
      parameters: ListDocumentParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_list_documents",
          label: "Liệt kê tài liệu",
          description: "List documents indexed for the current owner, including IDs needed for review or removal.",
          parameters: ListDocumentParameters,
          executionMode: "parallel",
          async execute(_id, params) {
            const input = params as { limit?: number };
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const documents = await store.listDocuments(ownerKey, input.limit ?? 20);
            return success(`Có ${documents.length} tài liệu trong chỉ mục.`, { documents });
          },
        };
      },
    }),
    tool({
      name: "assistant_remove_document",
      label: "Xóa tài liệu khỏi chỉ mục",
      description:
        "Permanently remove one indexed document and all of its chunks. Call only after explicit user confirmation of the document ID.",
      parameters: RemoveDocumentParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_remove_document",
          label: "Xóa tài liệu khỏi chỉ mục",
          description:
            "Permanently remove one indexed document and all of its chunks. Call only after explicit user confirmation of the document ID.",
          parameters: RemoveDocumentParameters,
          executionMode: "sequential",
          async execute(_id, params) {
            const input = params as { documentId: string; confirmed: true };
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const removed = await store.removeDocument(ownerKey, input.documentId);
            return success(removed ? "Đã xóa tài liệu khỏi chỉ mục." : "Không tìm thấy tài liệu với ID này.", {
              removed,
              documentId: input.documentId,
            });
          },
        };
      },
    }),
    tool({
      name: "assistant_remember_file",
      label: "Ghi nhớ tệp theo nhãn",
      description:
        "Remember an attachment without reading or extracting its contents. Use when the user sends a file with a label such as 'đây là CV của tôi'. Pass the current attachment's media reference exactly as fileRef.",
      parameters: RememberFileParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_remember_file",
          label: "Ghi nhớ tệp theo nhãn",
          description:
            "Remember an attachment without reading or extracting its contents. Use when the user sends a file with a label such as 'đây là CV của tôi'. Pass the current attachment's media reference exactly as fileRef.",
          parameters: RememberFileParameters,
          executionMode: "sequential",
          async execute(_id, params) {
            const input = params as {
              label: string;
              fileRef: string;
              originalName?: string;
              mimeType?: string;
              tags?: string[];
              replaceExisting?: boolean;
            };
            const workspaceDir = toolContext.workspaceDir;
            if (!workspaceDir) throw new Error("The active OpenClaw workspace directory is unavailable.");
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const existing = await store.findActiveFileByLabel(ownerKey, input.label);
            if (existing && !input.replaceExisting) {
              throw new Error(
                `Đã có tệp mang nhãn “${input.label.trim()}” (ID: ${existing.id}). Hãy hỏi người dùng trước khi thay thế, rồi gọi lại với replaceExisting=true.`,
              );
            }

            const persisted = await persistInboundFile({
              workspaceDir,
              ...(process.env.OPENCLAW_STATE_DIR?.trim()
                ? { stateDir: process.env.OPENCLAW_STATE_DIR.trim() }
                : {}),
              ownerKey,
              fileRef: input.fileRef,
              ...(input.originalName ? { originalName: input.originalName } : {}),
              ...(input.mimeType ? { mimeType: input.mimeType } : {}),
              maxBytes: config.maxStoredFileMb * 1024 * 1024,
            });
            try {
              const stored = await store.rememberFile(ownerKey, {
                label: input.label,
                originalName: persisted.originalName,
                storageRef: persisted.storageRef,
                ...(persisted.mimeType ? { mimeType: persisted.mimeType } : {}),
                fileSize: persisted.fileSize,
                ...(input.tags ? { tags: input.tags } : {}),
                ...(toolContext.messageChannel ? { sourceChannel: toolContext.messageChannel } : {}),
                ...(input.replaceExisting !== undefined ? { replaceExisting: input.replaceExisting } : {}),
              } satisfies StoredFileInput);
              if (stored.replacedStorageRef) {
                await removeStoredFile(workspaceDir, stored.replacedStorageRef).catch(() => false);
              }
              return success(
                `Đã ghi nhớ tệp “${stored.file.label}” mà không đọc nội dung.`,
                { file: stored.file, replaced: Boolean(stored.replacedStorageRef) },
              );
            } catch (error) {
              await removeStoredFile(workspaceDir, persisted.storageRef).catch(() => false);
              throw error;
            }
          },
        };
      },
    }),
    tool({
      name: "assistant_find_files",
      label: "Tìm tệp đã ghi nhớ",
      description:
        "Search remembered file metadata by label, original filename, or tags. This does not read file contents. Use before answering a request for a previously stored file.",
      parameters: FindFileParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_find_files",
          label: "Tìm tệp đã ghi nhớ",
          description:
            "Search remembered file metadata by label, original filename, or tags. This does not read file contents. Use before answering a request for a previously stored file.",
          parameters: FindFileParameters,
          executionMode: "parallel",
          async execute(_id, params) {
            const input = params as { query: string; limit?: number };
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const files = await store.searchStoredFiles(ownerKey, input.query, input.limit ?? 10);
            return success(
              files.length ? `Tìm thấy ${files.length} tệp phù hợp.` : "Không tìm thấy tệp đã ghi nhớ phù hợp.",
              { files },
            );
          },
        };
      },
    }),
    tool({
      name: "assistant_get_file",
      label: "Lấy tệp để gửi lại",
      description:
        "Get the delivery path for one remembered file by ID without reading it. After this succeeds, send deliveryPath to the user with the message tool's media/path field; do not merely print the path.",
      parameters: GetFileParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_get_file",
          label: "Lấy tệp để gửi lại",
          description:
            "Get the delivery path for one remembered file by ID without reading it. After this succeeds, send deliveryPath to the user with the message tool's media/path field; do not merely print the path.",
          parameters: GetFileParameters,
          executionMode: "parallel",
          async execute(_id, params) {
            const input = params as { fileId: string };
            const workspaceDir = toolContext.workspaceDir;
            if (!workspaceDir) throw new Error("The active OpenClaw workspace directory is unavailable.");
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const file = await store.getStoredFile(ownerKey, input.fileId);
            if (!file) return success("Không tìm thấy tệp đang hoạt động với ID này.", { file: null });
            const deliveryPath = resolveStoredFilePath(workspaceDir, file.storageRef);
            return success(
              `Đã lấy tệp “${file.label}”. Hãy gửi tệp bằng message tool với media/path là: ${deliveryPath}`,
              { file, deliveryPath },
            );
          },
        };
      },
    }),
    tool({
      name: "assistant_list_files",
      label: "Liệt kê tệp đã ghi nhớ",
      description: "List active remembered files and their IDs without reading file contents.",
      parameters: ListFileParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_list_files",
          label: "Liệt kê tệp đã ghi nhớ",
          description: "List active remembered files and their IDs without reading file contents.",
          parameters: ListFileParameters,
          executionMode: "parallel",
          async execute(_id, params) {
            const input = params as { limit?: number };
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const files = await store.listStoredFiles(ownerKey, input.limit ?? 20);
            return success(`Có ${files.length} tệp đang được ghi nhớ.`, { files });
          },
        };
      },
    }),
    tool({
      name: "assistant_forget_file",
      label: "Xóa tệp đã ghi nhớ",
      description:
        "Delete one remembered file's metadata and persistent copy. Call only after showing its ID and receiving explicit user confirmation.",
      parameters: ForgetFileParameters,
      factory({ config: rawConfig, toolContext }) {
        const config = resolvePluginConfig(rawConfig);
        const store = storeFor(config);
        return {
          name: "assistant_forget_file",
          label: "Xóa tệp đã ghi nhớ",
          description:
            "Delete one remembered file's metadata and persistent copy. Call only after showing its ID and receiving explicit user confirmation.",
          parameters: ForgetFileParameters,
          executionMode: "sequential",
          async execute(_id, params) {
            const input = params as { fileId: string; confirmed: true };
            const workspaceDir = toolContext.workspaceDir;
            if (!workspaceDir) throw new Error("The active OpenClaw workspace directory is unavailable.");
            const ownerKey = resolveOwnerKey(toolContext, config.ownerMode);
            const file = await store.forgetStoredFile(ownerKey, input.fileId);
            if (!file) return success("Không tìm thấy tệp đang hoạt động với ID này.", { forgotten: false });
            const removedCopy = await removeStoredFile(workspaceDir, file.storageRef).catch(() => false);
            return success(
              removedCopy
                ? `Đã quên tệp “${file.label}” và xóa bản lưu.`
                : `Đã xóa metadata của tệp “${file.label}”; bản lưu vật lý không tồn tại hoặc không thể dọn dẹp.`,
              {
              forgotten: true,
              removedCopy,
              fileId: input.fileId,
              },
            );
          },
        };
      },
    }),
  ],
});
