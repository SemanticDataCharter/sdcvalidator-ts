/**
 * XSD built-in datatypes: whitespace handling, the lexical check, and the facets a built-in type
 * carries itself (a nonNegativeInteger is an integer that must be non-negative).
 *
 * The split matters for conformance: sdcvalidator maps a value that is not lexically of its type to
 * INV, and a value that is of its type but breaks a facet (the built-in's own included) to NI.
 */

export type WhiteSpace = 'preserve' | 'replace' | 'collapse';

export interface Builtin {
  /** The primitive it is derived from, for comparing values against range facets. */
  primitive: 'string' | 'decimal' | 'float' | 'boolean' | 'temporal' | 'other';
  whiteSpace: WhiteSpace;
  /** True if the (whitespace-normalized) text is in the lexical space. */
  lexical: (v: string) => boolean;
  /** Built-in facets, checked after the lexical check: returns a failure kind or null. */
  facet?: (v: string) => string | null;
}

const re = (r: RegExp) => (v: string) => r.test(v);

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const INTEGER = /^[+-]?\d+$/;
const FLOAT = /^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|[+-]?INF|NaN)$/;
const LANGUAGE = /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/;
const NCNAME = /^[A-Za-z_À-￿][\w.\-·À-￿]*$/;
const NAME = /^[A-Za-z_:À-￿][\w.:\-·À-￿]*$/;
const TZ = '(Z|[+-]\\d{2}:\\d{2})?';

function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function tzOk(tz: string | undefined): boolean {
  if (!tz || tz === 'Z') return true;
  const [h, m] = tz.slice(1).split(':').map(Number);
  return m <= 59 && (h < 14 || (h === 14 && m === 0));
}

function dateOk(y: string, mo: string, d: string): boolean {
  const year = Number(y), month = Number(mo), day = Number(d);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
}

function timeOk(h: string, mi: string, s: string): boolean {
  const hour = Number(h), min = Number(mi), sec = Number(s);
  if (hour === 24) return min === 0 && sec === 0;
  return hour <= 23 && min <= 59 && sec < 60;
}

const DATE_RE = new RegExp(`^(-?\\d{4,})-(\\d{2})-(\\d{2})${TZ}$`);
const TIME_RE = new RegExp(`^(\\d{2}):(\\d{2}):(\\d{2}(?:\\.\\d+)?)${TZ}$`);
const DATETIME_RE = new RegExp(`^(-?\\d{4,})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2}(?:\\.\\d+)?)${TZ}$`);

const date = (v: string) => {
  const m = DATE_RE.exec(v);
  return !!m && dateOk(m[1], m[2], m[3]) && tzOk(m[4]);
};
const time = (v: string) => {
  const m = TIME_RE.exec(v);
  return !!m && timeOk(m[1], m[2], m[3]) && tzOk(m[4]);
};
const dateTime = (v: string) => {
  const m = DATETIME_RE.exec(v);
  return !!m && dateOk(m[1], m[2], m[3]) && timeOk(m[4], m[5], m[6]) && tzOk(m[7]);
};

function integerRange(min: bigint | null, max: bigint | null, failure: string) {
  return (v: string) => {
    const n = BigInt(v.replace(/^\+/, ''));
    return (min !== null && n < min) || (max !== null && n > max) ? failure : null;
  };
}

const str = (lexical: (v: string) => boolean = () => true, whiteSpace: WhiteSpace = 'preserve'): Builtin => ({
  primitive: 'string', whiteSpace, lexical,
});
const integer = (facet?: (v: string) => string | null): Builtin => ({
  primitive: 'decimal', whiteSpace: 'collapse', lexical: re(INTEGER), facet,
});
const temporal = (lexical: (v: string) => boolean): Builtin => ({ primitive: 'temporal', whiteSpace: 'collapse', lexical });

