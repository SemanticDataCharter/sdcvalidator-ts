/**
 * The MCP server: the protocol, malformed requests, and each tool on a conformance case (offline,
 * with the suite's copy of the reference model).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { handle, SERVER_VERSION, TOOLS } from '../src/mcp.js';

const here = dirname(fileURLToPath(import.meta.url));
const SUITE = resolve(process.env.CONFORMANCE_DIR ?? join(here, '..', '..', 'sdcvalidator', 'conformance'));
const MODEL_DIR = join(SUITE, 'models', 'halvorsen-order');
const schema = join(MODEL_DIR, readdirSync(MODEL_DIR).find((f) => f.endsWith('.xsd'))!);
const args = (instance: string) => ({
  schema_path: schema,
  instance_path: join(SUITE, 'cases', 'halvorsen-order', instance),
  reference_path: join(SUITE, 'reference', 'sdc4.xsd'),
});

const call = async (name: string, a: object) => {
  const r = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: a } })) as {
    result?: { content: { text: string }[] }; error?: { message: string };
  };
  assert.ok(r.result, r.error?.message);
  return JSON.parse(r.result.content[0].text);
};

test('initialize and tools/list', async () => {
  const init = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as { result: { serverInfo: { version: string } } };
  assert.equal(init.result.serverInfo.version, SERVER_VERSION);
  const list = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('malformed requests are answered, never fatal', async () => {
  for (const bad of [42, 'x', null, [], { id: {}, method: 'ping' }, { id: 1, method: 7 }, { id: 1, method: 'ping', params: [] }]) {
    const r = (await handle(bad)) as { error: { code: number } };
    assert.equal(r.error.code, -32600);
  }
  const unknown = (await handle({ id: 1, method: 'tools/call', params: { name: 'nope', arguments: {} } })) as { error: { code: number } };
  assert.equal(unknown.error.code, -32601);
});

test('validate_instance and validate_and_report', async () => {
  assert.equal((await call('validate_instance', args('valid-1.xml'))).valid, true);
  const report = await call('validate_and_report', args('m-token.xml'));
  assert.equal(report.valid, false);
  assert.equal(report.semantic_errors[0].exceptional_value, 'OTH');
});

test('recover_instance covers a value, and rejects a structural error', async () => {
  const r = await call('recover_instance', args('m-quantity-type.xml'));
  assert.equal(r.ok, true);
  assert.equal(r.recoveries[0].code, 'INV');
  assert.match(r.recovered_record, /<sdc4:INV>/);
  const s = await call('recover_instance', args('s-unknown-element.xml'));
  assert.equal(s.rejected, 'structural');
});

test('check_schema_compliance', async () => {
  assert.equal((await call('check_schema_compliance', { schema_path: schema })).compliant, true);
  const rm = await call('check_schema_compliance', { schema_path: join(SUITE, 'reference', 'sdc4.xsd') });
  assert.equal(rm.compliant, false, 'the reference model itself uses extension');
});

test('the command answers over stdio', () => {
  const run = spawnSync(process.execPath, ['--import', 'tsx', join(here, '..', 'src', 'cli.ts'), 'mcp'], {
    input: '{"jsonrpc":"2.0","id":1,"method":"ping"}\nnot json\n',
    encoding: 'utf8',
  });
  const lines = run.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines[0], { jsonrpc: '2.0', id: 1, result: {} });
  assert.equal(lines[1].error.code, -32700);
});
