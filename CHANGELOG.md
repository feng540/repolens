# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-24

### Changed

- Published to npm as `repolens-health` (the shorter `repolens-cli` name was rejected as too similar to the existing `repo-lens-cli`).
- Added a `repolens-health` binary alias so `npx repolens-health .` resolves without `-p`.

## [0.1.0] - 2026-10-24

### Added

- `repolens [path]` CLI: scans a git repository and writes a self-contained HTML report.
- Five scored dimensions: project hygiene, activity, collaboration, code structure, commit quality.
- Terminal summary with score bars and the three most useful next moves.
- `--badge` to write an embeddable SVG badge.
- `--json` for CI and tooling, `--min` to fail a build below a threshold.
- Commit cadence chart, language mix, contributor ranking, hotspot table and hygiene checklist in the report.
- Unit and integration tests with `node:test`.
