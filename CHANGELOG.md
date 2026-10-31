# Changelog

## [Unreleased]

### Added

- **`SDC4Validator`**: validates Governed Data Records against SDC4 models (the XSD 1.1 subset SDC
  schemas use) and recovers semantic errors with ExceptionalValues, as sdcvalidator 4.6.1 does.
- Passes all 120 cases of sdcvalidator's conformance suite (2026-10-31). The same results in Node 24,
  Deno (Supabase Edge Runtime 1.77.8) and Chromium 152.

### Not yet covered by the suite

The suite's models contain no failing assertions, no length or range facets in its broken cases, and
no lists. Those paths are implemented but not yet compared against the reference.
