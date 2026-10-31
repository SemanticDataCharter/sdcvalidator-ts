# sdcvalidator-ts

SDC4 validation in TypeScript. It validates Governed Data Records against their published SDC4 models
and recovers semantic errors with ISO 21090 ExceptionalValues, giving the same results as
[sdcvalidator](https://github.com/SemanticDataCharter/sdcvalidator), the reference implementation,
on its conformance suite.

**Conforms to:** sdcvalidator **4.6.2** (all 120 cases of
[its conformance suite](https://github.com/SemanticDataCharter/sdcvalidator/tree/v4.6.2/conformance)).
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

## What "the same results" means

The [conformance suite](https://github.com/SemanticDataCharter/sdcvalidator/tree/v4.6.2/conformance)
compares, for every case:
- the verdict;
- structural and semantic errors by path;
- the ExceptionalValue code for each semantic error;
- the recovery outcome;
- the recovered record, compared as a tree with comments ignored.

Error messages are not compared. Errors are classified by the constraint that failed, never by
message wording.

The ExceptionalValue mapping follows the reference as the suite records it today:
- **`INV`:** a value that is not lexically of its type.
- **`NI`:** every facet, fixed-value and assertion failure.
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
