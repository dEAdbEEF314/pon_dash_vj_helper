# Pon Dash VJ Helper (PDVH) システム詳細仕様書

## 1. 概要 & 目的

**Pon Dash VJ Helper (PDVH)** は、DJとVJの現場におけるコミュニケーションロスを解消し、即時かつ確実な情報共有と素材準備を実現するために開発されたリアルタイムWebアプリケーションです。

### 解決する課題
- 大音量・暗所・狭いブースといった現場特有の過酷な環境において、口頭やPCDJ画面の目視確認による楽曲情報の伝達ミス。
- プレイリスト外の急な割込み選曲（VIBES!）への追従難度。
- VJ側の素材検索手間の軽減および、DJへの素材準備完了（READY）通知の確実性確保。

---

## 2. システムアーキテクチャ & 技術スタック

```
+-----------------------------------------------------------------------+
|                             フロントエンド                             |
|  - index.html (事前登録) / dj.html (DJ画面) / vj.html (VJ画面)           |
|  - Vanilla HTML5 / Vanilla CSS3 (Glassmorphism, Neon Theme)           |
|  - Vanilla JavaScript (ES6+, Pusher JS SDK)                            |
+-----------------------------------------------------------------------+
                                    |
                    +---------------+---------------+
                    | HTTP REST / JSON API          | WebSocket (Pusher)
                    v                               v
+------------------------------------+    +-----------------------------+
|          バックエンド (PHP 8.3)     |    |    Pusher Realtime API      |
|  - register.php (セッション/ロビー)  |--->| (リアルタイムイベント配信)   |
|  - action.php (SEND / READY等)     |    +-----------------------------+
|  - config.php (環境設定提供)        |
+------------------------------------+
                  |
                  v
+------------------------------------+
|   JSON ファイルストレージ           |
|   (backend/data/*.json)            |
+------------------------------------+
```

### 技術スタック
- **フロントエンド**: Vanilla HTML5, Vanilla CSS3, Vanilla JavaScript (フレームワーク非使用で軽量動作)
- **バックエンド**: PHP 8.3 (データベース不要のファイルベースステート管理)
- **リアルタイム通信**: Pusher API (WebSocketベースのイベント駆動通信)
- **コンテナ/テスト**: Docker (Apache + PHP 8.3), Playwright (E2Eテスト)

---

## 3. 画面仕様 ＆ 機能詳細

### 3.1 事前登録画面 (`index.html` / `register.js`)
DJがセッションを開始するための事前設定画面です。
- **入力項目**:
  - セッション名 (DJ名 / イベント名等)
  - 操作用パスワード (DJ/VJ画面アクセス用)
  - プレイリスト入力: Rekordbox, djay 等からエクスポートした m3u8 / XML / CSV / TXT ファイルのアップロード。
  - VJロビーコード (任意・10文字): VJが作成したロビーコードを入力することで自動連携。

- **機能**:
  - プレイリスト構文解析 (`parser.js`): トラック番号、曲名、アーティスト名を自動抽出。
  - 登録完了後、DJ用URL (`dj.html?sid={session_id}`) およびVJ用URL (`vj.html?sid={session_id}`)を発行。パスワードはURLに含めず、画面で入力。
  - URLを失った場合も、同一ブラウザに保存されたセッションIDを8時間以内なら復元し、パスワード再入力で復帰。
  - DJは画面の削除ボタンから、VJはセッションタブの削除操作から、サーバー上のセッションとプレイリストを手動削除可能。
  - トップページの「VJの方はこちらから」リンクより VJ専用トップページ/ロビー画面へ遷移可能。

### 3.2 DJ操作画面 (`dj.html` / `dj.js`)
DJブースでの片手操作・高視認性を追求したUI。
- **画面構成**:
  - **SEND TO VJ ボタン (割合: 70%)**: 選択中トラックをVJへワンタップ送信。送信後、「VJにSENDする曲」にプレイリストの次の曲が自動的にセット。送信時には**画面全体が5秒間フラッシュ**。
  - **VIBES! ボタン (割合: 30%)**: モーダルを開き、プレイリスト外の割込み曲を手入力送信。
  - **VJに通知した曲エリア / READY受信**: VJが「READY」を押すと**DJ/VJそれぞれの画面全体が5秒間フラッシュ**し、「VJにSENDした曲」エリアが白文字赤背景（白文字黒角丸背景の `[VJ READY]` バッジ付き）に強調更新。
  - **プレイリスト表示エリア**: トラック一覧のタップ選択、現在送信中曲のハイライト。

