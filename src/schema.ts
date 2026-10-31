/**
 * The subset of XSD 1.1 that SDC4 schemas use, loaded into components the validator walks.
 *
 * Covered: global and local elements (name, ref, type, minOccurs, maxOccurs, fixed, default,
 * nillable, abstract, substitutionGroup); named and anonymous complex types with complexContent
 * restriction or extension, simpleContent, sequence and choice; simple types by restriction (with the
 * enumeration, pattern, length, minLength, maxLength, min/max Inclusive/Exclusive, totalDigits,
 * fractionDigits and whiteSpace facets) and by list; xsd:assert, inherited by derived types; and
 * xsd:include. Anything else an SDC schema never contains is reported by name, never ignored.
 */
import { BUILTINS, WhiteSpace } from './builtins.js';
import { childElements, clarkName, Element, parseXml, XSD_NS } from './xml.js';

export class UnsupportedSchemaError extends Error {}

export interface Facets {
  enumeration?: string[];
  /** One entry per derivation step; a value must match one pattern of every step. */
  patterns: { source: string; regex: RegExp }[][];
  length?: number;
  minLength?: number;
  maxLength?: number;
  minInclusive?: string;
  maxInclusive?: string;
  minExclusive?: string;
  maxExclusive?: string;
  totalDigits?: number;
  fractionDigits?: number;
  whiteSpace?: WhiteSpace;
}

export interface SimpleType {
  kind: 'simple';
  name?: string;
  /** The XSD built-in it derives from, by local name. */
  builtin: string;
  facets: Facets;
  list?: SimpleType;
}

export interface Assertion {
  test: string;
  /** In-scope namespace bindings of the xsd:assert element, for prefixes in the test. */
  namespaces: Record<string, string>;
  xpathDefaultNamespace?: string;
}

export interface ComplexType {
  kind: 'complex';
  name?: string;
  /** The element content model, or null for empty or simple content. */
  content: Particle | null;
  simple?: SimpleType;
  mixed: boolean;
  asserts: Assertion[];
}

export type TypeDef = SimpleType | ComplexType;

export interface ElementDecl {
  name: string;
  global: boolean;
  abstract: boolean;
  nillable: boolean;
  fixed?: string;
  substitutionGroup?: string;
  type: () => TypeDef;
}

export type Particle =
  | { kind: 'element'; decl: ElementDecl; min: number; max: number }
  | { kind: 'sequence' | 'choice'; items: Particle[]; min: number; max: number };

const ANY_TYPE: ComplexType = { kind: 'complex', name: 'anyType', content: null, mixed: true, asserts: [] };

/** Translate an XSD regular expression into a JavaScript one, anchored as XSD patterns implicitly are. */
export function xsdRegex(pattern: string): RegExp {
  let out = '';
  let inClass = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next === 'i') out += inClass ? 'A-Za-z_:' : '[A-Za-z_:]';
      else if (next === 'I') out += '[^A-Za-z_:]';
      else if (next === 'c') out += inClass ? '\\w.:\\-' : '[\\w.:\\-]';
      else if (next === 'C') out += '[^\\w.:\\-]';
      else out += ch + next;
      i++;
      continue;
    }
    if (ch === '[') inClass++;
    else if (ch === ']' && inClass) inClass--;
    else if (!inClass && (ch === '^' || ch === '$')) {
      out += '\\' + ch;
      continue;
    }
    out += ch;
  }
  try {
    return new RegExp(`^(?:${out})$`, 'u');
  } catch {
    return new RegExp(`^(?:${out})$`);
  }
}

function occurs(el: Element, attr: 'minOccurs' | 'maxOccurs'): number {
  const v = el.getAttribute(attr);
  if (!v) return 1;
  return v === 'unbounded' ? Infinity : Number(v);
}

export interface SchemaSource {
  /** The main schema's text. */
  text: string;
  /** Returns the text of a schema named by an xsd:include, by its schemaLocation as written. */
  resolve: (location: string) => string;
}

