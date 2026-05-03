import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { __getNotificationTimeoutMsForTest, notifyInfo } from '@utils/notifications';

type MockVscode = typeof vscode & {
  __resetConfiguration: () => void;
  __resetWindowState: () => void;
  __setConfigurationValue: (section: string, key: string, value: unknown) => void;
  __windowState: {
    infoMessages: string[];
    warningMessages: string[];
    errorMessages: string[];
    progressTitles: string[];
  };
};

const mockVscode = vscode as MockVscode;

describe('notifications', () => {
  afterEach(() => {
    vi.useRealTimers();
    mockVscode.__resetConfiguration();
    mockVscode.__resetWindowState();
  });

  it('notificationTimeoutSeconds=0 のときは通常メッセージ API にフォールバックする', async () => {
    mockVscode.__setConfigurationValue('codeWalker', 'notificationTimeoutSeconds', 0);

    await notifyInfo('fallback message');

    expect(mockVscode.__windowState.infoMessages).toEqual(['fallback message']);
    expect(mockVscode.__windowState.progressTitles).toEqual([]);
    expect(__getNotificationTimeoutMsForTest()).toBe(0);
  });

  it('notificationTimeoutSeconds>0 のときは timed notification を使う', async () => {
    vi.useFakeTimers();
    mockVscode.__setConfigurationValue('codeWalker', 'notificationTimeoutSeconds', 3);

    const promise = notifyInfo('timed message');

    expect(mockVscode.__windowState.progressTitles).toEqual(['$(info) timed message']);
    expect(mockVscode.__windowState.infoMessages).toEqual([]);
    expect(__getNotificationTimeoutMsForTest()).toBe(3000);

    await vi.advanceTimersByTimeAsync(3000);
    await promise;
  });
});