# CodeWalker User Guide

## Core Concepts

- Block: A meaningful range of code with a label, color, optional description, and optional annotations.
- Walkthrough: A set of blocks and explanations for a symbol or file.
- Manual source: Blocks created or confirmed by a user.
- Auto source: Blocks generated with Copilot Agent Mode and CodeWalker tools.
- Stale block: A block whose stored range or hash no longer matches the current source.

## Create A Manual Walkthrough

1. Open a source file in VS Code.
2. Select the code range you want to explain.
3. Run `CodeWalker: Add Block` from the Command Palette or editor context menu.
4. Choose a label, color, description, and annotations.
5. Use the generated CodeLens to open details, edit the block, or delete it.

Manual walkthroughs are stored under `.code-walker/walks-manual/`.

## Create An Agent-Assisted Walkthrough

1. Open Copilot Chat in Agent Mode.
2. Ask the agent to analyze a function, class, or file using the CodeWalker tools.
3. The agent should call `code_walker_analyze`, then `code_walker_highlight`, and optionally `code_walker_export`.
4. Review the generated blocks in the editor.
5. Import useful Auto blocks into Manual blocks when you want to keep or adjust them.

Auto walkthroughs are stored under `.code-walker/walks-auto/`.

## Use The Sidebar

Open the CodeWalker Activity Bar view to access:

- Walkthrough Explorer: Files, symbols, and blocks already registered in `.code-walker/`.
- Uncovered Files: Workspace files that match CodeWalker scan settings but have no walkthrough yet.
- Stale Queue: Symbols and blocks that need review after source changes.
- Batch Targets: Pending, done, and skipped entries from `.code-walker/targets.json`.

Sidebar context menus can open files, show block details, export Markdown, clear cache entries, and start repair flows.

## Repair Stale Blocks

When CodeWalker detects a stale block, the block detail and CodeLens show a warning marker.

Use one of these paths:

- Click the repair CodeLens on a stale block.
- Run `CodeWalker: Repair Walkthrough` in the active editor.
- Use the repair action from the Sidebar Stale Queue.

CodeWalker can automatically repair definition-line shifts and unique block-hash matches. Ambiguous candidates are shown in a preview before applying a change. If no safe candidate is found, continue with manual edit or import.

## Configure CodeWalker

Settings are available in VS Code Settings under `CodeWalker`:

- `codeWalker.enableDebugLog`
- `codeWalker.enableLineTracking`
- `codeWalker.notificationTimeoutSeconds`
- `codeWalker.templateLabels`
- `codeWalker.defaultColor`
- `codeWalker.annotationStyle`
- `codeWalker.viewMode`
- `codeWalker.skipPatterns`
- `codeWalker.extensions`

See [Settings Reference](design/docs/06-settings.md) for details.

## Cache Files

CodeWalker writes walkthrough cache files into `.code-walker/` in the current workspace:

- `.code-walker/walks-manual/`: User-confirmed walkthroughs
- `.code-walker/walks-auto/`: Agent-generated walkthroughs
- `.code-walker/targets.json`: Batch walkthrough target list

Do not commit `.code-walker/` unless your team intentionally wants to share walkthrough data.

## Troubleshooting

- If highlights disappear, reopen the file or run the restore flow by opening the matching source file.
- If a block looks wrong after editing source code, save the file so CodeWalker can validate stale blocks.
- If notifications stay too long, adjust `codeWalker.notificationTimeoutSeconds`.
- If files are missing from scan results, check `codeWalker.extensions` and `codeWalker.skipPatterns`.

## More Documentation

- [Design Documentation](design/docs/README.md)
- [Implementation Status](design/docs/99-status.md)
- [Japanese User Guide](user-guide.ja.md)