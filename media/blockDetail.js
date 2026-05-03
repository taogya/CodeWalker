/**
 * blockDetail.js — ブロック詳細パネルのナビゲーション JS
 *
 * 前/次ボタン、ドロップダウン選択でブロック間を移動する。
 * 解説文中のファイルパスリンクもハンドリングする。
 */
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // ── ナビゲーションバー ──────────────────────────

  const navBar = document.querySelector('.nav-bar');
  if (navBar) {
    const uri = navBar.getAttribute('data-uri') ?? '';
    const symbol = navBar.getAttribute('data-symbol') ?? '';
    const select = navBar.querySelector('.nav-select');

    // 前/次ボタン
    navBar.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.hasAttribute('disabled')) { return; }
        const dir = btn.getAttribute('data-dir');
        const current = parseInt(select.value, 10);
        const next = dir === 'prev' ? current - 1 : current + 1;
        if (next >= 0 && next < select.options.length) {
          vscode.postMessage({ type: 'navigateBlock', uriString: uri, symbolName: symbol, blockIndex: next });
        }
      });
    });

    // ドロップダウン選択
    if (select) {
      select.addEventListener('change', () => {
        const idx = parseInt(select.value, 10);
        vscode.postMessage({ type: 'navigateBlock', uriString: uri, symbolName: symbol, blockIndex: idx });
      });
    }
  }

  // ── ファイルパスリンク ──────────────────────────

  document.querySelectorAll('a[data-file]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const filePath = link.getAttribute('data-file');
      if (filePath) {
        vscode.postMessage({ type: 'openFile', filePath });
      }
    });
  });
})();
