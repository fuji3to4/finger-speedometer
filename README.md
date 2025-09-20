Finger Speedometer (MediaPipe Hands)
===================================

人差し指の先（ランドマーク #8）の速度を計測して表示するミニアプリです。MediaPipe Tasks (HandLandmarker) を使用し、カメラ映像上に手のランドマークと速度HUDを重畳表示します。

[https://fuji3to4.github.io/finger-speedometer/]

機能

- カメラプレビュー + ランドマーク描画
- worldLandmarks を用いた 3D 空間上の速度 [m/s] 推定（人差し指先端）
- 最高速度の記録
- Start / Stop / Reset ボタン

要件

- Node.js 20 以上推奨
- ブラウザのカメラ使用許可（HTTPS 環境推奨）

セットアップ

```powershell
npm ci
```

開発サーバー

```powershell
npm run dev
# http://localhost:3000 を開く
```

ビルド（静的出力）
本プロジェクトは Next.js の `output: "export"` を使用しています。

```powershell
npm run export  # out/ に静的出力が生成されます
```

GitHub Pages（自動デプロイ）

- `.github/workflows/deploy-gh-pages.yml` により、master/main への push で自動ビルド/配信
- Actions 内で `NEXT_PUBLIC_BASE_PATH=/<repo名>` を設定してサブパス配信に対応
- GitHub リポジトリ → Settings → Pages → Source: GitHub Actions を選択

実装メモ

- 座標系
  - `result.landmarks` は画像座標の正規化（x:幅基準, y:高さ基準, z:幅基準）
  - `result.worldLandmarks` はメートル単位の3D（相対スケール）。速度計算はこれを使用

- 速度 [m/s]
  - 連続フレームの world 座標差分を dt で割って算出（指数平均で fps を平滑化）

- パフォーマンス
  - ループは requestAnimationFrame
  - 毎フレームの描画値は useRef に保持して再レンダ抑制

既知の注意点

- 初回はブラウザからカメラアクセス許可が求められます
- 照明や背景コントラストが低いと検出が不安定になります
- worldLandmarks の絶対スケールはカメラ環境に依存します（相対比較に有用）

主なファイル

- `app/components/FingerSpeed.tsx` … コアの検出/描画/速度計算ロジック
- `app/page.tsx` … シンプルなUIを構成

ライセンス

- このプロジェクトは学習/検証目的のサンプルです。必要に応じて追記してください。
