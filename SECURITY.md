# Security policy

RepoLens runs entirely locally: it reads a git repository and writes an HTML file. It makes no network requests, collects no telemetry, and stores nothing outside the paths you pass on the command line.

## Supported versions

The latest minor release receives fixes. This is a 0.x project, so please upgrade rather than expect backports.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/feng540/repolens/security/advisories/new) on GitHub. Do not open a public issue for anything exploitable.

Two areas are worth probing:

- **HTML injection.** Repository content (names, paths, commit subjects) is interpolated into the report. It must always be escaped. A repository that can make the report execute script is a vulnerability.
- **Command injection.** Paths and refs are passed to `git` as argument arrays, never through a shell.

Please include a minimal repository layout or command that reproduces the issue.
