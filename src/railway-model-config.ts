export interface RailwayModelConfig {
  primary: string;
  fallbacks: string[];
  catalog: Record<string, { alias?: string }>;
  providers: Record<string, RailwayProviderConfig>;
}

export interface RailwayProviderConfig {
  baseUrl: string;
  apiKey: {
    source: "env";
    provider: "default";
    id: string;
  };
  api: "openai-completions";
  models: Array<{ id: string; name: string }>;
}

type Environment = Readonly<Record<string, string | undefined>>;

const MODEL_REF_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:+-]*(?:\/[a-z0-9][a-z0-9._:+-]*)*$/i;
const PROVIDER_WILDCARD_PATTERN = /^[a-z0-9][a-z0-9._-]*\/\*$/i;
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

function parseList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertModelRef(value: string, variable: string, allowWildcard = false): void {
  const valid = MODEL_REF_PATTERN.test(value) || (allowWildcard && PROVIDER_WILDCARD_PATTERN.test(value));
  if (!valid) {
    const wildcardHint = allowWildcard ? " (or provider/*)" : "";
    throw new Error(`${variable} contains invalid model reference "${value}". Use provider/model${wildcardHint}.`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function parseAliases(value: string | undefined): Map<string, string> {
  const aliases = new Map<string, string>();
  const normalizedAliases = new Set<string>();
  const targets = new Set<string>();

  for (const entry of parseList(value)) {
    const separator = entry.indexOf("=");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(
        `OPENCLAW_MODEL_ALIASES contains invalid entry "${entry}". Use alias=provider/model.`,
      );
    }

    const alias = entry.slice(0, separator).trim();
    const model = entry.slice(separator + 1).trim();
    if (!ALIAS_PATTERN.test(alias)) {
      throw new Error(
        `OPENCLAW_MODEL_ALIASES contains invalid alias "${alias}". Use 1-32 letters, numbers, underscores, or hyphens.`,
      );
    }
    assertModelRef(model, "OPENCLAW_MODEL_ALIASES");
    const normalizedAlias = alias.toLowerCase();
    if (normalizedAliases.has(normalizedAlias)) {
      throw new Error(`OPENCLAW_MODEL_ALIASES defines alias "${alias}" more than once.`);
    }
    if (targets.has(model)) {
      throw new Error(
        `OPENCLAW_MODEL_ALIASES assigns more than one alias to "${model}"; OpenClaw supports one alias per model.`,
      );
    }
    aliases.set(alias, model);
    normalizedAliases.add(normalizedAlias);
    targets.add(model);
  }

  return aliases;
}

export function resolveRailwayModelConfig(env: Environment): RailwayModelConfig {
  const hasOpenRouterKey = Boolean(env.OPENROUTER_API_KEY?.trim());
  const hasOpenAiKey = Boolean(env.OPENAI_API_KEY?.trim());
  const hasNineRouterKey = Boolean(env.NINE_ROUTER_API_KEY?.trim());
  const nineRouterBaseUrl = env.NINE_ROUTER_BASE_URL?.trim();
  if (hasNineRouterKey !== Boolean(nineRouterBaseUrl)) {
    throw new Error(
      "NINE_ROUTER_API_KEY and NINE_ROUTER_BASE_URL must be set together.",
    );
  }

  const primary =
    env.OPENCLAW_PRIMARY_MODEL?.trim() ||
    (hasOpenRouterKey
      ? "openrouter/deepseek/deepseek-v4-flash-0731"
      : hasOpenAiKey
        ? "openai/gpt-5.5"
        : "9router/openclaw");
  assertModelRef(primary, "OPENCLAW_PRIMARY_MODEL");

  const fallbacks = unique(parseList(env.OPENCLAW_FALLBACK_MODELS));
  for (const model of fallbacks) assertModelRef(model, "OPENCLAW_FALLBACK_MODELS");
  if (fallbacks.includes(primary)) {
    throw new Error("OPENCLAW_FALLBACK_MODELS must not contain OPENCLAW_PRIMARY_MODEL.");
  }

  const allowed = parseList(env.OPENCLAW_ALLOWED_MODELS);
  for (const model of allowed) assertModelRef(model, "OPENCLAW_ALLOWED_MODELS", true);

  // With no explicit allowlist, expose the dynamic catalog of every authenticated
  // provider. This makes OpenClaw's /model picker useful out of the box.
  if (env.OPENCLAW_ALLOWED_MODELS === undefined) {
    if (hasOpenRouterKey) allowed.push("openrouter/*");
    if (hasOpenAiKey) allowed.push("openai/*");
    if (hasNineRouterKey) allowed.push("9router/*");
  }

  const aliases = parseAliases(env.OPENCLAW_MODEL_ALIASES);
  const catalog: Record<string, { alias?: string }> = {};
  for (const model of unique([...allowed, primary, ...fallbacks, ...aliases.values()])) {
    catalog[model] = {};
  }
  for (const [alias, model] of aliases) catalog[model] = { alias };

  const providers: Record<string, RailwayProviderConfig> = {};
  if (hasNineRouterKey && nineRouterBaseUrl) {
    const configuredModels = parseList(env.NINE_ROUTER_MODELS);
    const nineRouterModels = unique(configuredModels.length > 0 ? configuredModels : ["openclaw"]);
    for (const model of nineRouterModels) {
      assertModelRef(`9router/${model}`, "NINE_ROUTER_MODELS");
    }
    providers["9router"] = {
      baseUrl: nineRouterBaseUrl.replace(/\/$/, ""),
      apiKey: {
        source: "env",
        provider: "default",
        id: "NINE_ROUTER_API_KEY",
      },
      api: "openai-completions",
      models: nineRouterModels.map((id) => ({ id, name: id })),
    };
  }

  return { primary, fallbacks, catalog, providers };
}
