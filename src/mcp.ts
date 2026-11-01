/**
 * MCP server exposing sdcvalidator-ts to any agent framework (Node only: it reads files).
 *
 * A raw JSON-RPC 2.0 stdio server, one JSON object per line, with no MCP SDK dependency, as
 * sdcvalidator's own server is built. Tools:
 * - validate_instance: pass or fail, with error counts;
 * - validate_and_report: every error, by path, tier and ExceptionalValue code;
 * - recover_instance: the recovered record, with each value covered;
 * - check_schema_compliance: whether a schema follows SDC4 principles (restriction, never extension).
 *
 * A model's xsd:include of the reference model is fetched from its URL once and cached, or read from
 * `reference_path` when given (offline use).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { SDC4Validator, StructuralValidationError } from './index.js';
import { childElements, parseXml, XSD_NS } from './xml.js';

export const SERVER_NAME = 'sdcvalidator-ts';
export const SERVER_VERSION = '4.0.1';
const PROTOCOL_VERSION = '2024-11-05';

type Args = Record<string, unknown>;

const pathProperty = (description: string) => ({ type: 'string', description });
const schemaArgs = {
  schema_path: pathProperty('Path to the SDC4 data model XSD file.'),
  instance_path: pathProperty('Path to the XML instance (Governed Data Record) to validate.'),
  reference_path: pathProperty(
    'Optional path to a local copy of the SDC4 reference model (sdc4.xsd). Without it the model\'s include is fetched from its URL.',
  ),
};

export const TOOLS = [
  {
    name: 'validate_instance',
    description: 'Validate an XML instance against its SDC4 XSD schema. Returns pass or fail with error counts.',
    inputSchema: { type: 'object', properties: schemaArgs, required: ['schema_path', 'instance_path'] },
  },
  {
    name: 'validate_and_report',
    description:
      'Validate an XML instance and report every error: its path, its tier (structural or semantic), the constraint that failed, and the ExceptionalValue code recovery would use.',
    inputSchema: { type: 'object', properties: schemaArgs, required: ['schema_path', 'instance_path'] },
  },
  {
    name: 'recover_instance',
    description:
      'Recover an XML instance: each value with a semantic error keeps its value and is tagged with an ISO 21090 ExceptionalValue. Returns the recovered record and each value covered; a record with structural errors is rejected.',
    inputSchema: { type: 'object', properties: schemaArgs, required: ['schema_path', 'instance_path'] },
  },
  {
    name: 'check_schema_compliance',
    description: 'Check whether an XSD schema follows SDC4 principles (restriction only, no xsd:extension). Does not validate instances.',
    inputSchema: { type: 'object', properties: { schema_path: schemaArgs.schema_path }, required: ['schema_path'] },
  },
];

const includeCache = new Map<string, string>();
const validators = new Map<string, SDC4Validator>();

function str(args: Args, name: string): string {
  const v = args[name];
  if (typeof v !== 'string' || !v) throw new Error(`${name} is required and must be a string`);
  return v;
}

/** Every xsd:include location in a schema text. */
function includes(text: string): string[] {
  const root = parseXml(text).documentElement!;
  return childElements(root)
    .filter((c) => c.namespaceURI === XSD_NS && c.localName === 'include')
    .map((c) => c.getAttribute('schemaLocation')!)
    .filter(Boolean);
}

/** Read or fetch each include once, before the synchronous schema load needs it. */
async function loadIncludes(text: string, base: string, referencePath?: string): Promise<void> {
  for (const location of includes(text)) {
    if (includeCache.has(location)) continue;
    let content: string;
    if (/^https?:\/\//.test(location)) {
      if (referencePath && location.endsWith('/sdc4.xsd')) content = readFileSync(referencePath, 'utf8');
      else {
        const response = await fetch(location);
        if (!response.ok) throw new Error(`could not fetch ${location}: HTTP ${response.status}`);
        content = await response.text();
      }
    } else {
      content = readFileSync(resolvePath(base, location), 'utf8');
    }
    includeCache.set(location, content);
    await loadIncludes(content, base, referencePath);
  }
}

async function validatorFor(args: Args): Promise<SDC4Validator> {
  const schemaPath = resolvePath(str(args, 'schema_path'));
  const referencePath = typeof args.reference_path === 'string' ? args.reference_path : undefined;
  const key = `${schemaPath}\n${referencePath ?? ''}`;
  let v = validators.get(key);
  if (!v) {
    const text = readFileSync(schemaPath, 'utf8');
    await loadIncludes(text, dirname(schemaPath), referencePath);
    v = new SDC4Validator({
      text,
      resolve: (location) => {
        const included = includeCache.get(location);
        if (included === undefined) throw new Error(`include ${location} was not loaded`);
        return included;
      },
    });
    validators.set(key, v);
  }
  return v;
}

