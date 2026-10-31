/**
 * Validate a record against a loaded schema, giving the errors sdcvalidator gives: the same paths,
 * the same tiers, the same ExceptionalValue codes.
 *
 * Errors are classified by the constraint that failed, never by message wording. The mapping to
 * ExceptionalValue codes reproduces sdcvalidator 4.6.2 as its conformance suite records it: a value
 * that is not lexically of its type is INV; every facet, fixed-value and assertion failure is NI.
 * (sdcvalidator's own rule table intends OTH for enumerations and INV for patterns and ranges; when
 * the reference changes, the suite's expectations change and this table follows.)
 */
import fontoxpath from 'fontoxpath';
import { BUILTINS, compareDecimal, decimalDigits, normalizeWhiteSpace } from './builtins.js';
import type { ComplexType, ElementDecl, Particle, Schema, SimpleType } from './schema.js';
import { childElements, clark, directText, Element, localOf } from './xml.js';

const { evaluateXPathToBoolean } = fontoxpath;

export type ErrorKind =
  | 'content' // the element's children do not match its content model
  | 'root' // the root element is not declared
  | 'type' // a value not in its type's lexical space
  | 'facet' // a value of its type that breaks a facet
  | 'fixed' // a value other than the fixed one
  | 'text' // character data where only elements are allowed
  | 'assertion'; // an xsd:assert that is false

export interface SdcError {
  /** The element's path in Clark notation, without position indexes, as sdcvalidator reports it. */
  path: string;
  tier: 'structural' | 'semantic';
  kind: ErrorKind;
  /** The facet or constraint, for messages: 'pattern', 'enumeration', 'maxLength', ... */
  constraint?: string;
  /** The ISO 21090 ExceptionalValue code recovery would use, or null if the error cannot be covered. */
  ev: string | null;
  message: string;
}

/** Elements that are never tagged with an ExceptionalValue: an error on one cannot be recovered. */
export const STRUCTURAL_ELEMENTS = new Set([
  'label', 'act', 'vtb', 'vte', 'tr', 'modified', 'latitude', 'longitude',
  'normal-status', 'magnitude-status', 'accuracy_margin', 'precision_digits',
]);

function evFor(kind: ErrorKind, path: string): string | null {
  if (kind === 'content' || kind === 'root') return null;
  if (STRUCTURAL_ELEMENTS.has(localOf(path.slice(path.lastIndexOf('/') + 1)))) return null;
  return kind === 'type' ? 'INV' : 'NI';
}

function error(path: string, kind: ErrorKind, message: string, constraint?: string): SdcError {
  const tier = kind === 'content' || kind === 'root' ? 'structural' : 'semantic';
  return { path, tier, kind, constraint, ev: evFor(kind, path), message };
}

/** A pending match of a child element to the declaration it satisfies. */
type Assignment = (ElementDecl | undefined)[];

export class Validator {
  constructor(readonly schema: Schema) {}

  validate(root: Element): SdcError[] {
    const errors: SdcError[] = [];
    const path = '/' + clark(root);
    const decl = this.schema.element(clark(root));
    if (!decl || decl.abstract) {
      errors.push(error(path, 'root', `root element ${clark(root)} is not declared`));
      return errors;
    }
    this.element(root, decl, path, errors);
    return errors;
  }

  private element(el: Element, decl: ElementDecl, path: string, errors: SdcError[]) {
    const type = decl.type();
    if (type.kind === 'simple') {
      this.simpleElement(el, type, decl, path, errors);
      return;
    }
    if (type.simple) {
      this.simpleElement(el, type.simple, decl, path, errors);
    } else {
      this.complexContent(el, type, path, errors);
    }
  }

  private simpleElement(el: Element, type: SimpleType, decl: ElementDecl, path: string, errors: SdcError[]) {
    if (childElements(el).length) {
      errors.push(error(path, 'type', 'an element of simple type has element children'));
      return;
    }
    const failures = checkSimple(directText(el), type);
    for (const f of failures) errors.push(error(path, f.kind, f.message, f.constraint));
    if (!failures.length && decl.fixed !== undefined) {
      const ws = whiteSpaceOf(type);
      if (normalizeWhiteSpace(directText(el), ws) !== normalizeWhiteSpace(decl.fixed, ws)) {
        errors.push(error(path, 'fixed', `must have the fixed value '${decl.fixed}'`, 'fixed'));
      }
    }
  }

