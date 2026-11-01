# Changelog

## [Unreleased]

### Fixed

- `server.json`'s description fits the MCP registry's 100-character limit, so 4.0.0 can be
  registered; a test now checks the limit before a tag publishes. A manual `MCP registry` workflow
  publishes `server.json` for a version already on npm.

## [4.0.0] - 2026-11-01

### Added

- **`SDC4Validator`**: validates Governed Data Records against SDC4 models (the XSD 1.1 subset SDC
  schemas use) and recovers semantic errors with ExceptionalValues, as sdcvalidator does.
- Conforms to sdcvalidator 4.6.3: passes all 151 cases of its conformance suite, including the
  length, range, pattern and assertion cases 4.6.3 added. CI runs that release's suite, pinned by tag.
- ExceptionalValue codes as sdcvalidator 4.6.3 maps them: `OTH` for enumerations, `INV` for every other
  facet, fixed values and assertions, `NA` for stray character data.
- **An MCP server** (`npx sdcvalidator-ts mcp`): `validate_instance`, `validate_and_report`,
  `recover_instance` and `check_schema_compliance`, over JSON-RPC 2.0 on stdio, as sdcvalidator's
  own server is built. Registered as `io.github.SemanticDataCharter/sdcvalidator-ts`.
- Runs in Node, Deno and browsers: the same results in Node 24, Deno (Supabase Edge Runtime 1.77.8)
  and Chromium 152 (checked 2026-10-31; CI runs the suite on Node 20, 22 and 24).

### Not yet covered by the suite

Lists, minLength and exclusive-range facets: the suite's models give no case for them. Those paths
are implemented but not yet compared against the reference.
