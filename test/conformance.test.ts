/**
 * sdcvalidator's conformance suite: every case must give the reference's result.
 *
 * The suite lives in the sdcvalidator repository (conformance/). Point CONFORMANCE_DIR at it; by
 * default this looks for a sibling checkout (../sdcvalidator/conformance).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REFERENCE_MODEL_URL, SDC4Validator, StructuralValidationError } from '../src/index.js';
import { childElements, clark, Element, parseXml } from '../src/xml.js';

const here = dirname(fileURLToPath(import.meta.url));
const SUITE = resolve(process.env.CONFORMANCE_DIR ?? join(here, '..', '..', 'sdcvalidator', 'conformance'));
const read = (p: string) => readFileSync(join(SUITE, p), 'utf8');

interface Expected {
  valid: boolean;
  structural: string[];
  semantic: { path: string; ev: string | null }[];
  recover: { rejected: string } | { ok: boolean; recoveries: { path: string; code: string; inserted: boolean }[]; unrecoverable: string[] };
  recovered?: string;
}

const manifest: { cases: { id: string; model: string; record: string; expected: string }[] } = JSON.parse(read('manifest.json'));
const validators = new Map<string, SDC4Validator>();
const validatorFor = (model: string) => {
  let v = validators.get(model);
  if (!v) {
    v = new SDC4Validator({
      text: read(model),
      resolve: (location) => {
        if (location !== REFERENCE_MODEL_URL) throw new Error(`unexpected include ${location}`);
        return read('reference/sdc4.xsd');
      },
    });
    validators.set(model, v);
  }
  return v;
};

/** An element tree as comparable data: names, attributes, and text, with comments dropped. */
function shape(el: Element): unknown {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i)!;
    if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
    attrs[a.namespaceURI ? `{${a.namespaceURI}}${a.localName}` : a.localName!] = a.value;
  }
  const content: unknown[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) content.push(shape(n as Element));
    else if (n.nodeType === 3 || n.nodeType === 4) {
      if (typeof content.at(-1) === 'string') content[content.length - 1] += n.nodeValue!;
      else content.push(n.nodeValue!);
    }
  }
  return { name: clark(el), attrs, content };
}

for (const c of manifest.cases) {
  test(c.id, () => {
    const expected: Expected = JSON.parse(read(c.expected));
    const v = validatorFor(c.model);
    const record = read(c.record);
    const result = v.validate(record);

    assert.equal(result.valid, expected.valid, 'verdict');
    assert.deepEqual(result.structural.map((e) => e.path).sort(), expected.structural, 'structural errors');
    const semantic = result.semantic
      .map((e) => ({ path: e.path, ev: e.ev }))
      .sort((a, b) => (a.path === b.path ? (a.ev ?? '').localeCompare(b.ev ?? '') : a.path < b.path ? -1 : 1));
    assert.deepEqual(semantic, expected.semantic, 'semantic errors');

    if ('rejected' in expected.recover) {
      assert.throws(() => v.recover(record), StructuralValidationError);
      return;
    }
    const r = v.recover(record);
    assert.equal(r.ok, expected.recover.ok, 'recovery ok');
    assert.deepEqual(
      r.recoveries.map(({ path, code, inserted }) => ({ code, inserted, path }))
        .sort((a, b) => (a.path === b.path ? a.code.localeCompare(b.code) : a.path < b.path ? -1 : 1)),
      expected.recover.recoveries,
      'recoveries',
    );
    assert.deepEqual(r.unrecoverable.map((e) => e.path).sort(), expected.recover.unrecoverable, 'unrecoverable');
    if (expected.recovered) {
      const want = parseXml(read(expected.recovered)).documentElement!;
      assert.deepEqual(shape(r.record.documentElement!), shape(want), 'recovered record');
    }
  });
}

test('the suite was found', () => {
  assert.ok(manifest.cases.length > 0, `no cases in ${SUITE}`);
  assert.ok(childElements(parseXml(read('reference/sdc4.xsd')).documentElement!).length > 0);
});
