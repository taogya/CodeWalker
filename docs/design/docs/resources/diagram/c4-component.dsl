workspace {

    model {
        dev = person "開発者"

        cw = softwareSystem "CodeWalker Extension" {

            tools = container "Agent Mode Tools" "TypeScript" {
                analyze = component "AnalyzeTool" "シンボル解析 + ソースコード取得 + CacheService 参照" "code_walker_analyze"
                highlight = component "HighlightTool" "AI ブロック色分け + BlockStore 登録 + アノテーション" "code_walker_highlight"
                drilldown = component "DrilldownTool" "QuickPick 質問入力" "code_walker_drilldown"
                export = component "ExportTool" "JSON/Markdown エクスポート + CacheService 書き込み" "code_walker_export"
                findSym = component "FindSymbolTool" "ワークスペースシンボル検索" "code_walker_find_symbol"
                listSym = component "ListSymbolsTool" "フォルダ再帰シンボル列挙" "code_walker_list_symbols"
            }

            commands = container "Commands" "7 コマンドハンドラ (src/commands/)" "TypeScript" {
                clearHL = component "clearHighlights" "全ハイライト・CodeLens・パネルクリア" "clearHighlights.ts"
                showDetail = component "showBlockDetail" "CodeLens → 解説パネル表示" "showBlockDetail.ts"
                toggleAnn = component "toggleAnnotations" "行末注釈 ON/OFF" "toggleAnnotations.ts"
                clearCch = component "clearCache" "5 択 QuickPick キャッシュ削除" "clearCache.ts"
                addBlk = component "addBlock" "選択範囲→マニュアルブロック追加" "addBlock.ts"
                editBlk = component "editBlock" "ブロック編集 Webview を開く" "editBlock.ts"
                deleteBlk = component "deleteBlock" "ブロック削除（確認ダイアログ付き）" "deleteBlock.ts"
            }

            ui = container "UI Components" "CodeLens, Highlighter, Webview Panels" "TypeScript" {
                blockSt = component "BlockStore" "ブロックデータストア + CRUD + onDidChange イベント" "blockStore.ts"
                codelens = component "WalkerCodeLensProvider" "CodeLens 表示（表示専門・BlockStore 参照）" "codeLensProvider.ts"
                hl = component "Highlighter" "6色ブロック Decoration + 行末アノテーション" "highlighter.ts"
                detail = component "BlockDetailPanel" "解説 Webview (読み取り専用)" "blockDetailPanel.ts"
                edit = component "BlockEditPanel" "編集 Webview (ラベル/色/解説/注釈を入力)" "blockEditPanel.ts"
                symFind = component "SymbolFinder" "ドキュメントシンボル取得" "symbolFinder.ts"
            }

            cache = container "Cache Layer" "キャッシュ読み書き, 復元, 設定" "TypeScript" {
                cacheSvc = component "CacheService" "キャッシュ I/O 統合サービス (read/write/delete)" "cacheService.ts"
                restore = component "RestoreCache" "起動時復元 (Manual→Auto)" "restoreCache.ts"
                config = component "ConfigReader" "config.json 読み書き" "configReader.ts"
                types = component "CacheTypes" "共通型定義" "cacheTypes.ts"
            }

            analysis = container "Analysis Engine" "コンテキスト構築, ReverseEngineer 読み取り" "TypeScript" {
                ctx = component "ContextBuilder" "LLM 返却データ構築" "contextBuilder.ts"
                rev = component "ReverseReader" ".reverse-engineer/ 読み取り" "reverseReader.ts"
            }

            utils = container "Utilities" "ファイル操作, ロガー, 状態管理" "TypeScript" {
                file = component "FileUtils" "パス解決 / ハッシュ" "fileUtils.ts"
                log = component "Logger" "OutputChannel ロガー" "logger.ts"
                state = component "State" "ウォークセッション状態" "state.ts"
            }
        }

        # Tools → dependencies (via DI)
        analyze -> symFind "シンボル検索"
        analyze -> rev "コンテキスト読み取り"
        analyze -> ctx "結果構築"
        analyze -> cacheSvc "キャッシュ参照"
        highlight -> blockSt "ブロック登録 / 解説保存"
        highlight -> hl "色分け + アノテーション"
        export -> cacheSvc "キャッシュ読み書き"
        export -> file "ハッシュ計算 / パス解決"

        # Commands → dependencies
        clearCch -> cacheSvc "キャッシュ削除"
        clearCch -> blockSt "BlockStore クリア"
        addBlk -> edit "編集 Webview を開く"
        editBlk -> edit "編集 Webview を開く"
        editBlk -> cacheSvc "既存データ読込"
        deleteBlk -> cacheSvc "キャッシュ削除"
        deleteBlk -> blockSt "ブロック削除"
        showDetail -> blockSt "ブロック情報取得"
        showDetail -> detail "パネル表示"
        toggleAnn -> hl "アノテーション ON/OFF"

        # Cache → UI (restore)
        restore -> blockSt "BlockStore 登録"
        restore -> hl "ハイライト / アノテーション復元"
        restore -> cacheSvc "キャッシュ読込"

        # UI internal
        codelens -> blockSt "onDidChange 購読"
        edit -> blockSt "ブロック更新"
        edit -> cacheSvc "JSON 書込"
    }

    views {
        component tools "ComponentTools" {
            include *
            autoLayout
        }

        component ui "ComponentUI" {
            include *
            autoLayout
        }

        styles {
            element "Person" {
                shape Person
                background #08427B
                color #ffffff
            }
            element "Component" {
                background #85BBF0
                color #000000
            }
            element "Container" {
                background #438DD5
                color #ffffff
            }
        }
    }

}
