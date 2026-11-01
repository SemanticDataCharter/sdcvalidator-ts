# sdcvalidator-ts

SDC4 validation in TypeScript. It validates Governed Data Records against their published SDC4 models
and recovers semantic errors with ISO 21090 ExceptionalValues, giving the same results as
[sdcvalidator](https://github.com/SemanticDataCharter/sdcvalidator), the reference implementation,
on its conformance suite.

**Conforms to:** sdcvalidator **4.6.3** (all 151 cases of
[its conformance suite](https://github.com/SemanticDataCharter/sdcvalidator/tree/v4.6.3/conformance)).
CI runs that release's suite, pinned by tag.

It runs in Node (20 or later), Deno (including Supabase Edge Functions) and browsers. You supply the
model and record text, so it reads no files and makes no network requests.

```ts
import { SDC4Validator, REFERENCE_MODEL_URL } from 'sdcvalidator-ts';

const validator = new SDC4Validator({
  text: modelXsd,                       // the model's published XSD
  resolve: (location) => sdc4Xsd,       // the reference model it includes (REFERENCE_MODEL_URL)
});

const result = validator.validate(recordXml);
// { valid, structural: [...], semantic: [{ path, ev, kind, constraint, message }, ...] }

const recovered = validator.recover(recordXml);
// { ok, recoveries: [{ path, code, name, inserted }], unrecoverable: [...], record, text }
// Throws StructuralValidationError if the record has structural errors.
```

## MCP server

The package includes an MCP server, so agents can call it directly. It speaks JSON-RPC 2.0 over stdio and runs on Node; it reads the files you name.

```bash
npx sdcvalidator-ts mcp
```

| Tool | What it does |
|---|---|
| `validate_instance` | Pass or fail, with error counts |
| `validate_and_report` | Every error: path, tier, the constraint that failed, the ExceptionalValue code |
| `recover_instance` | The recovered record and each value covered; a structural error rejects it |
| `check_schema_compliance` | Whether a schema follows SDC4 principles: restriction, never extension |

Each tool takes `schema_path` and `instance_path` (except the compliance check, which takes only the
schema), plus an optional `reference_path`. The model's `xsd:include` of the reference model is
fetched from its URL once and cached. With `reference_path`, it is read from that local copy instead,
so the server works offline.

It is registered in the MCP registry as `io.github.SemanticDataCharter/sdcvalidator-ts`.

## What "the same results" means

The [conformance suite](https://github.com/SemanticDataCharter/sdcvalidator/tree/v4.6.3/conformance)
compares, for every case:
- the verdict;
- structural and semantic errors by path;
- the ExceptionalValue code for each semantic error;
- the recovery outcome;
- the recovered record, compared as a tree with comments ignored.

Error messages are not compared. Errors are classified by the constraint that failed, never by
message wording.

The ExceptionalValue codes are the reference's (sdcvalidator 4.6.3):
- **`OTH`:** a value outside its enumeration.
- **`INV`:** a value that is not of its type, or that breaks any other facet (pattern, length, range,
  digits, a built-in type's own range), a fixed value or an assertion.
- **`NA`:** character data where only elements are allowed.
- **No code:** an error on a structural element (`label`, `vtb`, `vte`, ...). It cannot be recovered.

When sdcvalidator's mapping changes, the suite's expectations change, and this library follows before
its next release.

## The XSD subset

SDC4 schemas use a narrow part of XSD 1.1, and this library implements that part:
- **Elements:** global and local, with `ref`, occurrence, `fixed`, `abstract` and substitution groups.
- **Complex types:** complex and simple content, restriction and extension, sequence and choice.
- **Simple types:** restriction (with the enumeration, pattern, length, range, digits and whiteSpace
  facets) and list; about forty built-in types.
- **`xsd:assert`:** evaluated with fontoxpath, inherited by derived types.
- **`xsd:include`.**

A construct outside the subset raises `UnsupportedSchemaError` naming it. It is never ignored.

DOCTYPE and entity declarations are refused before parsing, so no external entity is ever resolved.

## Reading a model

The schema reader the validator uses is exported, for tools that generate from a published model:

```ts
import { Schema, SDC4_NS } from 'sdcvalidator-ts';

const schema = new Schema({ text: modelXsd, resolve: () => sdc4Xsd });
const root = schema.element(`{${SDC4_NS}}dm-${ctId}`);
// root.type().content: the model's particles, each with its element, minOccurs and maxOccurs.
// A component's ComplexType carries `base` (the reference-model type it restricts) and `appinfo`
// (its rdf:Description: label, semantic links).
```

## Development

```bash
npm install
npm run typecheck
npm test     # needs the conformance suite: a sibling sdcvalidator checkout, or CONFORMANCE_DIR
npm run build
```

Dependencies are pinned exactly: `@xmldom/xmldom` 0.9.12 (parsing) and `fontoxpath` 3.34.0
(XPath 3.1, for assertions).

## License

Apache-2.0.
