/**
 * Iris Onboard 构建脚本
 * 使用 bun build --compile 为各平台编译独立二进制
 */
import { mkdir } from "fs/promises"

const platforms = [
  { name: "linux-x64", target: "bun-linux-x64" },
  { name: "linux-arm64", target: "bun-linux-arm64" },
] as const

async function build() {
  await mkdir("dist", { recursive: true })

  for (const platform of platforms) {
    const outfile = `dist/iris-onboard-${platform.name}`
    console.log(`\n🔨 Building for ${platform.name}...`)

    await Bun.build({
      entrypoints: ["./src/index.tsx"],
      compile: {
        outfile,
        target: platform.target as any,
      },
      minify: true,
    })

    console.log(`✅ ${outfile}`)
  }

  console.log("\n🎉 All builds complete!")
}

build().catch((err) => {
  console.error("Build failed:", err)
  process.exit(1)
})