const errorSummary = (e: { path: string; tier: string; kind: string; constraint?: string; ev: string | null; message: string }) => ({
  path: e.path, tier: e.tier, kind: e.kind, constraint: e.constraint ?? null, exceptional_value: e.ev, message: e.message,
});

export const HANDLERS: Record<string, (args: Args) => Promise<unknown>> = {
  async validate_instance(args) {
    const r = (await validatorFor(args)).validate(readFileSync(str(args, 'instance_path'), 'utf8'));
    return {
      valid: r.valid,
      error_count: r.structural.length + r.semantic.length,
      structural_error_count: r.structural.length,
      semantic_error_count: r.semantic.length,
    };
  },
  async validate_and_report(args) {
    const r = (await validatorFor(args)).validate(readFileSync(str(args, 'instance_path'), 'utf8'));
    return {
      valid: r.valid,
      error_count: r.structural.length + r.semantic.length,
      structural_errors: r.structural.map(errorSummary),
      semantic_errors: r.semantic.map(errorSummary),
    };
  },
  async recover_instance(args) {
    const v = await validatorFor(args);
    try {
      const r = v.recover(readFileSync(str(args, 'instance_path'), 'utf8'));
      return { ok: r.ok, recoveries: r.recoveries, unrecoverable: r.unrecoverable.map(errorSummary), recovered_record: r.text };
    } catch (e) {
      if (e instanceof StructuralValidationError) {
        return { ok: false, rejected: 'structural', structural_errors: e.errors.map(errorSummary) };
      }
      throw e;
    }
  },
  async check_schema_compliance(args) {
    const root = parseXml(readFileSync(str(args, 'schema_path'), 'utf8')).documentElement!;
    const errors: string[] = [];
    const walk = (el: typeof root) => {
      for (const c of childElements(el)) {
        if (c.namespaceURI === XSD_NS && c.localName === 'extension') {
          errors.push(`xsd:extension of '${c.getAttribute('base')}': SDC4 models derive by restriction only`);
        }
        walk(c);
      }
    };
    walk(root);
    return { compliant: errors.length === 0, errors };
  },
};

type Request = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

const response = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const failure = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** Answer one JSON-RPC request; null for a notification. Every malformed shape gets -32600, never a crash. */
export async function handle(request: unknown): Promise<object | null> {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return failure(null, -32600, 'Invalid Request: a JSON-RPC request is an object');
  }
  const { id = null, method = '', params = {} } = request as Request;
  if (!(typeof id === 'string' || typeof id === 'number' || id === null)) {
    return failure(null, -32600, 'Invalid Request: id must be a string, a number or null');
  }
  if (typeof method !== 'string') return failure(id, -32600, 'Invalid Request: method must be a string');
  const p = params ?? {};
  if (typeof p !== 'object' || Array.isArray(p)) return failure(id, -32600, 'Invalid Request: params must be an object');

  switch (method) {
    case 'initialize':
      return response(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'SDC4 validation in TypeScript, conforming to sdcvalidator. Validates Governed Data Records against their SDC4 models with two-tier error classification, and recovers semantic errors with ExceptionalValues.',
      });
    case 'notifications/initialized':
      return null;
    case 'ping':
      return response(id, {});
    case 'tools/list':
      return response(id, { tools: TOOLS });
    case 'tools/call': {
      const { name, arguments: args = {} } = p as { name?: unknown; arguments?: unknown };
      const a = args ?? {};
      if (typeof name !== 'string' || typeof a !== 'object' || Array.isArray(a)) {
        return failure(id, -32602, 'Invalid params: name must be a string and arguments an object');
      }
      const handler = HANDLERS[name];
      if (!handler) return failure(id, -32601, `Unknown tool: ${name}`);
      try {
        const result = await handler(a as Args);
        return response(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (e) {
        return failure(id, -32000, `Tool execution error: ${(e as Error).message}`);
      }
    }
    default:
      return id === null ? null : failure(id, -32601, `Method not found: ${method}`);
  }
}

/** Run the server on stdio until stdin closes. */
export async function runStdio(): Promise<void> {
  const { createInterface } = await import('node:readline');
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch (e) {
      process.stdout.write(JSON.stringify(failure(null, -32700, `Parse error: ${(e as Error).message}`)) + '\n');
      continue;
    }
    const out = await handle(request);
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  }
}
