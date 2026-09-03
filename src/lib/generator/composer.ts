import type { MatchHit, OcrResponse } from "@meme/core"

import type { PreparedImage } from "./image"

export type Poster = {
  hitId: string
  title: string
  originalText: string
  matchedText: string
  blob: Blob
  url: string
}

type GlyphBox = {
  start: number
  end: number
  x: number
  y: number
  width: number
  height: number
}

const WIDTH = 1080
const HEIGHT = 1080

function excerptForHit(text: string, hit: MatchHit) {
  const maxBefore = 32
  const maxAfter = 48
  const start = Math.max(0, hit.start - maxBefore)
  const end = Math.min(text.length, hit.end + maxAfter)
  return {
    text: `${start > 0 ? "……" : ""}${text.slice(start, end)}${end < text.length ? "……" : ""}`,
    start: hit.start - start + (start > 0 ? 2 : 0),
    end: hit.end - start + (start > 0 ? 2 : 0),
  }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

function drawArrow(
  context: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  lineWidth = 14,
) {
  context.save()
  context.strokeStyle = "#e3262e"
  context.fillStyle = "#e3262e"
  context.lineWidth = lineWidth
  context.lineCap = "round"
  const dx = toX - fromX
  const dy = toY - fromY
  const control1X = fromX + dx * 0.12
  const control1Y = fromY + dy * 0.45
  const control2X = toX - dx * 0.22
  const control2Y = toY - dy * 0.24
  context.beginPath()
  context.moveTo(fromX, fromY)
  context.bezierCurveTo(
    control1X,
    control1Y,
    control2X,
    control2Y,
    toX,
    toY,
  )
  context.stroke()
  const angle = Math.atan2(toY - control2Y, toX - control2X)
  context.beginPath()
  context.moveTo(toX, toY)
  const arrowSize = lineWidth * 3
  context.lineTo(
    toX - arrowSize * Math.cos(angle - Math.PI / 6),
    toY - arrowSize * Math.sin(angle - Math.PI / 6),
  )
  context.lineTo(
    toX - arrowSize * Math.cos(angle + Math.PI / 6),
    toY - arrowSize * Math.sin(angle + Math.PI / 6),
  )
  context.closePath()
  context.fill()
  context.restore()
}

async function loadImage(url: string) {
  const image = new Image()
  image.crossOrigin = "anonymous"
  image.decoding = "async"
  image.src = url
  await image.decode()
  return image
}

function drawBody(
  context: CanvasRenderingContext2D,
  text: string,
  matchStart: number,
  matchEnd: number,
) {
  const glyphs: GlyphBox[] = []
  const fontSize = 48
  const lineHeight = 76
  const left = 84
  const right = 996
  const top = 96
  let x = left
  let y = top
  let offset = 0

  context.fillStyle = "#1d1b18"
  context.font = `500 ${fontSize}px "Noto Serif SC", "Songti SC", serif`
  context.textBaseline = "top"

  for (const character of Array.from(text)) {
    const start = offset
    offset += character.length
    if (character === "\n") {
      x = left
      y += lineHeight
      continue
    }

    const width = Math.max(fontSize, context.measureText(character).width)
    const insideMatch = start >= matchStart && start < matchEnd
    const matchLength = Array.from(text.slice(matchStart, matchEnd)).length
    const remaining = Math.floor((right - x) / fontSize)
    if (
      x + width > right ||
      (insideMatch && start === matchStart && remaining < matchLength)
    ) {
      x = left
      y += lineHeight
    }
    if (y > 405) break
    context.fillText(character, x, y)
    glyphs.push({
      start,
      end: offset,
      x,
      y,
      width,
      height: fontSize + 6,
    })
    x += width + 2
  }
  return glyphs
}

function drawCircle(
  context: CanvasRenderingContext2D,
  boxes: GlyphBox[],
  start: number,
  end: number,
) {
  const selected = boxes.filter((box) => box.start >= start && box.end <= end)
  if (!selected.length) return null
  const minX = Math.min(...selected.map((box) => box.x)) - 18
  const maxX = Math.max(...selected.map((box) => box.x + box.width)) + 18
  const minY = Math.min(...selected.map((box) => box.y)) - 12
  const maxY = Math.max(...selected.map((box) => box.y + box.height)) + 12
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  context.save()
  context.strokeStyle = "#e3262e"
  context.lineWidth = 11
  context.lineCap = "round"
  for (const jitter of [-3, 3]) {
    context.beginPath()
    context.ellipse(
      centerX + jitter,
      centerY - jitter,
      (maxX - minX) / 2,
      (maxY - minY) / 2,
      -0.03,
      0,
      Math.PI * 2,
    )
    context.stroke()
  }
  context.restore()
  return { x: centerX, y: maxY }
}

export type MatchBox = {
  x: number
  y: number
  width: number
  height: number
}

export function resolveOcrMatchBox(
  ocr: OcrResponse,
  hit: MatchHit,
): MatchBox | null {
  const line = ocr.lines.find(
    (item) =>
      item.box && hit.start >= item.start && hit.end <= item.end,
  )
  if (!line?.box || !line.text.length) return null

  const localStart = Math.max(0, hit.start - line.start)
  const localEnd = Math.min(line.text.length, hit.end - line.start)
  const startRatio = localStart / line.text.length
  const lengthRatio = Math.max(1, localEnd - localStart) / line.text.length
  const isVertical =
    ocr.orientation === "vertical" ||
    (ocr.orientation === "unknown" && line.box.height > line.box.width)
  if (isVertical) {
    return {
      x: line.box.x,
      y: line.box.y + line.box.height * startRatio,
      width: line.box.width,
      height: line.box.height * lengthRatio,
    }
  }
  return {
    x: line.box.x + line.box.width * startRatio,
    y: line.box.y,
    width: line.box.width * lengthRatio,
    height: line.box.height,
  }
}

export async function composeImagePoster(
  source: PreparedImage,
  ocr: OcrResponse,
  hit: MatchHit,
  authorMark = "",
): Promise<Poster> {
  const matchBox = resolveOcrMatchBox(ocr, hit)
  if (!matchBox) throw new Error("没有找到命中文字的位置")

  const sourceImage = await loadImage(source.previewUrl)
  const outputScale = Math.min(
    1,
    1600 / Math.max(source.width, source.height),
  )
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(source.width * outputScale))
  canvas.height = Math.max(1, Math.round(source.height * outputScale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("浏览器不支持 Canvas")
  context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height)

  const scaleX = canvas.width / source.width
  const scaleY = canvas.height / source.height
  const box = {
    x: matchBox.x * scaleX,
    y: matchBox.y * scaleY,
    width: matchBox.width * scaleX,
    height: matchBox.height * scaleY,
  }
  const minSide = Math.min(canvas.width, canvas.height)
  const strokeWidth = Math.max(5, minSide * 0.012)
  const padding = Math.max(10, strokeWidth * 1.5)
  const matchCenterX = box.x + box.width / 2
  const matchCenterY = box.y + box.height / 2

  context.save()
  context.strokeStyle = "#e3262e"
  context.lineWidth = strokeWidth
  context.lineCap = "round"
  for (const jitter of [-strokeWidth * 0.18, strokeWidth * 0.18]) {
    context.beginPath()
    context.ellipse(
      matchCenterX + jitter,
      matchCenterY - jitter,
      box.width / 2 + padding,
      box.height / 2 + padding * 0.65,
      -0.03,
      0,
      Math.PI * 2,
    )
    context.stroke()
  }
  context.restore()

  const cardWidth = Math.min(
    canvas.width * 0.48,
    Math.max(220, minSide * 0.48),
  )
  const cardHeight = cardWidth * 0.75
  const margin = Math.max(24, minSide * 0.055)
  const cardX =
    matchCenterX < canvas.width / 2
      ? canvas.width - cardWidth - margin
      : margin
  const cardBelow = matchCenterY < canvas.height / 2
  const cardY = cardBelow
    ? canvas.height - cardHeight - margin
    : margin
  const arrowFromY = cardBelow
    ? box.y + box.height + padding
    : box.y - padding
  const arrowToY = cardBelow ? cardY : cardY + cardHeight

  drawArrow(
    context,
    matchCenterX,
    arrowFromY,
    cardX + cardWidth / 2,
    arrowToY,
    strokeWidth,
  )

  context.save()
  context.shadowColor = "rgba(20, 16, 10, .2)"
  context.shadowBlur = Math.max(15, minSide * 0.03)
  context.fillStyle = "#fff"
  roundedRect(
    context,
    cardX,
    cardY,
    cardWidth,
    cardHeight,
    cardWidth * 0.08,
  )
  context.fill()
  context.restore()

  try {
    const entityImage = await loadImage(hit.entity.imageUrl)
    const inset = cardWidth * 0.06
    const scale = Math.min(
      (cardWidth - inset * 2) / entityImage.width,
      (cardHeight - inset * 2) / entityImage.height,
    )
    const width = entityImage.width * scale
    const height = entityImage.height * scale
    context.drawImage(
      entityImage,
      cardX + (cardWidth - width) / 2,
      cardY + (cardHeight - height) / 2,
      width,
      height,
    )
  } catch {
    context.fillStyle = "#1d1b18"
    context.font = `700 ${Math.max(24, cardWidth * 0.12)}px sans-serif`
    context.textAlign = "center"
    context.fillText(
      hit.entity.displayName,
      cardX + cardWidth / 2,
      cardY + cardHeight / 2,
    )
  }

  if (authorMark.trim()) {
    const fontSize = Math.max(14, minSide * 0.025)
    context.font = `500 ${fontSize}px sans-serif`
    context.textAlign = "right"
    const text = authorMark.trim().slice(0, 48)
    const textWidth = context.measureText(text).width
    const x = canvas.width - margin
    const y = canvas.height - margin * 0.55
    context.fillStyle = "rgba(255,255,255,.78)"
    roundedRect(
      context,
      x - textWidth - fontSize,
      y - fontSize * 1.25,
      textWidth + fontSize * 1.35,
      fontSize * 1.65,
      fontSize,
    )
    context.fill()
    context.fillStyle = "#59544c"
    context.fillText(text, x - fontSize * 0.2, y)
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("图片导出失败"))),
      "image/png",
    )
  })
  return {
    hitId: hit.id,
    title: `${hit.surface}-${hit.entity.displayName}`,
    originalText: hit.surface,
    matchedText: hit.entity.displayName,
    blob,
    url: URL.createObjectURL(blob),
  }
}

