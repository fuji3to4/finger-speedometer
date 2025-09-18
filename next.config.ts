import type { NextConfig } from "next"

// GitHub Pages 向けに静的出力を有効化
// リポジトリ名が公開URLに含まれる場合は、環境変数で basePath を指定できるようにします。
const repo = process.env.NEXT_PUBLIC_BASE_PATH?.trim()

const nextConfig: NextConfig = {
  // output: "export", // 静的サイト出力
  images: { unoptimized: true }, // 画像最適化を無効（静的出力と相性のため）
  // GitHub Pages のサブパス配信に対応（例: /finger-speedometer）
  basePath: repo && repo !== "/" ? repo : undefined,
  assetPrefix: repo && repo !== "/" ? `${repo}/` : undefined,
}

export default nextConfig
