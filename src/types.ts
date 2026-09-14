export const MEMORY_KINDS = [
  "profile",
  "preference",
  "person",
  "project",
  "decision",
  "event",
  "commitment",
  "note",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type Sensitivity = "normal" | "sensitive";

export interface MemoryInput {
  kind: MemoryKind;
  subject?: string;
  content: string;
  tags?: string[];
  source?: string;
  sourceRef?: string;
  occurredAt?: string;
  importance?: number;
  sensitivity?: Sensitivity;
  confidence?: number;
  supersedesId?: string;
}

export interface MemoryRecord {
  id: string;
  ownerKey: string;
  kind: MemoryKind;
  subject: string | null;
  content: string;
  tags: string[];
  source: string | null;
  sourceRef: string | null;
  occurredAt: string | null;
  importance: number;
  sensitivity: Sensitivity;
  confidence: number;
  status: "active" | "superseded" | "deleted";
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentInput {
  title: string;
  content: string;
  sourceUri?: string;
  mimeType?: string;
  tags?: string[];
  replaceExisting?: boolean;
}

export interface DocumentRecord {
  id: string;
  ownerKey: string;
  title: string;
  sourceUri: string | null;
  mimeType: string | null;
  tags: string[];
  contentHash: string;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSearchHit {
  documentId: string;
  title: string;
  sourceUri: string | null;
  chunkIndex: number;
  locator: string;
  content: string;
  citation: string;
}

export interface StoredFileInput {
  label: string;
  originalName: string;
  storageRef: string;
  mimeType?: string;
  fileSize: number;
  tags?: string[];
  sourceChannel?: string;
  sourceMessageId?: string;
  replaceExisting?: boolean;
}

export interface StoredFileRecord {
  id: string;
  ownerKey: string;
  label: string;
  originalName: string;
  storageRef: string;
  mimeType: string | null;
  fileSize: number;
  tags: string[];
  sourceChannel: string | null;
  sourceMessageId: string | null;
  status: "active" | "deleted";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface StoredFileSearchHit extends StoredFileRecord {
  deliveryPath: string;
}
