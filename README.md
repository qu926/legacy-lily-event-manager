# Legacy Lily店 勤怠・予約管理

Legacyグループ Lily店向けに、勤怠、未入力者、長期休暇、開催日、予約枠、ドリンク上限を管理する静的SPAです。

このフォルダは別イベントでも使えるイベント管理アプリを Lily店用に分離したものです。実運用の保存データや Supabase 接続情報は含めていません。

## 起動

依存パッケージのインストールは不要です。

```powershell
cd D:\Ai\tool\legacy-lily-event-manager
npm.cmd start
```

ブラウザで `http://localhost:4173/` を開きます。

## 検証

```powershell
npm.cmd test
npm.cmd run check
```

`test` はコアロジック、デプロイ設定、ローカルサーバーの検証を実行します。`check` は設定・アプリ・サーバーの構文検証を実行します。

## Lily設定

主要設定は `js/config.js` に集約しています。

- `appId`: `legacy-lily-event-manager`。ブラウザ保存領域の識別子にも使われます。
- `brandName`: 画面に表示する店舗名。現在は `Legacy Lily店` です。
- `title`: ブラウザタイトルと画面見出し。
- `eyebrow`: ロゴ横の小見出し。
- `logoPath` / `logoAlt`: Lilyロゴのパスと代替テキスト。
- `localStorageVersion`: ブラウザ内保存キーの版。現在は `v2` です。
- `storageMode`: `"local"` または `"supabase"`。
- `supabaseUrl` / `supabaseAnonKey` / `stateRowId`: Supabase の接続設定と保存行 ID。
- `core.sitePassword` / `core.adminPassword`: 簡易ロック用パスワード。公開前に必ず変更します。
- `core.initialUsers`: 初回起動時に登録するメンバー。現在は `Lily運営` のみです。
- `core.initialRoles`: 初期ロール。
- `core.eventWeekdays`: 通常開催曜日。JavaScript の曜日番号で、日曜が `0`、土曜が `6`。
- `core.eventStartDate`: 初期生成する開催日の開始日。現在は7月中旬予定として `2026-07-15` です。
- `core.extraEventDates`: 通常開催曜日とは別に追加する単発開催日。現在は空です。
- `core.archiveGraceDays`: 過去開催日を自動終了にするまでの猶予日数。現在は `0` です。
- `core.reservationOpenWeekday` / `core.reservationOpenTime`: 予約解放曜日と時刻。
- `core.firstWeekHolidayCandidates`: 各月の最初の開催日を休み候補にするか。

現在の保存IDは `legacy-lily-event-manager` です。別イベントへ複製するときは `appId` と `stateRowId` を必ず変更してください。

## GitHub Pages

GitHubリポジトリ名は `legacy-lily-event-manager` を使用します。公開URLは次です。

```text
https://qu926.github.io/legacy-lily-event-manager/
```

静的公開に必要なファイルは `index.html`、`assets/`、`css/`、`js/` です。

## データ保存

既定の `storageMode: "local"` では `localStorage` に保存します。端末やブラウザをまたいで共有する場合は Supabase を設定します。

1. Supabase でプロジェクトを作成します。
2. `supabase/schema.sql` 内の `'legacy-lily-event-manager'` が、`js/config.js` の `stateRowId` と一致していることを確認します。
3. SQL Editor でスキーマを実行します。
4. `js/config.js` の `storageMode` を `"supabase"` に変更し、Project URL と publishable key または anon public key を設定します。

```js
storageMode: "supabase",
supabaseUrl: "https://xxxxx.supabase.co",
supabaseAnonKey: "sb_publishable_xxxxx",
stateRowId: "legacy-lily-event-manager",
```

`stateRowId` と SQL 内の ID が一致しない場合、読み書きできません。異なるイベントで同じ `stateRowId` を使うとデータが混在するため、イベントごとに必ず分けてください。

## 主な機能

- メンバーと内勤スタッフの勤怠入力
- 未入力者、長期休暇、開催日、休み日の管理
- 予約申請、予約枠、保留枠、インスタンス管理
- ドリンク、タワー上限の集計
- 勤怠との照合警告
- Discord 文面生成
- JSON バックアップ表示
- 変更履歴

## 運用上の注意

- 画面内パスワードは静的サイト上の簡易ロックであり、本格的な認証ではありません。
- Supabase の公開キーと単純な RLS を使う構成は小規模運用向けです。機密情報は保存しないでください。
- 本番開始前に JSON を書き出すバックアップ手順を決めてください。
- 複数端末の同時更新はマージされますが、同じ項目を同時編集した場合は後の更新が優先されます。
