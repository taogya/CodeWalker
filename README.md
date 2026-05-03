# CodeWalker

Interactive code walkthroughs for Visual Studio Code and Copilot Agent Mode.

CodeWalker helps you turn code-reading work into reusable walkthroughs. It overlays semantic blocks, CodeLens actions, inline annotations, detail panels, stale detection, and repair flows directly in VS Code.

## Features

- Semantic Blocks - Highlight meaningful ranges inside functions, classes, and files
- Manual Walkthroughs - Add, edit, delete, and explain blocks from editor selections
- Agent-Assisted Walkthroughs - Use the `code_walker_*` language model tools from Copilot Agent Mode
- Persistent Cache - Save walkthroughs under `.code-walker/walks-manual/` and `.code-walker/walks-auto/`
- Sidebar Explorer - Browse walkthroughs, uncovered files, stale blocks, and batch targets from the Activity Bar
- Stale Repair - Repair shifted or moved blocks from CodeLens or the Sidebar
- Graph and Timeline - Inspect symbol relationships and walkthrough history
- i18n - English and Japanese command/configuration text, plus English and Japanese documentation

## Getting Started

1. Install and enable CodeWalker in VS Code.
2. Open a workspace that you want to document.
3. Select a code range and run `CodeWalker: Add Block` to create a manual walkthrough block.
4. Open the CodeWalker Activity Bar view to browse registered, uncovered, and stale files.
5. Use Copilot Agent Mode with the CodeWalker tools to create AI-assisted walkthroughs.

CodeWalker stores project walkthrough data in `.code-walker/` inside your workspace. The extension does not decide how your team shares that folder; commit or ignore it according to your repository policy.

## Requirements

- VS Code 1.99.0 or later
- GitHub Copilot extension, when using AI-assisted walkthrough generation

## Documentation

- [User Guide (English)](https://github.com/taogya/CodeWalker/blob/main/docs/user-guide.md)
- [ユーザーガイド（日本語）](https://github.com/taogya/CodeWalker/blob/main/docs/user-guide.ja.md)
- [README（日本語）](README.ja.md)
- [Design Documentation](https://github.com/taogya/CodeWalker/blob/main/docs/design/docs/README.md)
- [Implementation Status](https://github.com/taogya/CodeWalker/blob/main/docs/design/docs/99-status.md)

## Privacy And Security

- Walkthrough cache files are written locally under `.code-walker/`.
- AI-assisted summaries are produced through Copilot Agent Mode when you ask the agent to use CodeWalker tools.
- The VSIX package excludes source tests, local runtime output, `.github`, `.vscode`, `docs`, sourcemaps, and generated test output.

## Development

```bash
npm install
npm run compile
```

To package the extension locally:

```bash
npx @vscode/vsce package
```

## License

[BSD-3-Clause](LICENSE)