export class Schema {
  readonly globalElements = new Map<string, Element>();
  private readonly globalTypes = new Map<string, Element>();
  private readonly elementCache = new Map<Element, ElementDecl>();
  private readonly typeCache = new Map<Element, TypeDef>();
  /** Head element name -> names of elements that name it as their substitutionGroup. */
  private readonly substitutes = new Map<string, string[]>();

  constructor(source: SchemaSource) {
    const seen = new Set<string>();
    const load = (text: string, location: string) => {
      if (seen.has(location)) return;
      seen.add(location);
      const root = parseXml(text).documentElement!;
      const tns = root.getAttribute('targetNamespace') || null;
      for (const child of childElements(root)) {
        if (child.namespaceURI !== XSD_NS) continue;
        const name = child.getAttribute('name');
        switch (child.localName) {
          case 'include':
            load(source.resolve(child.getAttribute('schemaLocation')!), child.getAttribute('schemaLocation')!);
            break;
          case 'element': {
            const qn = clarkName(tns, name!);
            this.globalElements.set(qn, child);
            const head = child.getAttribute('substitutionGroup');
            if (head) {
              const headName = this.resolveQName(head, child);
              this.substitutes.set(headName, [...(this.substitutes.get(headName) ?? []), qn]);
            }
            break;
          }
          case 'complexType':
          case 'simpleType':
            this.globalTypes.set(clarkName(tns, name!), child);
            break;
          case 'annotation':
            break;
          default:
            throw new UnsupportedSchemaError(`xsd:${child.localName} at the top level is outside the SDC subset`);
        }
      }
    };
    load(source.text, '');
  }

  resolveQName(qname: string, context: Element): string {
    const i = qname.indexOf(':');
    const prefix = i < 0 ? null : qname.slice(0, i);
    const local = i < 0 ? qname : qname.slice(i + 1);
    const ns = context.lookupNamespaceURI(prefix);
    return clarkName(ns, local);
  }

  element(name: string): ElementDecl | undefined {
    const node = this.globalElements.get(name);
    return node ? this.elementFromNode(node, true) : undefined;
  }

  /** Every element that may appear in place of `head`, the head first, through any chain of substitution groups. */
  substitutionMembers(head: string): string[] {
    const out = [head];
    for (let i = 0; i < out.length; i++) for (const m of this.substitutes.get(out[i]) ?? []) if (!out.includes(m)) out.push(m);
    return out;
  }

  private targetNamespace(el: Element): string | null {
    return el.ownerDocument!.documentElement!.getAttribute('targetNamespace') || null;
  }

  private elementFromNode(node: Element, global: boolean): ElementDecl {
    const cached = this.elementCache.get(node);
    if (cached) return cached;
    const ref = node.getAttribute('ref');
    if (ref) {
      const target = this.globalElements.get(this.resolveQName(ref, node));
      if (!target) throw new UnsupportedSchemaError(`element ref '${ref}' not found`);
      return this.elementFromNode(target, true);
    }
    const schemaRoot = node.ownerDocument!.documentElement!;
    const qualified =
      global || (node.getAttribute('form') || schemaRoot.getAttribute('elementFormDefault')) === 'qualified';
    const name = clarkName(qualified ? this.targetNamespace(node) : null, node.getAttribute('name')!);
    let type: TypeDef | undefined;
    const decl: ElementDecl = {
      name,
      global,
      abstract: node.getAttribute('abstract') === 'true',
      nillable: node.getAttribute('nillable') === 'true',
      fixed: node.hasAttribute('fixed') ? node.getAttribute('fixed')! : undefined,
      substitutionGroup: node.getAttribute('substitutionGroup')
        ? this.resolveQName(node.getAttribute('substitutionGroup')!, node)
        : undefined,
      type: () => (type ??= this.elementType(node)),
    };
    this.elementCache.set(node, decl);
    return decl;
  }

