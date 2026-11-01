/**
 * sdcvalidator-ts: SDC4 validation in TypeScript.
 *
 * Validates Governed Data Records against their published SDC4 models and recovers semantic errors
 * with ExceptionalValues, giving the results sdcvalidator (the reference implementation) gives on its
 * conformance suite. Runs in Node, Deno and browsers: the caller supplies the schema and record text.
 */
import { recover, RecoveryResult } from './recover.js';
import { Schema, SchemaSource } from './schema.js';
import { SdcError, Validator } from './validate.js';
import { Document, parseXml, serializeXml } from './xml.js';

export { EXCEPTIONAL_VALUES, findByPath, StructuralValidationError } from './recover.js';
export type { Recovery, RecoveryResult } from './recover.js';
export { Schema, UnsupportedSchemaError, xsdRegex } from './schema.js';
export type { Assertion, ComplexType, ElementDecl, Facets, Particle, SchemaSource, SimpleType, TypeDef } from './schema.js';
export { STRUCTURAL_ELEMENTS } from './validate.js';
export type { ErrorKind, SdcError } from './validate.js';
export { childElements, clarkName, parseXml, serializeXml, SDC4_NS, XmlParseError, XSD_NS } from './xml.js';
export type { Document, Element } from './xml.js';

export interface ValidationResult {
  valid: boolean;
  structural: SdcError[];
  semantic: SdcError[];
}

/** The reference model's published location, which every SDC4 model's XSD includes. */
export const REFERENCE_MODEL_URL = 'https://semanticdatacharter.com/ns/sdc4/sdc4.xsd';

export class SDC4Validator {
  private readonly validator: Validator;

  /**
   * Load a model. `resolve` returns the text of each included schema by its location, so the caller
   * decides where the reference model comes from (a bundled copy, a fetch, a file).
   */
  constructor(source: SchemaSource) {
    this.validator = new Validator(new Schema(source));
  }

  private errors(record: string | Document): { doc: Document; errors: SdcError[] } {
    const doc = typeof record === 'string' ? parseXml(record) : record;
    return { doc, errors: this.validator.validate(doc.documentElement!) };
  }

  validate(record: string | Document): ValidationResult {
    const { errors } = this.errors(record);
    return {
      valid: errors.length === 0,
      structural: errors.filter((e) => e.tier === 'structural'),
      semantic: errors.filter((e) => e.tier === 'semantic'),
    };
  }

  /** Recover a record; throws StructuralValidationError if it has structural errors. */
  recover(record: string | Document): RecoveryResult & { text: string } {
    const { doc, errors } = this.errors(record);
    const result = recover(doc, errors);
    return { ...result, text: serializeXml(result.record) };
  }
}
