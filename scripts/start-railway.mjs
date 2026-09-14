import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const openclawCli = join(appDir, "node_modules", "openclaw", "openclaw.mjs");
const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || "/data/.openclaw";
const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR?.trim() || "/data/workspace";
const gatewayPort =
  process.env.OPENCLAW_GATEWAY_PORT?.trim() || process.env.PORT?.trim() || "8080";

process.env.OPENCLAW_STATE_DIR = stateDir;
process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;
process.env.OPENCLAW_GATEWAY_PORT = gatewayPort;
process.env.OPENCLAW_DISABLE_BONJOUR ||= "1";

const requiredVariables = ["DATABASE_URL", "OPENCLAW_GATEWAY_TOKEN"];
const missingVariables = requiredVariables.filter((name) => !process.env[name]?.trim());
if (missingVariables.length > 0) {
  console.error(
    `[railway] Missing required Railway Variables: ${missingVariables.join(", ")}.`,
  );
  process.exit(1);
}

const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY?.trim());
if (!hasOpenRouterKey && !hasOpenAiKey) {
  console.error(
    "[railway] Missing model credentials. Set OPENROUTER_API_KEY or OPENAI_API_KEY.",
  );
  process.exit(1);
}

const primaryModel =
  process.env.OPENCLAW_PRIMARY_MODEL?.trim() ||
  (hasOpenRouterKey
    ? "openrouter/deepseek/deepseek-v4-flash-0731"
    : "openai/gpt-5.5");

mkdirSync(stateDir, { recursive: true });
mkdirSync(workspaceDir, { recursive: true });

function runOpenClaw(args, options = {}) {
  const result = spawnSync(process.execPath, [openclawCli, ...args], {
    cwd: appDir,
    env: process.env,
    stdio: options.quiet ? "ignore" : "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`OpenClaw command failed: ${args.slice(0, 3).join(" ")}`);
  }
  return result.status ?? 1;
}

const configPath = join(stateDir, "openclaw.json");
if (!existsSync(configPath)) {
  console.log("[railway] Initializing OpenClaw state...");
  runOpenClaw([
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--skip-health",
    "--mode",
    "local",
    "--auth-choice",
    hasOpenRouterKey ? "openrouter-api-key" : "openai-api-key",
    "--secret-input-mode",
    "ref",
    "--gateway-auth",
    "token",
    "--gateway-token-ref-env",
    "OPENCLAW_GATEWAY_TOKEN",
    "--gateway-bind",
    "lan",
    "--gateway-port",
    gatewayPort,
    "--workspace",
    workspaceDir,
    "--skip-channels",
    "--skip-bootstrap",
    "--no-install-daemon",
    "--suppress-gateway-token-output",
  ]);
}

for (const filename of ["AGENTS.md", "SOUL.md", "USER.md", "MEMORY.md"]) {
  const source = join(appDir, "workspace", filename);
  const destination = join(workspaceDir, filename);
  if (!existsSync(destination)) copyFileSync(source, destination);
}

// Preserve user edits while adding newly shipped policy sections to an existing volume.
const agentsSourcePath = join(appDir, "workspace", "AGENTS.md");
const agentsDestinationPath = join(workspaceDir, "AGENTS.md");
const storedFilePolicyHeading = "## Stored file policy";
const currentAgentInstructions = readFileSync(agentsDestinationPath, "utf8");
if (!currentAgentInstructions.includes(storedFilePolicyHeading)) {
  const sourceAgentInstructions = readFileSync(agentsSourcePath, "utf8");
  const policyStart = sourceAgentInstructions.indexOf(storedFilePolicyHeading);
  const policyEnd = sourceAgentInstructions.indexOf("\n## ", policyStart + storedFilePolicyHeading.length);
  const storedFilePolicy = sourceAgentInstructions
    .slice(policyStart, policyEnd >= 0 ? policyEnd : undefined)
    .trim();
  if (storedFilePolicy) appendFileSync(agentsDestinationPath, `\n\n${storedFilePolicy}\n`, "utf8");
}

runOpenClaw(["config", "set", "gateway.mode", "local"]);
runOpenClaw(["config", "set", "gateway.bind", "lan"]);
runOpenClaw(["config", "set", "gateway.port", gatewayPort, "--strict-json"]);

const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
if (publicDomain) {
  runOpenClaw([
    "config",
    "set",
    "gateway.controlUi.allowedOrigins",
    JSON.stringify([`https://${publicDomain}`]),
    "--strict-json",
  ]);
}

const pluginId = "personal-assistant-memory";
const pluginAvailable =
  runOpenClaw(["plugins", "inspect", pluginId], { quiet: true, allowFailure: true }) === 0;
if (!pluginAvailable) {
  console.log("[railway] Linking the personal assistant memory plugin...");
  runOpenClaw(["plugins", "install", "-l", appDir]);
}
runOpenClaw(["plugins", "enable", pluginId]);
const allowedPlugins = [
  "browser",
  "canvas",
  "codex",
  "device-pair",
  "file-transfer",
  "memory-core",
  pluginId,
  "phone-control",
  "talk-voice",
  "telegram",
];
if (hasOpenRouterKey) allowedPlugins.push("openrouter");
runOpenClaw([
  "config",
  "set",
  "plugins.allow",
  JSON.stringify(allowedPlugins),
  "--strict-json",
]);

if (hasOpenRouterKey) runOpenClaw(["plugins", "enable", "openrouter"]);

// A previous `models scan --set-default` may have stored transient free-model
// fallbacks. Use one deterministic Railway default instead; operators can
// override it with OPENCLAW_PRIMARY_MODEL.
runOpenClaw(["models", "fallbacks", "clear"]);
runOpenClaw(["models", "set", primaryModel]);
console.log(`[railway] Primary model configured: ${primaryModel}`);

if (process.env.TELEGRAM_BOT_TOKEN?.trim()) {
  runOpenClaw(["channels", "add", "--channel", "telegram", "--use-env"]);
} else {
  console.warn("[railway] TELEGRAM_BOT_TOKEN is not set; Telegram will remain disabled.");
}

console.log(`[railway] Starting OpenClaw Gateway on port ${gatewayPort}...`);
const gateway = spawn(
  process.execPath,
  [openclawCli, "gateway", "run", "--bind", "lan", "--port", gatewayPort],
  {
    cwd: appDir,
    env: process.env,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => gateway.kill(signal));
}

gateway.on("error", (error) => {
  console.error(`[railway] Gateway process failed: ${error.message}`);
  process.exit(1);
});

gateway.on("exit", (code, signal) => {
  if (signal) console.error(`[railway] Gateway stopped by ${signal}.`);
  process.exit(code ?? 1);
});
