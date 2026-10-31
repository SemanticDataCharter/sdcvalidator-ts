/**
 * ExceptionalValue recovery ("quarantine and tag"), as sdcvalidator's recover() does it: each value
 * with a semantic error keeps its value and gets an ExceptionalValue element beside it, once per
 * value; a value that already carries one is covered by it; an error that cannot be covered is
 * reported, never skipped; a structural error rejects the record.
 */
import type { SdcError } from './validate.js';
import { STRUCTURAL_ELEMENTS } from './validate.js';
import { childElements, clark, Document, Element, localOf, SDC4_NS } from './xml.js';

/** ISO 21090 codes and names, as the reference model and sdcvalidator define them. */
export const EXCEPTIONAL_VALUES: Record<string, string> = {
  INV: 'Invalid', OTH: 'Other', UNC: 'Unencoded', NI: 'No Information', NA: 'Not Applicable',
  UNK: 'Unknown', ASKU: 'Asked but Unknown', ASKR: 'Asked and Refused', NASK: 'Not Asked',
  NAV: 'Not Available', MSK: 'Masked', DER: 'Derived', PINF: 'Positive Infinity',
  NINF: 'Negative Infinity', TRC: 'Trace', QS: 'Sufficient Quantity',
};

const INSERT_AFTER = new Set(['label', 'act']);
const INSERT_BEFORE = new Set(['vtb', 'vte', 'tr', 'modified', 'latitude', 'longitude']);

export interface Recovery {
  path: string;
  code: string;
  name: string;
  /** True if recovery inserted the ExceptionalValue; false if the record already carried one. */
  inserted: boolean;
}

export interface RecoveryResult {
  /** The recovered record (a copy; the source is never changed). */
  record: Document;
  recoveries: Recovery[];
  /** The errors no ExceptionalValue covers. */
  unrecoverable: SdcError[];
  ok: boolean;
}

export class StructuralValidationError extends Error {
  constructor(readonly errors: SdcError[]) {
    super(`${errors.length} structural error(s): ${errors.map((e) => e.path).join(', ')}`);
  }
}

/** Split a Clark path into its steps, keeping namespaces (which contain slashes) whole. */
function steps(path: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === '/') { i++; continue; }
    const start = i;
    if (path[i] === '{') i = path.indexOf('}', i);
    const next = path.indexOf('/', i);
    i = next < 0 ? path.length : next;
    out.push(path.slice(start, i));
  }
  return out;
}

/** The element at a path, taking the first matching child at each step, as the reference does. */
export function findByPath(root: Element, path: string): Element | undefined {
  let parts = steps(path);
  if (parts[0] === clark(root)) parts = parts.slice(1);
  let current: Element | undefined = root;
  for (const part of parts) {
    current = childElements(current).find((c) => clark(c) === part);
    if (!current) return undefined;
  }
  return current;
}

function insertionIndex(parent: Element): number {
  let index = 0;
  const kids = childElements(parent);
  for (let i = 0; i < kids.length; i++) {
    const local = kids[i].localName!;
    if (local in EXCEPTIONAL_VALUES) continue;
    if (INSERT_AFTER.has(local)) index = i + 1;
    else if (INSERT_BEFORE.has(local) || local.endsWith('-value') || local.endsWith('-units')) break;
  }
  return index;
}

/**
 * Recover a record. `errors` are the record's validation errors, in document order; `source` is
 * left unchanged.
 */
export function recover(source: Document, errors: SdcError[]): RecoveryResult {
  const structural = errors.filter((e) => e.tier === 'structural');
  if (structural.length) throw new StructuralValidationError(structural);
  const record = source.cloneNode(true) as Document;
  const root = record.documentElement!;
  const result: RecoveryResult = { record, recoveries: [], unrecoverable: [], ok: true };
  const covered = new Set<Element>();
  for (const e of errors) {
    const target = findByPath(root, e.path);
    const parent = target?.parentNode as Element | undefined;
    if (e.ev === null || !parent || parent.nodeType !== 1) {
      result.unrecoverable.push(e);
      continue;
    }
    if (covered.has(parent)) continue; // a second failure in a value already covered
    const existing = childElements(parent).find((c) => c.localName! in EXCEPTIONAL_VALUES);
    if (existing) {
      const code = existing.localName!;
      result.recoveries.push({ path: e.path, code, name: EXCEPTIONAL_VALUES[code], inserted: false });
    } else if (STRUCTURAL_ELEMENTS.has(localOf(steps(e.path).at(-1)!))) {
      result.unrecoverable.push(e);
      continue;
    } else {
      const ev = record.createElementNS(SDC4_NS, `sdc4:${e.ev}`);
      ev.appendChild(record.createComment(` Validation error: ${e.message} `));
      const evName = record.createElementNS(null, 'ev-name');
      evName.appendChild(record.createTextNode(EXCEPTIONAL_VALUES[e.ev]));
      ev.appendChild(evName);
      const kids = childElements(parent);
      const at = insertionIndex(parent);
      if (at < kids.length) parent.insertBefore(ev, kids[at]);
      else parent.appendChild(ev);
      result.recoveries.push({ path: e.path, code: e.ev, name: EXCEPTIONAL_VALUES[e.ev], inserted: true });
    }
    covered.add(parent);
  }
  result.ok = result.unrecoverable.length === 0;
  return result;
}
