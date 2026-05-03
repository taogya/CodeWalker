/**
 * blockEdit.js — ブロック編集パネル Webview JavaScript
 *
 * 初期データは <script id="init-data" type="application/json"> から読み込む。
 * Extension とは acquireVsCodeApi().postMessage / window.addEventListener('message') で通信。
 */

// eslint-disable-next-line no-undef
const vscode = acquireVsCodeApi();

/** @type {{ colorIndex: number, annotations: { line: number, text: string }[] }} */
const initData = JSON.parse(document.getElementById('init-data').textContent);

let selectedColor = initData.colorIndex;
let annotations = initData.annotations;

// ─── ラベルテンプレート ───────────────────────────

vscode.postMessage({ type: 'requestLabels' });

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'labels') {
    const container = document.getElementById('labelSuggestions');
    container.innerHTML = '';
    for (const lbl of msg.labels) {
      const chip = document.createElement('button');
      chip.className = 'label-chip';
      chip.textContent = lbl;
      chip.onclick = () => {
        document.getElementById('label').value = lbl;
      };
      container.appendChild(chip);
    }
  }
});

// ─── 色選択 ──────────────────────────────────────

document.querySelectorAll('.color-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedColor = parseInt(btn.dataset.index, 10);
  });
});

// ─── アノテーション管理 ──────────────────────────

function renderAnnotations() {
  const list = document.getElementById('annotList');
  list.innerHTML = '';
  annotations.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'annot-row';
    row.innerHTML =
      '<input type="number" value="' + a.line + '" min="1" data-idx="' + i + '" data-field="line">' +
      '<input type="text" value="' + a.text.replace(/"/g, '&quot;') + '" data-idx="' + i + '" data-field="text" placeholder="注釈テキスト">' +
      '<button data-idx="' + i + '" class="del-annot">✕</button>';
    list.appendChild(row);
  });

  list.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const field = e.target.dataset.field;
      if (field === 'line') {
        annotations[idx].line = parseInt(e.target.value, 10) || 1;
      } else {
        annotations[idx].text = e.target.value;
      }
    });
  });

  list.querySelectorAll('.del-annot').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      annotations.splice(parseInt(e.target.dataset.idx, 10), 1);
      renderAnnotations();
    });
  });
}

renderAnnotations();

document.getElementById('addAnnotBtn').addEventListener('click', () => {
  const sl = parseInt(document.getElementById('startLine').value, 10) || 1;
  annotations.push({ line: sl, text: '' });
  renderAnnotations();
});

// ─── 保存 ────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', () => {
  vscode.postMessage({
    type: 'save',
    symbolName: document.getElementById('symbolName').value.trim(),
    label: document.getElementById('label').value.trim() || 'ブロック',
    startLine: parseInt(document.getElementById('startLine').value, 10) || 1,
    endLine: parseInt(document.getElementById('endLine').value, 10) || 1,
    colorIndex: selectedColor,
    description: document.getElementById('description').value.trim(),
    explanation: document.getElementById('explanation').value.trim(),
    annotations: annotations.filter((a) => a.text.trim()),
  });
});

// ─── プレビュー ──────────────────────────────────

document.getElementById('previewBtn').addEventListener('click', () => {
  vscode.postMessage({
    type: 'preview',
    startLine: parseInt(document.getElementById('startLine').value, 10) || 1,
    endLine: parseInt(document.getElementById('endLine').value, 10) || 1,
    colorIndex: selectedColor,
    annotations: annotations.filter((a) => a.text.trim()),
  });
});