export async function composePoster(
  text: string,
  hit: MatchHit,
  authorMark = "",
): Promise<Poster> {
  await document.fonts.ready
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext("2d")
  if (!context) throw new Error("浏览器不支持 Canvas")

  const background = context.createLinearGradient(0, 0, WIDTH, HEIGHT)
  background.addColorStop(0, "#f9f6ef")
  background.addColorStop(1, "#eee5d4")
  context.fillStyle = background
  context.fillRect(0, 0, WIDTH, HEIGHT)
  context.fillStyle = "#fffefb"
  roundedRect(context, 38, 38, WIDTH - 76, HEIGHT - 76, 36)
  context.fill()
  context.strokeStyle = "#ded5c4"
  context.lineWidth = 3
  context.stroke()

  const excerpt = excerptForHit(text, hit)
  const boxes = drawBody(context, excerpt.text, excerpt.start, excerpt.end)
  const anchor = drawCircle(context, boxes, excerpt.start, excerpt.end)

  const imageX = 300
  const imageY = 560
  const imageWidth = 480
  const imageHeight = 360

  drawArrow(
    context,
    anchor?.x ?? WIDTH / 2,
    (anchor?.y ?? 390) + 14,
    imageX + imageWidth / 2,
    imageY,
  )

  context.fillStyle = "#ffffff"
  context.shadowColor = "rgba(46, 37, 21, .16)"
  context.shadowBlur = 38
  roundedRect(context, imageX, imageY, imageWidth, imageHeight, 38)
  context.fill()
  context.shadowColor = "transparent"
  context.strokeStyle = "#ebe5da"
  context.lineWidth = 3
  context.stroke()

  try {
    const image = await loadImage(hit.entity.imageUrl)
    context.save()
    roundedRect(context, imageX + 12, imageY + 12, imageWidth - 24, imageHeight - 24, 28)
    context.clip()
    const scale = Math.min(
      (imageWidth - 42) / image.width,
      (imageHeight - 42) / image.height,
    )
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    context.drawImage(
      image,
      imageX + (imageWidth - drawWidth) / 2,
      imageY + (imageHeight - drawHeight) / 2,
      drawWidth,
      drawHeight,
    )
    context.restore()
  } catch {
    context.fillStyle = "#1d1b18"
    context.font = `700 52px "Noto Serif SC", serif`
    context.textAlign = "center"
    context.fillText(hit.entity.displayName, imageX + imageWidth / 2, imageY + 130)
    context.textAlign = "left"
  }

  if (authorMark.trim()) {
    context.textAlign = "right"
    context.fillStyle = "#a69d8e"
    context.font = `500 22px "Noto Sans SC", sans-serif`
    context.fillText(authorMark.trim().slice(0, 48), WIDTH - 78, 1000)
    context.textAlign = "left"
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("海报导出失败"))),
      "image/png",
    )
  })

  return {
    hitId: hit.id,
    title: `${hit.surface}-${hit.entity.displayName}`,
    originalText: hit.surface,
    matchedText: hit.entity.displayName,
    blob,
    url: URL.createObjectURL(blob),
  }
}

export function downloadPoster(poster: Poster) {
  const link = document.createElement("a")
  link.href = poster.url
  link.download = `${poster.title}.png`
  link.click()
}
