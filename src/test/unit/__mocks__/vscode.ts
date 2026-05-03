/**
 * vscode モジュールのモック
 *
 * Unit テスト（vitest）で VS Code API を使うコードをテストする際に、
 * 実際の vscode モジュールの代わりにこのモックが使われる。
 *
 * 必要に応じてメソッド・クラスを追加すること。
 */

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
  parse: (str: string) => ({ fsPath: str, scheme: 'file', path: str }),
};

const configurationState = new Map<string, Map<string, unknown>>();

function getSectionState(section: string): Map<string, unknown> {
  let sectionState = configurationState.get(section);
  if (!sectionState) {
    sectionState = new Map<string, unknown>();
    configurationState.set(section, sectionState);
  }
  return sectionState;
}

export function __setConfigurationValue(section: string, key: string, value: unknown): void {
  getSectionState(section).set(key, value);
}

export function __resetConfiguration(): void {
  configurationState.clear();
}

export const __windowState = {
  infoMessages: [] as string[],
  warningMessages: [] as string[],
  errorMessages: [] as string[],
  progressTitles: [] as string[],
};

export function __resetWindowState(): void {
  __windowState.infoMessages.length = 0;
  __windowState.warningMessages.length = 0;
  __windowState.errorMessages.length = 0;
  __windowState.progressTitles.length = 0;
}

export const Range = class {
  constructor(
    public startLine: number,
    public startCharacter: number,
    public endLine: number,
    public endCharacter: number,
  ) {}
};

export const Position = class {
  constructor(public line: number, public character: number) {}
};

export const workspace = {
  workspaceFolders: [],
  getConfiguration: (section?: string) => ({
    get: (key: string, defaultValue?: unknown) => {
      if (!section) {
        return defaultValue;
      }
      return getSectionState(section).get(key) ?? defaultValue;
    },
    update: async (key: string, value: unknown) => {
      if (!section) {
        return;
      }
      getSectionState(section).set(key, value);
    },
  }),
  openTextDocument: async () => ({}),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
};

export const window = {
  showInformationMessage: async (message?: string) => {
    if (typeof message === 'string') {
      __windowState.infoMessages.push(message);
    }
    return undefined;
  },
  showWarningMessage: async (message?: string) => {
    if (typeof message === 'string') {
      __windowState.warningMessages.push(message);
    }
    return undefined;
  },
  showErrorMessage: async (message?: string) => {
    if (typeof message === 'string') {
      __windowState.errorMessages.push(message);
    }
    return undefined;
  },
  showQuickPick: async () => undefined,
  withProgress: async (options: { title?: string }, task: () => Promise<unknown>) => {
    if (typeof options.title === 'string') {
      __windowState.progressTitles.push(options.title);
    }
    return task();
  },
  createOutputChannel: () => ({
    appendLine: () => {},
    show: () => {},
    dispose: () => {},
  }),
  activeTextEditor: undefined,
};

export const ProgressLocation = {
  Notification: 15,
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => undefined,
  getCommands: async () => [],
};

export const languages = {
  registerCodeLensProvider: () => ({ dispose: () => {} }),
};

export const EventEmitter = class {
  event = () => ({ dispose: () => {} });
  fire() {}
  dispose() {}
};

export const CancellationTokenSource = class {
  token = { isCancellationRequested: false };
  cancel() {}
  dispose() {}
};

export enum OverviewRulerLane {
  Left = 1,
  Center = 2,
  Right = 4,
  Full = 7,
}

export const CodeLens = class {
  constructor(public range: unknown, public command?: unknown) {}
};

export const ThemeColor = class {
  constructor(public id: string) {}
};

export const l10n = {
  t: (message: string, ..._args: unknown[]) => message,
};
