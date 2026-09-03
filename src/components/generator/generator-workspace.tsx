"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  CircleAlert,
  Download,
  FileText,
  FlaskConical,
  ImageIcon,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  ScanText,
  WandSparkles,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  ApiClientError,
  findMatches,
  getHealth,
  recognizeImage,
} from "@/lib/generator/api"
import {
  composeImagePoster,
  composePoster,
  downloadPoster,
  resolveOcrMatchBox,
  type Poster,
} from "@/lib/generator/composer"
import { prepareImage, type PreparedImage } from "@/lib/generator/image"
import { selectAutomaticHits } from "@/lib/generator/selection"

type BusyState = "idle" | "preparing" | "ocr" | "matching" | "composing"
type Stage = "input" | "output"

const stages: Stage[] = ["input", "output"]
const authorMark = process.env.NEXT_PUBLIC_AUTHOR_MARK ?? ""
const demoText =
  "子路遇见桀溺以后才问方向。小海读书并记录感言，这种做法已成为主流。最后大家一起击退暴走野猪。"
const samples = [
  { id: "jie-ni", image: "/samples/jie-ni.png" },
  { id: "cai-wen", image: "/samples/cai-wen.png" },
  { id: "zhu-liu", image: "/samples/zhu-liu.png" },
  { id: "shu-bing", image: "/samples/shu-bing.png" },
  { id: "ji-tui-bao", image: "/samples/ji-tui-bao.png" },
]

