import assert from "node:assert/strict";
import test from "node:test";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import plugin from "../index.js";

test("runtime entry registers the cron guard and prompt clock alongside all memory tools", () => {
  const hooks = new Map<string, Function>();
  const tools: string[] = [];
  const api = {
    registerTool(_factory: unknown, options: { name: string }) { tools.push(options.name); },
    on(name: string, handler: Function) { hooks.set(name, handler); },
  };
  plugin.register(api as unknown as Parameters<typeof plugin.register>[0]);
  assert.equal(tools.length, 13);
  assert.equal(getToolPluginMetadata(plugin)?.tools.length, 13);
  const result = hooks.get("before_tool_call")!({
    toolName: "cron",
    params: { action: "add", job: { schedule: { kind: "at", at: "2099-01-01T22:20:00Z" } } },
  });
  assert.equal(result.block, true);
  assert.match(hooks.get("before_prompt_build")!().prependContext, /Current time in Vietnam:/);
});
