import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document, Element, Node } from '@xmldom/xmldom';

export type { Document, Element, Node };

export const XSD_NS = 'http://www.w3.org/2001/XMLSchema';
export const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
export const SDC4_NS = 'https://semanticdatacharter.com/ns/sdc4/';

export class XmlParseError extends Error {}

/**
 * Parse XML text. A DOCTYPE or entity declaration is refused before parsing, so no external entity
 * is ever resolved; text that is not well-formed raises XmlParseError.
 */
export function parseXml(text: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new XmlParseError('DOCTYPE or entity declaration refused');
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') errors.push(message);
    },
  }).parseFromString(text, 'text/xml');
  if (errors.length || !doc.documentElement) throw new XmlParseError(errors[0] ?? 'no root element');
  return doc;
}

export function serializeXml(node: Node): string {
  return new XMLSerializer().serializeToString(node);
}

export function childElements(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}

/** Concatenated text of an element's direct text and CDATA children. */
export function directText(el: Element): string {
  let s = '';
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 || n.nodeType === 4) s += n.nodeValue ?? '';
  return s;
}

/** Clark notation, as sdcvalidator reports paths: `{namespace}local`, or `local` with no namespace. */
export function clark(el: Element): string {
  return el.namespaceURI ? `{${el.namespaceURI}}${el.localName}` : (el.localName ?? el.nodeName);
}

export function clarkName(ns: string | null | undefined, local: string): string {
  return ns ? `{${ns}}${local}` : local;
}

export function localOf(clarkName: string): string {
  const i = clarkName.lastIndexOf('}');
  return i < 0 ? clarkName : clarkName.slice(i + 1);
}
