/*import fs from 'fs'

async function generateFrames(tokens, template) {
  const frames = []

  for (let i = 0; i < tokens.length; i++) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    renderWordFrame(ctx, tokens.map(t => t.word), i, template)

    const blob = await new Promise(res => canvas.toBlob(res))
    const path = `/tmp/frame_${i}.png`

    fs.writeFileSync(path, Buffer.from(await blob.arrayBuffer()))

    frames.push({
      path,
      start: tokens[i].startMs,
      end: tokens[i].endMs
    })
  }

  return frames
}

export async function renderAdvancedVideo({
  tokens,
  template,
  videoPath,
  outputPath
}) {
  // 1. generar imágenes por palabra
  // 2. generar script FFmpeg
  // 3. ejecutar FFmpeg
}

function renderWordFrame(ctx, words, activeIndex, template) {
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const { x, y, maxWidth } = template

  let cursorX = x
  let cursorY = y

  words.forEach((word, i) => {
    const metrics = ctx.measureText(word + ' ')
    const w = metrics.width

    // wrap
    if (cursorX + w > x + maxWidth) {
      cursorX = x
      cursorY += template.lineHeight
    }

    // fondo activo
    if (i === activeIndex) {
      ctx.fillStyle = template.activeBgColor
      ctx.fillRect(
        cursorX - 4,
        cursorY - template.fontSize,
        w + 8,
        template.fontSize + 8
      )
    }

    // texto
    ctx.fillStyle = i === activeIndex
      ? template.activeColor
      : template.color

    ctx.fillText(word, cursorX, cursorY)

    cursorX += w
  })
}

function buildFFmpegCommand(frames, videoPath, outputPath) {
  let inputs = `-i "${videoPath}" `
  let filters = ''
  let last = '[0:v]'

  frames.forEach((f, i) => {
    inputs += `-i "${f.path}" `

    const label = `[v${i}]`

    filters += `
${last}[${i+1}:v] overlay=enable='between(t,${f.start/1000},${f.end/1000})' ${label};
`

    last = label
  })

  return `
ffmpeg ${inputs}
-filter_complex "${filters}"
-map "${last}"
-map 0:a?
${outputPath}
`
}*/