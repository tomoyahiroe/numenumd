# Chrome ウェブストア 公開手順

初回公開(デベロッパー登録から審査提出まで)と、その後の自動リリース(CD)を
有効化するまでの手順。貼り付ける文面は [`store-listing.md`](store-listing.md)
にまとまっている。

リポジトリ側の準備(アイコン、掲載画像、プライバシーポリシー、CD ワークフロー)は
すでに完了している。ここに残っているのは **人間にしかできない操作** だけ。

---

## 事前に決めておくこと

### リポジトリが private の場合

`tomoyahiroe/numenumd` は現在 **private**。このままだと次の 2 つが問題になる。

- **プライバシーポリシーの URL**: 審査担当者が開けないと差し戻される。
- **ホームページ / サポート URL**: 同上。private URL は入れないこと。

どちらかを選ぶ。

| 選択肢                               | 対応                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **リポジトリを public にする**(推奨) | `PRIVACY.md` がそのまま公開 URL になる。掲載情報の URL 欄もリポジトリ URL で統一できる。                                                         |
| **private のまま公開する**           | `PRIVACY.md` の内容を公開 Gist に貼り、その URL をプライバシーポリシー欄に入れる。ホームページ / サポート URL は空欄にするか別の場所を用意する。 |

公開 Gist を使う場合:

```bash
gh gist create PRIVACY.md --public --desc "numenumd プライバシーポリシー"
```

---

## 1. デベロッパー登録(初回のみ・$5)

1. <https://chrome.google.com/webstore/devconsole> を開く。
2. 拡張機能の公開に使う Google アカウントでログインする。
   - **後から変更しにくいので、長く使えるアカウントを選ぶこと。** この
     アカウントが CD 用の OAuth トークン発行にもそのまま必要になる。
3. デベロッパー契約に同意し、**登録料 $5(1 回限り・返金不可)** を支払う。
4. 連絡先メールアドレスを登録し、確認メールから **メールアドレスの確認** を
   済ませる。未確認のままだとアイテムを審査に出せない。

> 支払いと本人確認は代行できないため、ここは必ず本人が操作する。

---

## 2. アップロードする zip を用意する

CI が出しているものと同じ zip をローカルで作る。

```bash
npm ci
npm run build
cd dist && zip -r ../extension.zip . && cd ..
```

`extension.zip` がリポジトリのルートに出来る。中身に
`manifest.json` と `icons/icon-128.png` が入っていることを確認する。

```bash
unzip -l extension.zip | grep -E "manifest.json|icons/"
```

> リリースタグを先に push している場合は、GitHub Actions の `Release`
> ワークフローが作った `extension-zip` アーティファクトを
> ダウンロードしても同じものが手に入る。

---

## 3. アイテムを作成して掲載情報を入力する

1. デベロッパー ダッシュボードで **「新しいアイテム」** を押し、`extension.zip`
   をアップロードする。
2. **「ストアの掲載情報」** タブを開き、[`store-listing.md`](store-listing.md)
   の「ストアの掲載情報」節から貼り付ける。
   - 言語 → 日本語
   - アイテム名 / 概要 / 詳細な説明
   - カテゴリ → 仕事効率化 → ワークフローと計画
   - スクリーンショット 5 枚(`docs/store-assets/screenshot-*.png`)
   - 小さいプロモーション タイル(`docs/store-assets/promo-small-tile.png`)
3. **「プライバシー」** タブを開き、同ファイルの「プライバシー タブ」節から
   貼り付ける。
   - 単一用途の説明
   - `file:///*` の権限の正当な理由
   - リモートコードの使用 → いいえ
   - データ使用の申告 → すべて「収集しない」
   - 3 つの証明チェックボックス → すべてチェック
   - プライバシーポリシーの URL
4. **「販売状況と公開設定」** タブで、公開設定を **一般公開**、販売地域を
   **すべての地域** にする。
5. **「審査のために送信」** を押す。

審査には通常数日かかる。`file:///*` のホスト権限を持つ拡張機能は
権限の正当化を重点的に見られるため、上記の文面をそのまま使うこと。

---

## 4. 公開されたら拡張 ID を控える

公開後、ダッシュボードのアイテム URL に含まれる 32 文字の英小文字列が
拡張 ID になる。

```
https://chrome.google.com/webstore/devconsole/.../<ここが拡張 ID>/edit
```

次の手順で `CWS_EXTENSION_ID` として使う。

---

## 5. 自動リリース(CD)を有効化する

`.github/workflows/release.yml` は Secrets が設定されていれば自動で
アップロード・公開まで行い、未設定なら publish ジョブをスキップする。
以下を設定すると有効になる。

### 5-1. Google Cloud 側で OAuth クライアントを作る

1. <https://console.cloud.google.com/> でプロジェクトを作成する(名前は任意)。
2. **API とサービス → ライブラリ** で **Chrome Web Store API** を有効化する。
3. **OAuth 同意画面** を設定する。
   - User Type: **外部**
   - アプリ名・サポートメール・デベロッパー連絡先を入力
   - **テストユーザー** に、手順 1 で使った Google アカウントを追加する
     (公開申請は不要。テストモードのままでよい)
4. **認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - アプリケーションの種類: **デスクトップ アプリ**
   - 作成後に表示される **クライアント ID** と **クライアント シークレット**
     を控える。

### 5-2. リフレッシュトークンを取得する

```bash
npx chrome-webstore-upload-keys
```

対話プロンプトにクライアント ID / シークレットを入力すると、ブラウザが開いて
認可を求められる。承認するとリフレッシュトークンが表示される。

> 手順 1 の Google アカウント(= デベロッパー登録したアカウント)で認可する
> こと。別アカウントで取ると、アップロード時に権限エラーになる。

### 5-3. GitHub Secrets に登録する

```bash
gh secret set CWS_CLIENT_ID
gh secret set CWS_CLIENT_SECRET
gh secret set CWS_REFRESH_TOKEN
gh secret set CWS_EXTENSION_ID
```

4 つすべてが揃って初めて publish ジョブが動く(`CWS_CLIENT_ID` が空だと
ジョブ全体がスキップされる)。

---

## 6. 2 回目以降のリリース

```bash
# 1. バージョンを上げる(package.json が単一ソース)
npm version 0.3.0 --no-git-tag-version

# 2. コミットして PR → マージ(CLAUDE.md のマージゲートに従う)

# 3. タグを push
git tag v0.3.0
git push origin v0.3.0
```

タグ push をトリガーに `Release` ワークフローが走り、タグ名と
`package.json` の `version` の一致を検証したうえで
`npm test` → `npm run build` → zip → ストアへアップロード・公開する。

### 注意点

- **`--auto-publish` が指定されている。** アップロードされた新バージョンは
  審査を通り次第、自動的に公開される。段階的公開や手動リリースをしたい場合は
  `release.yml` からこのフラグを外す。
- **審査中に次のタグを push しない。** 前のバージョンが審査待ちの状態で
  アップロードすると API がエラーを返し、ワークフローが失敗する。
- **バージョンは必ず単調増加させる。** 同じバージョンの再アップロードは
  ストア側で拒否される。

---

## 掲載画像を撮り直す

サンプル文書や UI を変えたときは、次のコマンドで `docs/store-assets/` を
まとめて再生成できる(生成された PNG もコミットする)。

```bash
npm run build:store-assets
```

アイコンのデザインを変えた場合は、`assets/icon.svg` を編集してから:

```bash
npm run build:icons   # librsvg か ImageMagick が必要
```

詳細は [`../tools/store-screenshots/README.md`](../tools/store-screenshots/README.md)。
