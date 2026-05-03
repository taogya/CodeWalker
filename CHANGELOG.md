# Changelog

All notable changes to CodeWalker will be documented in this file.

## [1.0.0] - 2026-05-04

### First Release

- Initial public release of CodeWalker as a VS Code extension.
- Added semantic code walkthroughs with editor highlights, CodeLens actions, inline annotations, and block detail panels.
- Added manual walkthrough creation, editing, deletion, and Auto-to-Manual import flows.
- Added Copilot Agent Mode tools for symbol analysis, highlighting, export, drill-down questions, and batch target listing.
- Added persistent walkthrough cache support under `.code-walker/walks-manual/` and `.code-walker/walks-auto/`.
- Added Activity Bar views for Walkthrough Explorer, Uncovered Files, Stale Queue, and Batch Targets.
- Added stale block detection and repair flows for definition-line shifts, block-hash matches, and ambiguous preview candidates.
- Added Symbol Graph, Timeline, walkthrough comparison, and Markdown export support.
- Added English and Japanese UI localization resources.
- Added English and Japanese README and user guide documentation.

### Packaging

- Published VSIX package content is limited to runtime assets: README files, license, package metadata, localization bundles, webview media, and bundled extension output.
- Source files, tests, design docs, local runtime output, sourcemaps, workspace settings, and repository automation files are excluded from the VSIX.

### Security

- Added Content Security Policy coverage for script-enabled Webviews.
- Uses random nonces for Webview scripts.
- Runtime dependency audit reports no known vulnerabilities at release time.