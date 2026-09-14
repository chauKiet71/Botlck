export type OwnerMode = "agent" | "requester" | "channel-requester" | "session";

export interface PluginConfig {
  databaseUrl: string;
  databaseUrlEnv: string;
  databaseSchema: string;
  ownerMode: OwnerMode;
  maxPoolSize: number;
  connectionTimeoutMs: number;
  maxRecallResults: number;
  documentChunkChars: number;
  documentChunkOverlapChars: number;
  maxStoredFileMb: number;
}

function finiteInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function safeIdentifier(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return fallback;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(candidate)) {
    throw new Error("databaseSchema must contain only letters, numbers, and underscores and cannot start with a number.");
  }
  return candidate;
}

export function resolvePluginConfig(raw: Record<string, unknown> | null | undefined): PluginConfig {
  const databaseUrlEnv =
    typeof raw?.databaseUrlEnv === "string" && raw.databaseUrlEnv.trim()
      ? raw.databaseUrlEnv.trim()
      : "DATABASE_URL";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseUrlEnv)) {
    throw new Error("databaseUrlEnv is not a valid environment-variable name.");
  }

  const databaseUrl = process.env[databaseUrlEnv]?.trim() ?? "";
  const allowedOwnerModes: OwnerMode[] = ["agent", "requester", "channel-requester", "session"];
  const ownerMode = allowedOwnerModes.includes(raw?.ownerMode as OwnerMode)
    ? (raw?.ownerMode as OwnerMode)
    : "agent";

  const documentChunkChars = finiteInteger(raw?.documentChunkChars, 1600, 500, 6000);
  const overlap = finiteInteger(raw?.documentChunkOverlapChars, 200, 0, 1000);

  return {
    databaseUrl,
    databaseUrlEnv,
    databaseSchema: safeIdentifier(raw?.databaseSchema, "openclaw_assistant"),
    ownerMode,
    maxPoolSize: finiteInteger(raw?.maxPoolSize, 4, 1, 20),
    connectionTimeoutMs: finiteInteger(raw?.connectionTimeoutMs, 10_000, 1_000, 60_000),
    maxRecallResults: finiteInteger(raw?.maxRecallResults, 8, 1, 30),
    documentChunkChars,
    documentChunkOverlapChars: Math.min(overlap, Math.floor(documentChunkChars / 2)),
    maxStoredFileMb: finiteInteger(raw?.maxStoredFileMb, 20, 1, 25),
  };
}

export function requireDatabaseUrl(config: PluginConfig): string {
  if (!config.databaseUrl) {
    throw new Error(
      `Neon PostgreSQL connection string is missing. Set ${config.databaseUrlEnv} in the Gateway environment or ~/.openclaw/.env, then restart OpenClaw.`,
    );
  }
  return config.databaseUrl;
}
