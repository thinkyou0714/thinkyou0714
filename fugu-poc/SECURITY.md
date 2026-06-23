# Security Policy

## Reporting a vulnerability

Please report security issues privately via **GitHub Security Advisories**
("Report a vulnerability" on the repository's Security tab). Do not open a public
issue for security reports.

## Handling secrets

This package handles a Sakana **API key** (`SAKANA_API_KEY`).

- **Never** include a real API key, `Authorization` header, or unredacted response
  body in an issue, PR, log, or test fixture. Use the `redact` / `redactString`
  helpers, and the obviously-fake, runtime-assembled tokens used in the tests.
- The client deliberately never stores the raw HTTP response body on errors (it
  can reflect the `Authorization` header through a misrouted proxy) and redacts
  error messages and `--json` output.

## Supported versions

The latest published minor receives fixes.
