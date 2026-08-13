# リスト項目が段落以外のブロックで始まる場合

`listItem` のスキーマは `paragraph block*` なので、段落以外のブロックで始まる項目をパースすると、`createAndFill` が要求を満たすために空の `paragraph` を先頭へ挿入する(元の Markdown には無い)。

これをそのまま書き出すと「空行で始まるリスト項目」になり、CommonMark ではそれは空の項目なので後続ブロックが項目の外へ飛び出す ─ つまり開いて保存するだけでリストが壊れる。

- $$a = b$$
- $$c = d$$

1. $$x = y$$

- ```
  code in a list
  ```
- > quote in a list
- $$
  fenced math in a list
  $$
- - $$nested$$

通常のリストが巻き添えになっていないこと:

- plain item
- another item
- item with a second paragraph

  second paragraph

- [ ] $$task = item$$
