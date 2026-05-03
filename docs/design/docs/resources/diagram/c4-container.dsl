workspace {

    model {
        dev = person "開発者"

        cw = softwareSystem "CodeWalker Extension" {
            entry = container "Extension Entry" "DI 配線, ツール登録, コマンド登録 (~136行)" "TypeScript"
            tools = container "Agent Mode Tools" "6 ツール: analyze, highlight, drilldown, export, find_symbol, list_symbols" "TypeScript"
            commands = container "Commands" "7 コマンドハンドラ (clearHighlights, clearCache, addBlock, editBlock, deleteBlock, showBlockDetail, toggleAnnotations)" "TypeScript"
            ui = container "UI Components" "BlockStore, CodeLens, Highlighter, Webview Panels" "TypeScript"
            cache = container "Cache Layer" "CacheService (I/O 統合), 復元, 設定" "TypeScript"
            analysis = container "Analysis Engine" "コンテキスト構築, ReverseEngineer 読み取り" "TypeScript"
            utils = container "Utilities" "ファイル操作, ロガー, 状態管理" "TypeScript"
        }

        vscode = softwareSystem "VS Code Host" {
            tags "External"
        }
        copilot = softwareSystem "GitHub Copilot" {
            tags "External"
        }
        fs = softwareSystem "File System" {
            tags "External"
        }

        dev -> entry "コマンドパレット / 右クリック"
        copilot -> tools "registerTool API"
        entry -> tools "ツール登録 (DI: CacheService, BlockStore)"
        entry -> commands "コマンド登録 (DI: BlockStore, CacheService)"
        entry -> ui "CodeLensProvider 登録"
        entry -> cache "キャッシュ復元ライフサイクル"
        commands -> ui "BlockStore / Highlighter 操作"
        commands -> cache "CacheService 経由で読み書き"
        tools -> ui "BlockStore 登録 / Highlighter 操作"
        tools -> cache "CacheService 経由でキャッシュ参照"
        tools -> analysis "コンテキスト構築"
        cache -> fs "JSON I/O"
        ui -> vscode "Decoration / CodeLens / Webview API"
    }

    views {
        container cw "Containers" {
            include *
            autoLayout
        }

        styles {
            element "Person" {
                shape Person
                background #08427B
                color #ffffff
            }
            element "Container" {
                background #438DD5
                color #ffffff
            }
            element "External" {
                background #999999
                color #ffffff
            }
        }
    }

}