export const BUILTINS: Record<string, Builtin> = {
  anyType: str(),
  anySimpleType: str(),
  anyAtomicType: str(),
  string: str(),
  normalizedString: str(() => true, 'replace'),
  token: str(() => true, 'collapse'),
  language: { primitive: 'string', whiteSpace: 'collapse', lexical: () => true, facet: (v) => (LANGUAGE.test(v) ? null : 'pattern') },
  Name: { primitive: 'string', whiteSpace: 'collapse', lexical: () => true, facet: (v) => (NAME.test(v) ? null : 'pattern') },
  NCName: { primitive: 'string', whiteSpace: 'collapse', lexical: () => true, facet: (v) => (NCNAME.test(v) ? null : 'pattern') },
  ID: { primitive: 'string', whiteSpace: 'collapse', lexical: () => true, facet: (v) => (NCNAME.test(v) ? null : 'pattern') },
  IDREF: { primitive: 'string', whiteSpace: 'collapse', lexical: () => true, facet: (v) => (NCNAME.test(v) ? null : 'pattern') },
  NMTOKEN: str(re(/^[\w.:\-·À-￿]+$/), 'collapse'),
  anyURI: str(() => true, 'collapse'),
  QName: str(re(/^([A-Za-z_][\w.\-]*:)?[A-Za-z_][\w.\-]*$/), 'collapse'),
  boolean: { primitive: 'boolean', whiteSpace: 'collapse', lexical: re(/^(true|false|1|0)$/) },
  decimal: { primitive: 'decimal', whiteSpace: 'collapse', lexical: re(DECIMAL) },
  float: { primitive: 'float', whiteSpace: 'collapse', lexical: re(FLOAT) },
  double: { primitive: 'float', whiteSpace: 'collapse', lexical: re(FLOAT) },
  integer: integer(),
  nonNegativeInteger: integer(integerRange(0n, null, 'range')),
  positiveInteger: integer(integerRange(1n, null, 'range')),
  nonPositiveInteger: integer(integerRange(null, 0n, 'range')),
  negativeInteger: integer(integerRange(null, -1n, 'range')),
  long: integer(integerRange(-(2n ** 63n), 2n ** 63n - 1n, 'range')),
  int: integer(integerRange(-(2n ** 31n), 2n ** 31n - 1n, 'range')),
  short: integer(integerRange(-32768n, 32767n, 'range')),
  byte: integer(integerRange(-128n, 127n, 'range')),
  unsignedLong: integer(integerRange(0n, 2n ** 64n - 1n, 'range')),
  unsignedInt: integer(integerRange(0n, 2n ** 32n - 1n, 'range')),
  unsignedShort: integer(integerRange(0n, 65535n, 'range')),
  unsignedByte: integer(integerRange(0n, 255n, 'range')),
  date: temporal(date),
  time: temporal(time),
  dateTime: temporal(dateTime),
  dateTimeStamp: temporal((v) => dateTime(v) && /(Z|[+-]\d{2}:\d{2})$/.test(v)),
  duration: temporal(re(/^-?P(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/)),
  gYear: temporal((v) => new RegExp(`^-?\\d{4,}${TZ}$`).test(v)),
  gYearMonth: temporal((v) => {
    const m = new RegExp(`^-?\\d{4,}-(\\d{2})${TZ}$`).exec(v);
    return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 12;
  }),
  gMonth: temporal((v) => {
    const m = new RegExp(`^--(\\d{2})${TZ}$`).exec(v);
    return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 12;
  }),
  gMonthDay: temporal((v) => {
    const m = new RegExp(`^--(\\d{2})-(\\d{2})${TZ}$`).exec(v);
    return !!m && dateOk('2000', m[1], m[2]);
  }),
  gDay: temporal((v) => {
    const m = new RegExp(`^---(\\d{2})${TZ}$`).exec(v);
    return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 31;
  }),
  base64Binary: str(re(/^([A-Za-z0-9+/]\s?){0,}(=\s?){0,2}$/), 'collapse'),
  hexBinary: str(re(/^([0-9A-Fa-f]{2})*$/), 'collapse'),
};

export function normalizeWhiteSpace(v: string, ws: WhiteSpace): string {
  if (ws === 'preserve') return v;
  const replaced = v.replace(/[\t\n\r]/g, ' ');
  return ws === 'replace' ? replaced : replaced.replace(/ +/g, ' ').trim();
}

/** Compare two decimal strings: -1, 0 or 1. Exact, with no floating point. */
export function compareDecimal(a: string, b: string): number {
  const norm = (s: string) => {
    let neg = s.startsWith('-');
    s = s.replace(/^[+-]/, '');
    let [i, f = ''] = s.split('.');
    i = i.replace(/^0+/, '') || '0';
    f = f.replace(/0+$/, '');
    if (i === '0' && !f) neg = false;
    return { neg, i, f };
  };
  const x = norm(a), y = norm(b);
  if (x.neg !== y.neg) return x.neg ? -1 : 1;
  const sign = x.neg ? -1 : 1;
  if (x.i.length !== y.i.length) return (x.i.length < y.i.length ? -1 : 1) * sign;
  if (x.i !== y.i) return (x.i < y.i ? -1 : 1) * sign;
  const len = Math.max(x.f.length, y.f.length);
  const xf = x.f.padEnd(len, '0'), yf = y.f.padEnd(len, '0');
  return xf === yf ? 0 : (xf < yf ? -1 : 1) * sign;
}

/** Digits of a decimal: total significant digits and fraction digits. */
export function decimalDigits(v: string): { total: number; fraction: number } {
  const s = v.replace(/^[+-]/, '');
  let [i, f = ''] = s.split('.');
  f = f.replace(/0+$/, '');
  i = i.replace(/^0+/, '');
  return { total: Math.max(1, i.length + f.length), fraction: f.length };
}