export function GeneratorWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>("input")
  const [inputMode, setInputMode] = useState<"image" | "text">("image")
  const [prepared, setPrepared] = useState<PreparedImage | null>(null)
  const [fileName, setFileName] = useState("upload.jpg")
  const [demoId, setDemoId] = useState<string | undefined>()
  const [sourceText, setSourceText] = useState("")
  const [posters, setPosters] = useState<Poster[]>([])
  const [busy, setBusy] = useState<BusyState>("idle")
  const [composeProgress, setComposeProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getHealth().catch(() => setError("后端 API 尚未启动。"))
  }, [])

  const stageIndex = stages.indexOf(stage)

  function releasePosters() {
    posters.forEach((poster) => URL.revokeObjectURL(poster.url))
    setPosters([])
    setComposeProgress(0)
  }

  async function acceptFile(file: File, nextDemoId?: string) {
    setError(null)
    setBusy("preparing")
    try {
      const next = await prepareImage(file)
      if (prepared) URL.revokeObjectURL(prepared.previewUrl)
      setPrepared(next)
      setFileName(file.name || "upload.jpg")
      setDemoId(nextDemoId)
      setSourceText("")
      releasePosters()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "图片处理失败")
    } finally {
      setBusy("idle")
    }
  }

  async function chooseSample(sample: (typeof samples)[number]) {
    setBusy("preparing")
    setError(null)
    try {
      const response = await fetch(sample.image)
      const blob = await response.blob()
      await acceptFile(
        new File([blob], `${sample.id}.jpg`, { type: blob.type }),
        sample.id,
      )
    } catch {
      setError("示例图片加载失败")
      setBusy("idle")
    }
  }

  async function generateFromImage() {
    if (!prepared) return
    setBusy("ocr")
    setError(null)
    releasePosters()
    const generated: Poster[] = []
    try {
      const ocr = await recognizeImage({
        image: prepared.blob,
        fileName,
        demoId,
      })
      setSourceText(ocr.text)
      setBusy("matching")
      const result = await findMatches(ocr.text)
      const selectedHits = selectAutomaticHits(
        result.hits.filter((hit) => resolveOcrMatchBox(ocr, hit)),
      )
      if (!selectedHits.length) {
        setError("没有找到可标注的谐音。")
        return
      }
      setBusy("composing")
      for (let index = 0; index < selectedHits.length; index += 1) {
        const poster = await composeImagePoster(
          prepared,
          ocr,
          selectedHits[index],
          authorMark,
        )
        generated.push(poster)
        setPosters([...generated])
        setComposeProgress(((index + 1) / selectedHits.length) * 100)
      }
      setStage("output")
    } catch (nextError) {
      setError(
        nextError instanceof ApiClientError
          ? nextError.message
          : nextError instanceof Error
            ? nextError.message
            : "图片生成失败。",
      )
    } finally {
      setBusy("idle")
    }
  }

  async function generateFromText() {
    if (!sourceText.trim()) return
    setBusy("matching")
    setError(null)
    releasePosters()
    const generated: Poster[] = []
    try {
      const result = await findMatches(sourceText)
      const selectedHits = selectAutomaticHits(result.hits)
      if (!selectedHits.length) {
        setError("没撞上，再换段文字试试。")
        return
      }
      setBusy("composing")
      for (let index = 0; index < selectedHits.length; index += 1) {
        const poster = await composePoster(
          sourceText,
          selectedHits[index],
          authorMark,
        )
        generated.push(poster)
        setPosters([...generated])
        setComposeProgress(((index + 1) / selectedHits.length) * 100)
      }
      setStage("output")
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "图片生成失败")
    } finally {
      setBusy("idle")
    }
  }

  function reset() {
    if (prepared) URL.revokeObjectURL(prepared.previewUrl)
    releasePosters()
    setPrepared(null)
    setDemoId(undefined)
    setSourceText("")
    setInputMode("image")
    setStage("input")
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div
        className="flex gap-2"
        aria-label={`第 ${stageIndex + 1} 页，共 ${stages.length} 页`}
      >
        {stages.map((item, index) => (
          <span
            key={item}
            className={`h-1.5 rounded-full transition-all ${
              index === stageIndex
                ? "w-8 bg-red-600"
                : index < stageIndex
                  ? "w-4 bg-red-200"
                  : "w-4 bg-muted"
            }`}
          />
        ))}
      </div>

      {error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div key={stage} className="animate-in fade-in slide-in-from-right-4 duration-300">
        {stage === "input" ? (
          <section className="min-h-[560px]">
            <Tabs
              value={inputMode}
              onValueChange={(value) =>
                setInputMode(value as "image" | "text")
              }
            >
                <TabsList>
                  <TabsTrigger
                    value="image"
                    aria-label="图片输入"
                    title="图片"
                  >
                    <ImageIcon />
                  </TabsTrigger>
                  <TabsTrigger
                    value="text"
                    aria-label="文字输入"
                    title="文字"
                  >
                    <FileText />
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="image" className="mt-5 space-y-5">
                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void acceptFile(file)
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      const file = event.dataTransfer.files[0]
                      if (file) void acceptFile(file)
                    }}
                    aria-label="选择或拖放图片"
                    title="选择图片"
                    className="flex min-h-64 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed bg-muted/20 p-6 transition hover:border-red-300"
                  >
                    {prepared ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={prepared.previewUrl}
                        alt="待识别图片"
                        className="max-h-80 rounded-lg object-contain shadow-sm"
                      />
                    ) : (
                      <span className="grid size-14 place-items-center rounded-full bg-background shadow-sm">
                        <ImagePlus className="size-6 text-red-600" />
                      </span>
                    )}
                  </button>

                  <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                    {samples.map((sample, index) => (
                      <Button
                        key={sample.id}
                        type="button"
                        variant={demoId === sample.id ? "default" : "outline"}
                        className="h-auto w-44 shrink-0 snap-start p-1.5 sm:w-52"
                        aria-label={`选择样例 ${index + 1}`}
                        onClick={() => void chooseSample(sample)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sample.image}
                          alt=""
                          className="aspect-[12/7] w-full rounded-md border bg-white object-cover"
                        />
                      </Button>
                    ))}
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="lg"
                      disabled={!prepared || busy !== "idle"}
                      onClick={() => void generateFromImage()}
                    >
                      {busy === "ocr" || busy === "preparing" ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <ScanText />
                      )}
                      生成
                    </Button>
                  </div>
                  {busy === "matching" || busy === "composing" ? (
                    <Progress value={composeProgress} />
                  ) : null}
                </TabsContent>

                <TabsContent value="text" className="mt-5 space-y-4">
                  <Textarea
                    value={sourceText}
                    maxLength={2000}
                    placeholder="粘贴文字"
                    className="min-h-72 text-base leading-7"
                    onChange={(event) => setSourceText(event.target.value)}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      aria-label="填入示例文字"
                      title="示例"
                      onClick={() => setSourceText(demoText)}
                    >
                      <FlaskConical />
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      disabled={!sourceText.trim() || busy !== "idle"}
                      onClick={() => void generateFromText()}
                    >
                      {busy === "matching" || busy === "composing" ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <WandSparkles />
                      )}
                      生成
                    </Button>
                  </div>
                  {busy === "matching" || busy === "composing" ? (
                    <Progress value={composeProgress} />
                  ) : null}
                </TabsContent>
            </Tabs>
          </section>
        ) : null}

        {stage === "output" ? (
          <section className="min-h-[560px]">
            <div className="grid max-h-[62vh] gap-5 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
              {posters.map((poster) => (
                <div
                  key={poster.hitId}
                  className="space-y-3 rounded-xl border bg-background p-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={poster.url}
                    alt={poster.title}
                    className="w-full rounded-lg border"
                  />
                  <p className="text-center text-sm font-medium">
                    {poster.originalText}
                    <span className="px-2 text-muted-foreground">→</span>
                    {poster.matchedText}
                  </p>
                  <Button
                    type="button"
                    className="w-full"
                    aria-label={`下载 ${poster.title}`}
                    onClick={() => downloadPoster(poster)}
                  >
                    <Download />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-between">
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                aria-label="返回输入"
                title="返回"
                onClick={() => setStage("input")}
              >
                <ArrowLeft />
              </Button>
              <Button
                type="button"
                size="icon-lg"
                aria-label="重新开始"
                title="重新开始"
                onClick={reset}
              >
                <RotateCcw />
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