  private complexContent(el: Element, type: ComplexType, path: string, errors: SdcError[]) {
    const kids = childElements(el);
    if (!type.mixed && directText(el).trim()) {
      errors.push(error(path, 'text', 'character data is not allowed in element-only content'));
    }
    const assignment: Assignment = new Array(kids.length);
    const matched = type.content
      ? firstComplete(matchParticle(this.schema, type.content, kids, 0, assignment), kids.length)
      : kids.length === 0;
    if (!matched) {
      errors.push(error(path, 'content', 'the content does not match the content model'));
      // Keep validating the children the model can place, as the reference does.
      kids.forEach((kid, i) => {
        const decl = type.content ? findDeclaration(this.schema, type.content, kid) : undefined;
        if (decl) this.element(kid, decl, `${path}/${clark(kid)}`, errors);
      });
      return;
    }
    kids.forEach((kid, i) => this.element(kid, assignment[i]!, `${path}/${clark(kid)}`, errors));
    for (const a of type.asserts) {
      if (!evaluateAssertion(a, el)) errors.push(error(path, 'assertion', `assertion test is false: ${a.test}`, 'assertion'));
    }
  }
}

function whiteSpaceOf(type: SimpleType): 'preserve' | 'replace' | 'collapse' {
  return type.facets.whiteSpace ?? BUILTINS[type.builtin].whiteSpace;
}

interface SimpleFailure {
  kind: 'type' | 'facet';
  constraint?: string;
  message: string;
}

/** Check one simple value: a lexical failure alone, or every facet it breaks. */
export function checkSimple(raw: string, type: SimpleType): SimpleFailure[] {
  const value = normalizeWhiteSpace(raw, whiteSpaceOf(type));
  if (type.list) {
    const items = value === '' ? [] : value.split(' ');
    const out: SimpleFailure[] = [];
    for (const item of items) out.push(...checkSimple(item, type.list));
    out.push(...lengthFacets(items.length, type));
    return out;
  }
  const builtin = BUILTINS[type.builtin];
  if (!builtin.lexical(value)) {
    return [{ kind: 'type', message: `invalid value '${value}' for xs:${type.builtin}` }];
  }
  const out: SimpleFailure[] = [];
  const builtinFacet = builtin.facet?.(value);
  if (builtinFacet) out.push({ kind: 'facet', constraint: builtinFacet, message: `value breaks the xs:${type.builtin} ${builtinFacet}` });
  const f = type.facets;
  for (const step of f.patterns) {
    if (!step.some((p) => p.regex.test(value))) {
      out.push({ kind: 'facet', constraint: 'pattern', message: `value doesn't match any pattern of [${step.map((p) => `'${p.source}'`).join(', ')}]` });
    }
  }
  if (f.enumeration && !f.enumeration.some((e) => sameValue(e, value, type))) {
    out.push({ kind: 'facet', constraint: 'enumeration', message: `value must be one of [${f.enumeration.map((e) => `'${e}'`).join(', ')}]` });
  }
  out.push(...lengthFacets([...value].length, type));
  if (builtin.primitive === 'decimal') {
    const cmp = (bound: string | undefined, ok: (c: number) => boolean, name: string) => {
      if (bound !== undefined && !ok(compareDecimal(value, bound))) out.push({ kind: 'facet', constraint: name, message: `value breaks ${name} ${bound}` });
    };
    cmp(f.minInclusive, (c) => c >= 0, 'minInclusive');
    cmp(f.maxInclusive, (c) => c <= 0, 'maxInclusive');
    cmp(f.minExclusive, (c) => c > 0, 'minExclusive');
    cmp(f.maxExclusive, (c) => c < 0, 'maxExclusive');
    const digits = decimalDigits(value);
    if (f.totalDigits !== undefined && digits.total > f.totalDigits) out.push({ kind: 'facet', constraint: 'totalDigits', message: `more than ${f.totalDigits} digits` });
    if (f.fractionDigits !== undefined && digits.fraction > f.fractionDigits) out.push({ kind: 'facet', constraint: 'fractionDigits', message: `more than ${f.fractionDigits} fraction digits` });
  } else if (builtin.primitive === 'float' || builtin.primitive === 'temporal') {
    const ord = (v: string) => (builtin.primitive === 'float' ? Number(v) : Date.parse(v));
    const cmp = (bound: string | undefined, ok: (a: number, b: number) => boolean, name: string) => {
      if (bound !== undefined && !Number.isNaN(ord(bound)) && !ok(ord(value), ord(bound))) out.push({ kind: 'facet', constraint: name, message: `value breaks ${name} ${bound}` });
    };
    cmp(f.minInclusive, (a, b) => a >= b, 'minInclusive');
    cmp(f.maxInclusive, (a, b) => a <= b, 'maxInclusive');
    cmp(f.minExclusive, (a, b) => a > b, 'minExclusive');
    cmp(f.maxExclusive, (a, b) => a < b, 'maxExclusive');
  }
  return out;
}