  private elementType(node: Element): TypeDef {
    const typeAttr = node.getAttribute('type');
    if (typeAttr) return this.typeByName(this.resolveQName(typeAttr, node));
    const inline = childElements(node).find((c) => c.localName === 'complexType' || c.localName === 'simpleType');
    if (inline) return this.typeFromNode(inline);
    const head = node.getAttribute('substitutionGroup');
    if (head) {
      const headNode = this.globalElements.get(this.resolveQName(head, node));
      if (headNode) return this.elementType(headNode);
    }
    return ANY_TYPE;
  }

  typeByName(name: string): TypeDef {
    if (name.startsWith(`{${XSD_NS}}`)) {
      const local = name.slice(XSD_NS.length + 2);
      if (local === 'anyType') return ANY_TYPE;
      if (!BUILTINS[local]) throw new UnsupportedSchemaError(`built-in type xsd:${local} is outside the SDC subset`);
      return { kind: 'simple', name: local, builtin: local, facets: { patterns: [] } };
    }
    const node = this.globalTypes.get(name);
    if (!node) throw new UnsupportedSchemaError(`type '${name}' not found`);
    return this.typeFromNode(node);
  }

  private typeFromNode(node: Element): TypeDef {
    const cached = this.typeCache.get(node);
    if (cached) return cached;
    const t = node.localName === 'simpleType' ? this.simpleTypeFromNode(node) : this.complexTypeFromNode(node);
    this.typeCache.set(node, t);
    return t;
  }

  private simpleTypeFromNode(node: Element): SimpleType {
    const name = node.getAttribute('name') ?? undefined;
    const body = childElements(node).find((c) => c.localName !== 'annotation');
    if (!body) throw new UnsupportedSchemaError('empty xsd:simpleType');
    if (body.localName === 'list') {
      const itemAttr = body.getAttribute('itemType');
      const itemNode = childElements(body).find((c) => c.localName === 'simpleType');
      const item = itemAttr ? this.typeByName(this.resolveQName(itemAttr, body)) : this.simpleTypeFromNode(itemNode!);
      if (item.kind !== 'simple') throw new UnsupportedSchemaError('list of a complex type');
      return { kind: 'simple', name, builtin: 'token', facets: { patterns: [] }, list: item };
    }
    if (body.localName !== 'restriction') throw new UnsupportedSchemaError(`xsd:${body.localName} in a simpleType is outside the SDC subset`);
    return this.restrictSimple(body, name);
  }

  /** A simple type derived by restriction from the base the element names, with its facets added. */
  private restrictSimple(restriction: Element, name?: string): SimpleType {
    const baseAttr = restriction.getAttribute('base');
    const inlineBase = childElements(restriction).find((c) => c.localName === 'simpleType');
    const base = baseAttr ? this.typeByName(this.resolveQName(baseAttr, restriction)) : this.simpleTypeFromNode(inlineBase!);
    const baseSimple = base.kind === 'simple' ? base : base.simple;
    if (!baseSimple) throw new UnsupportedSchemaError('simple restriction of a complex type without simple content');
    const facets: Facets = { ...baseSimple.facets, patterns: [...baseSimple.facets.patterns] };
    const enumeration: string[] = [];
    const patterns: { source: string; regex: RegExp }[] = [];
    for (const f of childElements(restriction)) {
      const value = f.getAttribute('value') ?? '';
      switch (f.localName) {
        case 'enumeration': enumeration.push(value); break;
        case 'pattern': patterns.push({ source: value, regex: xsdRegex(value) }); break;
        case 'length': facets.length = Number(value); break;
        case 'minLength': facets.minLength = Number(value); break;
        case 'maxLength': facets.maxLength = Number(value); break;
        case 'minInclusive': facets.minInclusive = value; break;
        case 'maxInclusive': facets.maxInclusive = value; break;
        case 'minExclusive': facets.minExclusive = value; break;
        case 'maxExclusive': facets.maxExclusive = value; break;
        case 'totalDigits': facets.totalDigits = Number(value); break;
        case 'fractionDigits': facets.fractionDigits = Number(value); break;
        case 'whiteSpace': facets.whiteSpace = value as WhiteSpace; break;
        case 'annotation': case 'simpleType': case 'attribute': case 'sequence': case 'choice': case 'assert': break;
        default: throw new UnsupportedSchemaError(`facet xsd:${f.localName} is outside the SDC subset`);
      }
    }
    if (enumeration.length) facets.enumeration = enumeration;
    if (patterns.length) facets.patterns.push(patterns);
    return { kind: 'simple', name, builtin: baseSimple.builtin, facets, list: baseSimple.list };
  }

