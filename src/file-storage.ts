import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

const STORAGE_DIRECTORY = ".assistant-files";

function isInside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function inboundRoots(workspaceDir: string, stateDir?: string): string[] {
  const parent = dirname(resolve(workspaceDir));
  return [
    resolve(workspaceDir, "media", "inbound"),
    ...(stateDir?.trim() ? [resolve(stateDir, "media", "inbound")] : []),
    resolve(parent, "media", "inbound"),
    resolve(parent, ".openclaw", "media", "inbound"),
  ].filter((value, index, values) => values.indexOf(value) === index);
}

async function inboundPath(workspaceDir: string, fileRef: string, stateDir?: string): Promise<string> {
  const trimmed = fileRef.trim();
  const mediaUri = /^media:\/\/inbound\/([^/\\]+)$/i.exec(trimmed);
  const roots = inboundRoots(workspaceDir, stateDir);
  if (mediaUri?.[1]) {
    let id: string;
    try {
      id = decodeURIComponent(mediaUri[1]);
    } catch {
      throw new Error("The inbound media reference is malformed.");
    }
    if (!id || id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
      throw new Error("The inbound media reference is unsafe.");
    }
    for (const root of roots) {
      const candidate = resolve(root, id);
      if (await lstat(candidate).then((info) => info.isFile()).catch(() => false)) return candidate;
    }
    return resolve(roots[0]!, id);
  }

  const candidate = isAbsolute(trimmed) ? resolve(trimmed) : resolve(workspaceDir, trimmed);
  if (!roots.some((root) => isInside(root, candidate))) {
    throw new Error("Only a file from the current message's media/inbound directory can be remembered.");
  }
  return candidate;
}

function safeOriginalName(value: string): string {
  const name = basename(value.trim()).replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 180);
  return name || "file";
}

function mimeFromName(name: string): string | undefined {
  const extension = extname(name).toLocaleLowerCase();
  return {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  }[extension];
}

export interface PersistedFile {
  originalName: string;
  storageRef: string;
  deliveryPath: string;
  mimeType?: string;
  fileSize: number;
}

export async function persistInboundFile(options: {
  workspaceDir: string;
  stateDir?: string;
  ownerKey: string;
  fileRef: string;
  originalName?: string;
  mimeType?: string;
  maxBytes: number;
}): Promise<PersistedFile> {
  const source = await inboundPath(options.workspaceDir, options.fileRef, options.stateDir);
  const info = await lstat(source).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new Error("The inbound attachment was not found or is not a regular file.");
  }
  if (info.size > options.maxBytes) {
    throw new Error(`The attachment exceeds the ${Math.floor(options.maxBytes / 1024 / 1024)} MB storage limit.`);
  }

  const originalName = safeOriginalName(options.originalName || basename(source));
  const ownerDirectory = createHash("sha256").update(options.ownerKey).digest("hex").slice(0, 20);
  const extension = extname(originalName).slice(0, 16);
  const storageRef = `${STORAGE_DIRECTORY}/${ownerDirectory}/${randomUUID()}${extension}`;
  const destination = resolve(options.workspaceDir, ...storageRef.split("/"));
  const mimeType = options.mimeType?.trim() || mimeFromName(originalName);
  await mkdir(resolve(options.workspaceDir, STORAGE_DIRECTORY, ownerDirectory), { recursive: true });
  await copyFile(source, destination);

  return {
    originalName,
    storageRef,
    deliveryPath: destination,
    ...(mimeType ? { mimeType } : {}),
    fileSize: info.size,
  };
}

export function resolveStoredFilePath(workspaceDir: string, storageRef: string): string {
  const root = resolve(workspaceDir, STORAGE_DIRECTORY);
  const candidate = resolve(workspaceDir, ...storageRef.split("/"));
  if (!isInside(root, candidate)) throw new Error("Stored file reference is outside the managed file directory.");
  return candidate;
}

export async function removeStoredFile(workspaceDir: string, storageRef: string): Promise<boolean> {
  const filePath = resolveStoredFilePath(workspaceDir, storageRef);
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
