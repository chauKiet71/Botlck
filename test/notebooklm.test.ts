import assert from "node:assert/strict";
import { spawn, type SpawnOptions } from "node:child_process";
import test from "node:test";
import { authorizeNotebook, listNotebooks, notebookArgs, notebookConfig, notebookContext, parseNotebookAnswer, parseNotebookCatalog, queryNotebook } from "../src/notebooklm.js";

const env = { NOTEBOOKLM_NOTEBOOK_ID: "12345678-1234-1234-1234-123456789abc", NOTEBOOKLM_OWNER_KEY: "channel:telegram:requester:123" };
const config = notebookConfig(env);
const context = { messageChannel: "telegram", requesterSenderId: "123" };
function fixture(script: string): typeof spawn {
  return ((_file: string, _args: string[], options: SpawnOptions) => spawn(process.execPath, ["-e", script], options)) as typeof spawn;
}

test("NotebookLM requires an explicit notebook and trusted channel/sender", () => {
  assert.throws(() => notebookConfig({}), /NOTEBOOKLM_NOTEBOOK_ID/);
  assert.throws(() => notebookConfig({ ...env, NOTEBOOKLM_OWNER_KEY: "" }), /OWNER_KEY/);
  assert.throws(() => notebookConfig({ ...env, NOTEBOOKLM_TIMEOUT_MS: "NaN" }), /TIMEOUT/);
  authorizeNotebook(config, context);
  assert.throws(() => authorizeNotebook(config, { ...context, sessionKey: "agent:main:telegram:group:-123" }), /chat riêng/);
  for (const denied of [{}, { ...context, requesterSenderId: "999" }, { ...context, messageChannel: "discord" }]) {
    assert.throws(() => authorizeNotebook(config, denied), /chưa được cấp quyền/);
  }
});

test("NotebookLM does not delete history or freeze source selection", () => {
  const args = notebookArgs(config);
  assert.ok(args.includes(config.notebookId));
  for (const forbidden of ["--new", "--source", "--conversation-id", "--save-as-note"]) assert.ok(!args.includes(forbidden));
});

test("NotebookLM preserves citations and rejects empty/error payloads", () => {
  const references = [{ source_id: "source1", citation_number: 1, cited_text: "Evidence" }];
  assert.deepEqual(parseNotebookAnswer(JSON.stringify({ answer: "Answer [1]", references }), config.notebookId).references, references);
  for (const value of ["invalid", "null", "{}", '{"answer":""}', '{"error":"auth"}']) {
    assert.throws(() => parseNotebookAnswer(value, config.notebookId));
  }
});

test("NotebookLM sends Vietnamese and shell-like input through stdin unchanged", async () => {
  const question = 'Tài liệu nói gì? $(secret) " --new';
  const result = await queryNotebook(config, context, question, undefined, fixture(
    `let s=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c=>s+=c); process.stdin.on('end', ()=>console.log(JSON.stringify({answer:s,references:[]})));`,
  ));
  assert.ok(String(result.answer).endsWith(question));
});

test("NotebookLM failures do not expose stderr or pretend no evidence exists", async () => {
  await assert.rejects(queryNotebook(config, context, "test", undefined, fixture("console.error('SECRET_COOKIE'); process.exit(1)")), error => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /SECRET_COOKIE/);
    assert.match(error.message, /không phải kết quả không tìm thấy/);
    return true;
  });
  await assert.rejects(queryNotebook(config, {}, "test"), /chưa được cấp quyền/);
});

test("NotebookLM enforces timeout, cancellation, missing executable and output limits", async () => {
  const idle = fixture("setInterval(()=>{},1000)");
  await assert.rejects(queryNotebook({ ...config, timeoutMs: 100 }, context, "test", undefined, idle), /quá thời gian/);
  const controller = new AbortController();
  const pending = queryNotebook(config, context, "test", controller.signal, idle);
  controller.abort();
  await assert.rejects(pending, /hủy/);
  await assert.rejects(queryNotebook({ ...config, executable: "missing-notebooklm-executable-12345" }, context, "test"), /Không chạy được/);
  await assert.rejects(queryNotebook(config, context, "test", undefined, fixture("process.stdout.write('x'.repeat(1100000))")), /vượt giới hạn/);
});

test("all mode fetches a fresh catalog and validates selected notebook membership", async () => {
  const all = notebookConfig({ ...env, NOTEBOOKLM_NOTEBOOK_ID: "all" });
  let listed = 0;
  const calls: string[][] = [];
  const launch = ((file: string, args: string[], options: SpawnOptions) => {
    calls.push(args);
    const response = args.includes("list")
      ? { notebooks: [{ id: config.notebookId, title: `SEO ${++listed}` }] }
      : { answer: "SEO evidence [1]", references: [{ source_id: "src", citation_number: 1 }] };
    return fixture(`process.stdin.resume(); process.stdin.on('end',()=>console.log(${JSON.stringify(JSON.stringify(response))}));`)(file, args, options);
  }) as typeof spawn;
  assert.equal((await listNotebooks(all, context, undefined, launch))[0]?.title, "SEO 1");
  const result = await queryNotebook(all, context, "SEO?", undefined, launch, config.notebookId);
  assert.equal(result.notebookTitle, "SEO 2");
  assert.equal(result.notebookId, config.notebookId);
  assert.equal(calls.filter(args => args.includes("ask")).length, 1);
  await assert.rejects(queryNotebook(all, context, "SEO?", undefined, launch, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), /không còn trong danh mục/);
  assert.equal(calls.filter(args => args.includes("ask")).length, 1);
  await assert.rejects(queryNotebook(all, context, "SEO?", undefined, launch), /Chọn notebookId/);
  const before = calls.length;
  await assert.rejects(listNotebooks(all, {}, undefined, launch), /chưa được cấp quyền/);
  assert.equal(calls.length, before);
});

test("single-notebook configuration cannot be widened by model-selected IDs", async () => {
  await assert.rejects(queryNotebook(config, context, "test", undefined, undefined, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), /ngoài phạm vi/);
  const launch = fixture(`console.log(JSON.stringify({notebooks:[{id:'${config.notebookId}',title:'One'},{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',title:'Two'}]}));`);
  assert.equal((await listNotebooks(config, context, undefined, launch)).length, 1);
});

test("catalog handles empty/unnamed notebooks and rejects malformed data", () => {
  assert.deepEqual(parseNotebookCatalog('{"notebooks":[]}'), []);
  assert.equal(parseNotebookCatalog(JSON.stringify({ notebooks: [{ id: config.notebookId, title: "" }] }))[0]?.title, "(Chưa có tên)");
  for (const output of ['null', '{}', 'bad', '{"notebooks":[{"id":"--new","title":"X"}]}']) {
    assert.throws(() => parseNotebookCatalog(output), /không hợp lệ/);
  }
  const prompt = notebookContext({ NOTEBOOKLM_NOTEBOOK_ID: "all" });
  assert.match(prompt, /assistant_list_notebooklm/);
  assert.match(prompt, /semantic relevance/);
  assert.match(prompt, /Never claim all notebooks were searched/);
  assert.equal(notebookContext({}), "");
});
