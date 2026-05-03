#!/bin/bash

# ビルド
npm install
npm run compile

# VSIX パッケージ作成
npx @vscode/vsce package

# VS Code にインストール
code --install-extension code-walker-*.vsix