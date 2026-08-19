# フォント変更計画（BIZ UDPGothic + Nunito）

## 変更内容

### 1. Google Fonts リンクの置き換え（HTMLファイル）
**対象ファイル**: `dj.html`, `dj-register.html`, `vj.html`, `dj-manual.html`, `vj-manual.html`

**削除**:
```html
<link href="https://fonts.googleapis.com/css2?family=Shippori+Antique&display=swap" rel="stylesheet">
```

**追加**:
```html
<link href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic&family=Nunito&display=swap" rel="stylesheet">
```

### 2. CSS フォントファミリーの変更
**対象ファイル**: `assets/css/style.css`

**変更箇所**:
```css
/* 変更前 */
--font-family: "Shippori Antique", sans-serif;

/* 変更後 */
--font-family: "BIZ UDPGothic", "Nunito", sans-serif;
```

## 変更手順

1. 上記HTMLファイルにGoogle Fontsリンクを置き換える
2. `assets/css/style.css` のCSS変数を更新する
3. ブラウザで各ページを表示してフォントが正しく適用されていることを確認する
4. 必要に応じてレイアウトの調整を行う

## 備考
- BIZ UDPGothicとNunitoの両方を指定していますが、表示環境によってはNunitoがインストールされていない場合があります。そのため、sans-serifを最後のフォールバックとして残しています。
- デザインの整合性を確認するため、すべてのページでテストをお願いします。