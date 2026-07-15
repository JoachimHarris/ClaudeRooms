# Security policy

## Supported versions

ClaudeRooms is pre-alpha. Only the latest commit on `main` is supported; no
backports.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's ["Report a vulnerability"](https://github.com/JoachimHarris/ClaudeRooms/security/advisories/new)
form (preferred), or email the maintainer at joachimharris@gmail.com with the
subject `[ClaudeRooms security]`.

Include: affected component, reproduction steps, and impact as you understand
it. Please give us reasonable time to fix before public disclosure.

## What to expect

This is a volunteer-maintained pre-alpha project. We aim to acknowledge
reports within 7 days and to fix confirmed issues before the next release,
but we cannot promise formal SLAs.

## Scope notes

The current [threat model](docs/security/threat-model.md) documents accepted
pre-alpha gaps (no built-in TLS, localhost-first deployment, guest
identities). Reports on those documented gaps are still welcome if they show
impact beyond what is documented.