### 3.3 VJ操作画面 / VJロビー (`vj.html` / `vj.js`)
VJの素材検索と進捗管理を最大効率化するUI。
- **ロビー機能**:
  - ワンクリックで10文字のロビーコードを発行。
  - ロビーコードとセッション復帰情報は最大8時間でローカルから自動削除。パスワードや認証トークンは保存しない。
  - 複数のDJセッションを上部「タブ」で切り替え・同時追跡。
  - 「連携済みDJセッション」の一覧と件数は、内部セッション管理 `sessions` を唯一の基準として同一の再描画処理で更新し、件数は常に `sessions.size` と一致させる。
  - Pusher通知と30秒間隔ポーリングの重複受信に備え、セッションID単位の処理中ロックを使用し、同一セッションのログイン処理を同時実行しない。
  - DJセッションの認証・登録処理が完了してから一覧、件数、VJモード開始ボタンを更新する。
- **受信 ＆ フラッシュ通知**:
  - DJがSENDした曲を受信すると、「DJからSENDされた曲」エリアが更新され、**画面全体が5秒間フラッシュ（イエロー/ピンク等）**。
  - 手入力曲には **`[VIBES!]`** バッジを自動付与。
- **ワンタップ検索 ＆ コピー**:
  - 受信曲およびリスト内の曲名・アーティスト名をタップすると、上部の素材検索ボックスに自動入力（手入力での編集も可能）。
  - **Google / YouTube / ニコニコ動画 / GIPHY** ボタンでワンクリック外部検索（検索結果は別タブで開く）。
- **READY 通知ボタン**:
  - 「READY」ボタン押下で、DJ画面側へ素材準備完了ステータスを即時送信。（押さなければREADY通知が飛ばないのみで、システム動作に支障はありません。）

---

## 4. バックエンド API & データ仕様

### 4.1 エンドポイント一覧

| エンドポイント | メソッド | 説明 |
| :--- | :--- | :--- |
| `backend/api/register.php` | `POST` | セッション新規登録およびVJロビーコード紐付け |
| `backend/api/action.php` | `POST` | DJ/VJのアクション送信、セッション削除、ロビー操作 |
| `backend/api/config.php` | `GET` | Pusher App Key や Cluster 等のフロント用設定取得 |

### 4.2 アクションAPI (`action.php`) の動作仕様
- `action=send`: トラックIDを指定してVJへ送信。
- `action=vibes`: 手入力の曲名・アーティスト名を割込み送信 (`is_vibes: true`)。
- `action=ready`: 指定トラックの素材準備完了状態を設定。
- `action=delete_session`: 認証済みのDJ/VJがセッションJSON、プレイリスト、ロビー参照を削除。
- `action=status`: 現在のセッションステート（全トラック情報・現在選択曲・READY状態等）をJSONで取得。

### 4.3 Pusher リアルタイムイベント仕様
- **Channel**: `session-{session_id}` / `lobby-{lobby_code}`
- **Event Names**:
  - `update-track`: 曲のSEND通知（VJ画面更新）
  - `update-ready`: VJのREADY通知（DJ画面更新）
  - `lobby-update`: VJロビーへの新規DJ追加通知
  - `session-removed`: セッション削除通知。接続中のVJタブからも自動削除。

---

## 5. UI/UX デザインシステム

- **テーマ**: ダークネオン / サイバーパンク (Dark Neon Glassmorphism)
- **カラーパレット**:
  - バックグラウンド: Dark Blue / Charcoal `#0f172a`
  - アクセント1 (SEND/VJ): Electric Cyan / Neon Green (`#06b6d4`, `#10b981`)
  - アクセント2 (VIBES/ALERT): Neon Pink / Magenta (`#ec4899`, `#f43f5e`)
  - Accent Ready: Red / White (`#ef4444`, `#ffffff`)
