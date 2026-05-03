import * as vscode from 'vscode';

type NotificationSeverity = 'info' | 'warning' | 'error';

function getTimeoutMs(): number {
  const seconds = vscode.workspace.getConfiguration('codeWalker').get<number>('notificationTimeoutSeconds', 3);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  return Math.round(seconds * 1000);
}

function fallbackMessage(message: string, severity: NotificationSeverity): Thenable<void> {
  if (severity === 'warning') {
    return vscode.window.showWarningMessage(message).then(() => undefined);
  }
  if (severity === 'error') {
    return vscode.window.showErrorMessage(message).then(() => undefined);
  }
  return vscode.window.showInformationMessage(message).then(() => undefined);
}

function iconPrefix(severity: NotificationSeverity): string {
  if (severity === 'warning') {
    return '$(warning) ';
  }
  if (severity === 'error') {
    return '$(error) ';
  }
  return '$(info) ';
}

function withTimedNotification(message: string, severity: NotificationSeverity): Thenable<void> {
  const timeoutMs = getTimeoutMs();
  if (timeoutMs <= 0) {
    return fallbackMessage(message, severity);
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `${iconPrefix(severity)}${message}`,
      cancellable: false,
    },
    async () => {
      await new Promise<void>(resolve => setTimeout(resolve, timeoutMs));
    },
  );
}

export function notifyInfo(message: string): Thenable<void> {
  return withTimedNotification(message, 'info');
}

export function notifyWarning(message: string): Thenable<void> {
  return withTimedNotification(message, 'warning');
}

export function notifyError(message: string): Thenable<void> {
  return withTimedNotification(message, 'error');
}

export function __getNotificationTimeoutMsForTest(): number {
  return getTimeoutMs();
}