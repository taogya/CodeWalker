workspace {

    model {
        dev = person "開発者" "コードを読み解きドキュメント化する"

        cw = softwareSystem "CodeWalker Extension" "VS Code 拡張機能。コードをブロック単位で色分け・注釈・解説し永続化する"

        vscode = softwareSystem "VS Code Host" "エディタ、CodeLens、Webview、コマンドパレット等の UI ホスト" {
            tags "External"
        }
        copilot = softwareSystem "GitHub Copilot" "AI Agent Mode — ツールを自律的に呼び出し解説を自動生成" {
            tags "External"
        }
        fs = softwareSystem "File System" ".code-walker/ ディレクトリ (walks-manual/, walks-auto/, config.json)" {
            tags "External"
        }
        re = softwareSystem ".reverse-engineer/" "ReverseEngineer 解析結果 (オプション)" {
            tags "External"
        }

        dev -> cw "右クリック / CodeLens / コマンドパレット"
        dev -> copilot "Agent Mode チャットで指示"
        copilot -> cw "registerTool API 経由でツール呼び出し"
        cw -> vscode "VS Code Extension API"
        cw -> fs "JSON Read/Write"
        cw -> re "コンテキスト読み取り (オプション)"
    }

    views {
        systemContext cw "SystemContext" {
            include *
            autoLayout
        }

        styles {
            element "Person" {
                shape Person
                background #08427B
                color #ffffff
            }
            element "Software System" {
                background #1168BD
                color #ffffff
            }
            element "External" {
                background #999999
                color #ffffff
            }
        }
    }

}