- **レスポンシブ ＆ 操作性**:
  - タップターゲット: 最低 50px 高さを保持 (SEND: 70%, VIBES!: 30%)。
  - テキスト処理: 長い曲名・アーティスト名は左右スクロール (marquee) で全文表示、プレイリスト欄は手動スワイプ（横スクロール）で確認可能。
  - コンテナ制御: PC表示時は画面中央に **450x800px** のモバイルシミュレーションフレーム枠を固定配置。

---

## 6. セキュリティ・環境設定 (`env.php`)

`backend/api/env.php` において本番環境設定を保持します。

- **Pusher 認証情報**: `APP_ID`, `KEY`, `SECRET`, `CLUSTER`
- **HMAC 秘密鍵 (`$HMAC_SECRET`)**: 認証トークンおよびデータ改ざん検証用の暗号鍵。
- **アクセス制御**: `backend/api/.htaccess` および `backend/data/.htaccess` により、設定・JSONデータファイルへの直接HTTPアクセスを遮断。APIアクセス時には作成から8時間を超えたJSONを自動削除。

---

## 7. 開発・テスト ＆ ガイドライン

### 7.1 Docker / ローカル開発 ＆ テスト環境構築

- **コンテナ起動**:
  - `docker compose up -d`: Webサーバー (PHP 8.3 / ポート `8000`) および Playwright テストコンテナを一括起動。
- **Playwright テスト環境の初期化 ＆ テスト実行手順**:
  - **依存パッケージのインストール**: Playwright 公式コンテナ (`mcr.microsoft.com/playwright`) 内で `@playwright/test` が必要となるため、テスト初回実行時にインストールします。
  - **対話プロンプトの回避**: CI/CD や自動化環境では `npx -y` または `bash -c` 内でパッケージをセットアップし、プロンプト待ちを防ぎます。
  - **テストファイルの配置**: Playwright の探索対象となるよう、テストファイルは `tests/*.spec.js` に配置します。
  - **コンテナ間ネットワーク指定**: ブラウザのURL指定時は Docker 内部ネットワークのホスト名 (`http://app:80/`) または IP アドレスを指定します。
  - **実行コマンド例**:
    ```bash
    # 稼働中コンテナ内でのテスト実行 (非対話インストール + テスト実行)
    docker compose exec playwright bash -c "npm install @playwright/test && npx playwright test tests/spec_alignment.spec.js"

    # ワンショットコンテナでのテスト実行
    docker compose run --rm playwright bash -c "npm install @playwright/test && npx playwright test tests/spec_alignment.spec.js"
    ```
- **簡易開発用 (PHP ビルトインサーバー)**:
  - `php -S localhost:8000` (クイックな単体動作チェック用)

### 7.2 保存先 ＆ 変更履歴規則
- **テスト成果物**: スクリプト、結果、ログ等は `test-results/` ディレクトリ配下にのみ出力。
- **履歴更新**: 変更が生じた場合は `CHANGE_HISTORY.md` の**先頭（1行目）**に `YYYY/MM/DD HH:mm:ss: {内容}` の形式で追記。

---

## 8. テスト体制 ＆ 自動テスト仕様 (Playwright / Docker)

本プロジェクトでは品質担保のため、**4階層の自動テストスイートに加えて、1VJ対複数DJおよび事故復旧シナリオ**を整備し、Docker環境でシームレスに一括検証できるテスト体制を構築しています。

```
+-------------------------------------------------------------------+
|                  PDVH 自動テストスイート (10/10 PASS)               |
+-------------------------------------------------------------------+
|  1. 単体テスト (Unit)           | parser.js のファイル構文解析検証    |
|  2. API統合テスト (Integration)  | PHPバックエンド (register/action)   |
|  3. シナリオE2E (Single Session)| DJ・VJ間の選曲/READY一巡フロー     |
|  4. シナリオE2E (VJ Lobby)      | 10文字コード生成 & 複数DJ接続      |
|  5. シナリオE2E (Multi-DJ)       | 3実プレイリスト、複数SEND、追加・削除、リロード・ブラウザ閉鎖復旧 |
|  6. UI仕様適合テスト (Alignment)| PC 450px枠 / 全画面フラッシュ / 4ボタン|
+-------------------------------------------------------------------+
```

