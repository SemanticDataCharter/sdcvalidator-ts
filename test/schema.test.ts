/**
 * The schema reader, exported for tools that generate from a published model (the governed data kits).
 *
 * Every model in sdcvalidator's conformance suite is walked from its dm- root: each component (an ms-
 * element) must come with its own annotation (the rdf:Description naming it, with its label) and the
 * reference-model type it restricts. The suite is found as conformance.test.ts finds it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ComplexType, Particle, REFERENCE_MODEL_URL, Schema, SDC4_NS } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const SUITE = resolve(process.env.CONFORMANCE_DIR ?? join(here, '..', '..', 'sdcvalidator', 'conformance'));
const read = (p: string) => readFileSync(join(SUITE, p), 'utf8');
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

const manifest: { cases: { model: string }[] } = JSON.parse(read('manifest.json'));
const models = [...new Set(manifest.cases.map((c) => c.model))];

function load(model: string): Schema {
  return new Schema({
    text: read(model),
    resolve: (location) => {
      assert.equal(location, REFERENCE_MODEL_URL);
      return read('reference/sdc4.xsd');
    },
  });
}

/** Every ms- element reachable from the model's root, with the particle that places it. */
function components(schema: Schema, ct: string): { name: string; type: ComplexType; min: number; max: number }[] {
  const root = schema.element(`{${SDC4_NS}}dm-${ct}`);
  assert.ok(root, `dm-${ct}`);
  const out: { name: string; type: ComplexType; min: number; max: number }[] = [];
  const seen = new Set<ComplexType>();
  const walk = (p: Particle | null) => {
    if (!p) return;
    if (p.kind !== 'element') return p.items.forEach(walk);
    const type = p.decl.type();
    if (type.kind !== 'complex') return;
    const local = p.decl.name.slice(p.decl.name.indexOf('}') + 1);
    if (local.startsWith('ms-')) out.push({ name: local, type, min: p.min, max: p.max });
    if (seen.has(type)) return;
    seen.add(type);
    walk(type.content);
  };
  const rootType = root.type();
  assert.equal(rootType.kind, 'complex');
  walk((rootType as ComplexType).content);
  return out;
}

test('the conformance suite has its eight models', () => assert.equal(models.length, 8));

for (const model of models) {
  const ct = model.match(/dm-([a-z0-9]+)\.xsd$/)![1];

  test(`${model}: every component carries its own annotation and label`, () => {
    const found = components(load(model), ct);
    assert.ok(found.length > 50, `${found.length} components`);
    for (const { name, type } of found) {
      const component = name.slice(3);
      assert.equal(type.name, `mc-${component}`, name);
      // An adapter is a structural wrapper around one value; it has no description of its own.
      if (type.base === `{${SDC4_NS}}XdAdapterType`) continue;
      const description = type.appinfo.find((e) => e.namespaceURI === RDF && e.localName === 'Description');
      assert.ok(description, `${name}: no rdf:Description`);
      assert.ok(description.getAttributeNS(RDF, 'about')!.endsWith(`mc-${component}`), `${name}: rdf:about`);
      const label = Array.from(description.getElementsByTagNameNS(RDFS, 'label'))[0];
      assert.ok(label?.textContent?.trim(), `${name}: no rdfs:label`);
    }
  });

  test(`${model}: every component restricts a reference-model type`, () => {
    for (const { name, type } of components(load(model), ct)) {
      assert.ok(type.base?.startsWith(`{${SDC4_NS}}`), `${name}: base ${type.base}`);
      assert.match(type.base!, /}(Xd[A-Za-z]+|Cluster|Audit|Party|Attestation|Participation)Type$/, `${name}: base ${type.base}`);
    }
  });
}