  private complexTypeFromNode(node: Element): ComplexType {
    const name = node.getAttribute('name') ?? undefined;
    const type: ComplexType = { kind: 'complex', name, content: null, mixed: node.getAttribute('mixed') === 'true', asserts: [] };
    // Cache before resolving bases, so recursive references terminate.
    this.typeCache.set(node, type);
    for (const child of childElements(node)) {
      switch (child.localName) {
        case 'annotation': case 'attribute': case 'anyAttribute': break;
        case 'sequence': case 'choice': type.content = this.particle(child); break;
        case 'assert': type.asserts.push(this.assertion(child)); break;
        case 'complexContent': this.derive(type, child, false); break;
        case 'simpleContent': this.derive(type, child, true); break;
        default: throw new UnsupportedSchemaError(`xsd:${child.localName} in a complexType is outside the SDC subset`);
      }
    }
    return type;
  }

  private derive(type: ComplexType, contentNode: Element, simpleContent: boolean) {
    if (contentNode.getAttribute('mixed') === 'true') type.mixed = true;
    const derivation = childElements(contentNode).find((c) => c.localName === 'restriction' || c.localName === 'extension');
    if (!derivation) throw new UnsupportedSchemaError('complex content without restriction or extension');
    const base = this.typeByName(this.resolveQName(derivation.getAttribute('base')!, derivation));
    // XSD 1.1: a derived type's assertions include its base type's.
    if (base.kind === 'complex') type.asserts.push(...base.asserts);
    let own: Particle | null = null;
    for (const c of childElements(derivation)) {
      if (c.localName === 'sequence' || c.localName === 'choice') own = this.particle(c);
      else if (c.localName === 'assert') type.asserts.push(this.assertion(c));
    }
    if (simpleContent) {
      type.simple = derivation.localName === 'restriction'
        ? this.restrictSimple(derivation)
        : base.kind === 'simple' ? base : base.simple;
      return;
    }
    if (derivation.localName === 'restriction') {
      // A restriction restates its whole content model.
      type.content = own;
    } else {
      const baseContent = base.kind === 'complex' ? base.content : null;
      type.content = baseContent && own
        ? { kind: 'sequence', items: [baseContent, own], min: 1, max: 1 }
        : (own ?? baseContent);
      if (base.kind === 'complex' && base.mixed) type.mixed = true;
    }
  }

  private particle(node: Element): Particle {
    const min = occurs(node, 'minOccurs');
    const max = occurs(node, 'maxOccurs');
    if (node.localName === 'element') return { kind: 'element', decl: this.elementFromNode(node, false), min, max };
    if (node.localName === 'sequence' || node.localName === 'choice') {
      const items = childElements(node).filter((c) => c.localName !== 'annotation').map((c) => this.particle(c));
      return { kind: node.localName, items, min, max };
    }
    throw new UnsupportedSchemaError(`xsd:${node.localName} in a content model is outside the SDC subset`);
  }

  private assertion(node: Element): Assertion {
    const namespaces: Record<string, string> = {};
    for (let n: Element | null = node; n && n.nodeType === 1; n = n.parentNode as Element | null) {
      const attrs = n.attributes;
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs.item(i)!;
        if (a.name.startsWith('xmlns:') && !(a.name.slice(6) in namespaces)) namespaces[a.name.slice(6)] = a.value;
      }
    }
    const xdn = node.getAttribute('xpathDefaultNamespace') ?? undefined;
    return { test: node.getAttribute('test')!, namespaces, xpathDefaultNamespace: xdn };
  }
}
