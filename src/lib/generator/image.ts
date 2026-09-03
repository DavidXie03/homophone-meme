export type PreparedImage = {
  blob: Blob
  width: number
  height: number
  previewUrl: string
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("只支持 JPG、PNG 和 WebP 图片")
  }

  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  })
  const maxSide = 2560
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("浏览器不支持图片处理")

  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result ? resolve(result) : reject(new Error("图片压缩失败")),
      "image/jpeg",
      0.86,
    )
  })

  return {
    blob,
    width,
    height,
    previewUrl: URL.createObjectURL(blob),
  }
}