function lengthFacets(length: number, type: SimpleType): SimpleFailure[] {
  const f = type.facets, out: SimpleFailure[] = [];
  if (f.length !== undefined && length !== f.length) out.push({ kind: 'facet', constraint: 'length', message: `length has to be ${f.length}` });
  if (f.minLength !== undefined && length < f.minLength) out.push({ kind: 'facet', constraint: 'minLength', message: `value length cannot be lesser than ${f.minLength}` });
  if (f.maxLength !== undefined && length > f.maxLength) out.push({ kind: 'facet', constraint: 'maxLength', message: `value length cannot be greater than ${f.maxLength}` });
  return out;
}

function sameValue(a: string, b: string, type: SimpleType): boolean {
  const p = BUILTINS[type.builtin].primitive;
  if (p === 'decimal') return BUILTINS.decimal.lexical(a) && compareDecimal(a, b) === 0;
  if (p === 'float') return Number(a) === Number(b);
  if (p === 'boolean') return (a === 'true' || a === '1') === (b === 'true' || b === '1');
  return normalizeWhiteSpace(a, whiteSpaceOf(type)) === b;
}

/** The declaration a child satisfies under `decl`: the declaration itself or a substitution group member. */
function satisfies(schema: Schema, decl: ElementDecl, kid: Element): ElementDecl | undefined {
  const name = clark(kid);
  if (decl.name === name) return decl.abstract ? undefined : decl;
  if (!decl.global) return undefined;
  for (const member of schema.substitutionMembers(decl.name)) {
    if (member === name) {
      const m = schema.element(member);
      return m && !m.abstract ? m : undefined;
    }
  }
  return undefined;
}

/**
 * Every position where `p` can stop, matching kids from `pos`, recording the declarations it uses.
 * Greedy first, backtracking on demand; the assignment holds the current branch's choices.
 */
function* matchParticle(schema: Schema, p: Particle, kids: Element[], pos: number, a: Assignment): Generator<number> {
  yield* repeat(p.min, p.max, pos, (at) => matchOnce(schema, p, kids, at, a));
}

function* repeat(min: number, max: number, pos: number, once: (pos: number) => Generator<number>, count = 0): Generator<number> {
  if (count < max) {
    for (const next of once(pos)) {
      if (next === pos) continue; // an empty repetition never ends a loop
      yield* repeat(min, max, next, once, count + 1);
    }
  }
  if (count >= min) yield pos;
  else if (count < min) {
    // The remaining repetitions may match nothing (an emptiable group).
    for (const next of once(pos)) if (next === pos) { yield pos; return; }
  }
}

function* matchOnce(schema: Schema, p: Particle, kids: Element[], pos: number, a: Assignment): Generator<number> {
  if (p.kind === 'element') {
    if (pos >= kids.length) return;
    const decl = satisfies(schema, p.decl, kids[pos]);
    if (!decl) return;
    a[pos] = decl;
    yield pos + 1;
    a[pos] = undefined;
    return;
  }
  if (p.kind === 'choice') {
    for (const item of p.items) yield* matchParticle(schema, item, kids, pos, a);
    return;
  }
  yield* sequence(schema, p.items, 0, kids, pos, a);
}

function* sequence(schema: Schema, items: Particle[], i: number, kids: Element[], pos: number, a: Assignment): Generator<number> {
  if (i === items.length) {
    yield pos;
    return;
  }
  for (const next of matchParticle(schema, items[i], kids, pos, a)) yield* sequence(schema, items, i + 1, kids, next, a);
}

function firstComplete(ends: Generator<number>, length: number): boolean {
  for (const end of ends) if (end === length) return true;
  return false;
}

/** The first declaration anywhere in a content model that a child satisfies. */
function findDeclaration(schema: Schema, p: Particle, kid: Element): ElementDecl | undefined {
  if (p.kind === 'element') return satisfies(schema, p.decl, kid);
  for (const item of p.items) {
    const d = findDeclaration(schema, item, kid);
    if (d) return d;
  }
  return undefined;
}

function evaluateAssertion(a: { test: string; namespaces: Record<string, string>; xpathDefaultNamespace?: string }, el: Element): boolean {
  const tns = el.ownerDocument?.documentElement?.namespaceURI ?? null;
  const defaultNs =
    a.xpathDefaultNamespace === '##targetNamespace' ? tns
      : a.xpathDefaultNamespace && !a.xpathDefaultNamespace.startsWith('##') ? a.xpathDefaultNamespace
        : null;
  return evaluateXPathToBoolean(a.test, el, null, null, {
    namespaceResolver: (prefix: string) => (prefix === '' ? defaultNs : a.namespaces[prefix] ?? null),
  });
}
