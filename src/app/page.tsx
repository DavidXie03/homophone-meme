import { GeneratorWorkspace } from "@/components/generator/generator-workspace"

export const metadata = {
  title: "谐音圈图",
  description: "上传图片，找出谐音并生成梗图。",
}

export default function Home() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,oklch(0.96_0.04_55),transparent_34%),linear-gradient(to_bottom,oklch(0.99_0.01_75),white)]">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center px-4 py-4 sm:px-6">
          <span className="font-[family-name:var(--font-serif)] font-bold">
            谐音圈图
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="mb-6">
          <h1 className="font-[family-name:var(--font-serif)] text-3xl leading-tight font-bold sm:text-5xl">
            圈出文字里的谐音梗
          </h1>
        </section>
        <GeneratorWorkspace />
      </main>
    </div>
  )
}
