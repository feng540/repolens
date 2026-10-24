# Contributing

Thanks for taking a look. This project stays small on purpose, so the fastest way to help is a focused issue or a small pull request.

## Setup

```bash
npm install
npm test        # builds and runs the test suite
npm run report  # scan this repository with the local build
```

Node 22 or newer. No other tooling.

## Good first contributions

- A metric that is wrong, noisy or unfair on your own repository — tell us the repository and what the report claims.
- Report wording. The HTML is hand-written; if a sentence reads badly, it is a one-line fix.
- A new hygiene check with a clear rule and a test.

## Pull requests

1. Open an issue first for anything larger than a typo, so the design does not get re-litigated in review.
2. Keep the public surface small: new CLI flags need a README entry and a test.
3. Run `npm test` before pushing. CI runs the same command on Node 22 and 24.
4. Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`) — the project scores its own commit quality, so it would be embarrassing otherwise.

## Code style

- TypeScript, strict mode, ESM with `.js` extensions in relative imports.
- No runtime dependencies. A dependency needs a strong argument in the issue.
- Prefer plain functions and small modules over abstractions.

## Reporting a bug

Include the output of:

```bash
node --version
git --version
npx repolens-cli . --json
```

If the repository is private, the JSON structure alone is usually enough to reproduce the scoring bug.
