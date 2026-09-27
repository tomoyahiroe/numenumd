# スプリント 12 のノート

Markdown を打つと、その場で見た目のあるブロックに変わります。
**太字**・_斜体_・`インラインコード`・[リンク](https://example.com) もそのまま。

## 決めたこと

1. 保存は Prettier で整形してから書き戻す
2. 変換できない記法は生 Markdown のまま保全する
3. 永続状態は持たない

## 覚えておくこと

- 見出しは `#` 〜 `######`、引用は大なり記号で始める
- 保存は Cmd+S。初回だけ保存先を選び、以降は無音で上書き
- 太字は Cmd+B、リンクは Cmd+K

> サーバーもアカウントも要らない。状態はタブと `.md` ファイルだけにある。

```ts
export async function docToMd(doc: JSONContent): Promise<string> {
  return format(serialize(doc), { parser: 'markdown' });
}
```
