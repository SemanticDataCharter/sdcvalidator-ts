# Changelog

## [Unreleased]

### Added

- **`SDC4Validator`**: validates Governed Data Records against SDC4 models (the XSD 1.1 subset SDC
  schemas use) and recovers semantic errors with ExceptionalValues, as sdcvalidator does.
- Conforms to sdcvalidator 4.6.3: passes all 151 cases of its conformance suite, including the
  length, range, pattern and assertion cases 4.6.3 added. CI runs that release's suite, pinned by tag.
- ExceptionalValue codes as sdcvalidator 4.6.3 maps them: `OTH` for enumerations, `INV` for every other
  facet, fixed values and assertions, `NA` for stray character data.
- Runs in Node, Deno and browsers: the same results in Node 24, Deno (Supabase Edge Runtime 1.77.8)
  and Chromium 152 (checked 2026-10-31; CI runs the suite on Node 20, 22 and 24).

### Not yet covered by the suite

Lists, minLength and exclusive-range facets: the suite's models give no case for them. Those paths
are implemented but not yet compared against the reference.