### 8.1 テスト構成一覧

| カテゴリ | スクリプトパス | 検証内容 | ケース数 |
| :--- | :--- | :--- | :---: |
| **単体テスト** | [`tests/01_parser_unit.spec.js`](file:///workspace/pon_dash_vj_helper/tests/01_parser_unit.spec.js) | M3U/M3U8, CSV, XML (Rekordbox), TXT ファイル解析ロジックの精度検証 | 4 |
| **API統合テスト** | [`tests/02_api_integration.spec.js`](file:///workspace/pon_dash_vj_helper/tests/02_api_integration.spec.js) | `config.php`, `register.php` (セッション発行), `action.php` (SEND/VIBES/READY) 端点動作 | 3 |
| **E2E シナリオ (単一)** | [`tests/03_e2e_single_session.spec.js`](file:///workspace/pon_dash_vj_helper/tests/03_e2e_single_session.spec.js) | 事前登録 〜 DJ/VJログイン 〜 SEND 〜 READY フィードバックの一巡テスト | 1 |
| **E2E シナリオ (ロビー)** | [`tests/04_e2e_vj_lobby.spec.js`](file:///workspace/pon_dash_vj_helper/tests/04_e2e_vj_lobby.spec.js) | VJロビーコード発行 (10文字) 〜 DJロビーコード連携 〜 ロビー画面接続検証 | 1 |
| **E2E シナリオ (Multi-DJ)** | [`tests/05_e2e_multi_dj.spec.js`](file:///workspace/pon_dash_vj_helper/tests/05_e2e_multi_dj.spec.js) | 3つのM3U8、1VJ対3DJ、SEND、未読、削除、DJ/VJリロード・ブラウザ閉鎖後の復旧 | 1 |
| **UI仕様適合テスト** | [`tests/spec_alignment.spec.js`](file:///workspace/pon_dash_vj_helper/tests/spec_alignment.spec.js) | PC 450pxフレーム枠、素材検索4ボタン、画面全体フラッシュクラス発火検証 | 1 |

### 8.2 一括テスト実行コマンド

以下のコマンドで、全 10 テストケースを Docker コンテナ内で一括実行できます。

```bash
# 全テストスイートの一括実行 (Docker)
docker compose exec playwright bash tests/run_all_tests.sh
```

### 8.3 テスト結果・レポート出力
テストの実行ログおよびサマリーレポートは、規約に基づきすべて `test-results/` ディレクトリ配下に自動出力されます。
- `test-results/summary.json`: 全テストケースの合否結果および所要時間
- `test-results/spec_verification_report.json`: UI仕様適合検証の個別詳細データ

### 8.4 マルチデバイス外観ビジュアル検証 ＆ レイアウト収まりテスト
各種端末（PC、iPhone 3世代、Android 3パターン）における画面遷移フェーズごとの高画質スクリーンショット（計49枚）の撮影と、要素はみ出し・スクロールオーバーフローの自動判定アサーションを実施します。
- **撮影 ＆ 検証スクリプト**: [`tests/visual_screenshots.spec.js`](file:///workspace/pon_dash_vj_helper/tests/visual_screenshots.spec.js)
- **レイアウト検証詳細レポート**: [`test-results/layout_verification_report.json`](file:///workspace/pon_dash_vj_helper/test-results/layout_verification_report.json) (全49画面で `passed: true`)
- **保管ディレクトリ**: [`test-results/screenshots/`](file:///workspace/pon_dash_vj_helper/test-results/screenshots/)
- **目視確認カタログ**: [`test-results/screenshots/README.md`](file:///workspace/pon_dash_vj_helper/test-results/screenshots/README.md)
- **HTML ギャラリービューア**: [`test-results/screenshots/index.html`](file:///workspace/pon_dash_vj_helper/test-results/screenshots/index.html)


