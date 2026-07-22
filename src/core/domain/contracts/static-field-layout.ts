export type PdfRect = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Converts an editor rect (y measured downward from the page top) into a
 * pdf-lib rect (y measured upward from the page bottom).
 *
 * The editor derives y from a click offset inside the rendered page
 * (PrepareForSigningModal.tsx:621), so y grows downward. pdf-lib's origin is
 * bottom-left. Getting this wrong produces output that looks correct for a
 * vertically centred element and is visibly wrong everywhere else.
 */
export function toPdfRect(params: {
  x: number
  y: number
  width: number
  height: number
  pageHeight: number
}): PdfRect {
  const bottomUpY = params.pageHeight - params.y - params.height

  return {
    x: params.x,
    y: Math.max(0, bottomUpY),
    width: params.width,
    height: params.height,
  }
}

/**
 * Sizes a stamp box to the seal image's own proportions.
 *
 * The box, not the seal, is what clamps against the page edge and what the user
 * drags. When the two disagree the difference becomes invisible padding: a
 * square seal in the old 96x36 default rendered as a 36x36 circle with ~30pt of
 * dead space per side, holding the seal away from the page edge and from
 * anything the user was trying to align it against. Enlarging the box only
 * widened the padding, because resize locks to the box's aspect ratio.
 *
 * Matching the box to the image makes the editor preview and the renderer's
 * fitContain agree exactly, so what is placed is what is burned in.
 */
export function toStampBoxSize(params: { nominalWidth: number; imageWidth: number; imageHeight: number }): {
  width: number
  height: number
} {
  const hasUsableImage =
    Number.isFinite(params.imageWidth) &&
    Number.isFinite(params.imageHeight) &&
    params.imageWidth > 0 &&
    params.imageHeight > 0

  if (!hasUsableImage) {
    // Callers fall back to their own default rather than inventing a ratio.
    return { width: params.nominalWidth, height: params.nominalWidth }
  }

  return {
    width: params.nominalWidth,
    height: Number(((params.nominalWidth * params.imageHeight) / params.imageWidth).toFixed(2)),
  }
}

/**
 * Fixed point size for all burned-in static text.
 *
 * Deliberately NOT derived from field height. Line height scales with font
 * size, so a height-derived size makes exactly one line fit at every height —
 * a taller box would enlarge the text rather than admit a second line, and any
 * wrap would always overflow. Holding size fixed means height determines line
 * capacity, which is what makes "resize the box" a real remedy for overflow.
 */
export const STATIC_TEXT_FONT_SIZE = 11
export const STATIC_TEXT_LINE_HEIGHT = 1.2

export type StaticTextLayout = {
  lines: string[]
  fontSize: number
  lineHeight: number
  /** Height the wrapped text needs. The editor grows the box to this. */
  requiredHeight: number
  overflows: boolean
}

/** Measures rendered width of `text` at `size`. Matches pdf-lib's PDFFont.widthOfTextAtSize. */
export type MeasureText = (text: string, size: number) => number

/**
 * Splits a token too wide for the field into chunks that fit.
 *
 * A long URL or reference number is ordinary contract input, so breaking it is
 * better than the previous behaviour of declaring it unbreakable and blocking
 * the send. A single character wider than the field is emitted alone: nothing
 * narrower exists to break down to, and dropping it would lose content.
 */
function breakOversizedToken(token: string, width: number, fontSize: number, measure: MeasureText): string[] {
  if (token.length === 0 || measure(token, fontSize) <= width) {
    return [token]
  }

  const chunks: string[] = []
  let chunk = ''

  for (const character of token) {
    const candidate = chunk + character

    if (chunk.length > 0 && measure(candidate, fontSize) > width) {
      chunks.push(chunk)
      chunk = character
      continue
    }

    chunk = candidate
  }

  if (chunk.length > 0) {
    chunks.push(chunk)
  }

  return chunks
}

/**
 * Wraps text to the field width and reports the height it needs.
 *
 * Used by BOTH the editor's box auto-grow and the send-time renderer. They must
 * not diverge: an editor that disagrees with the renderer sizes a box the
 * burned text then spills out of.
 *
 * Whitespace is preserved exactly as typed — newlines start new lines, runs of
 * spaces and leading indentation survive. An earlier version collapsed all of
 * it via `text.trim().split(/\s+/)`, which silently rewrote addresses and
 * clause blocks into a single run-on line.
 */
export function layoutStaticText(params: {
  text: string
  width: number
  height: number
  measure: MeasureText
}): StaticTextLayout {
  const fontSize = STATIC_TEXT_FONT_SIZE
  const lineHeight = fontSize * STATIC_TEXT_LINE_HEIGHT

  if (params.text.length === 0) {
    return { lines: [], fontSize, lineHeight, requiredHeight: 0, overflows: false }
  }

  const lines: string[] = []

  for (const paragraph of params.text.split('\n')) {
    // split(' ') keeps empty strings for consecutive spaces, so rejoining with
    // a single space reproduces the original run exactly. `null` distinguishes
    // "nothing placed yet" from "an empty token was placed", which is what lets
    // leading indentation survive.
    let currentLine: string | null = null

    for (const token of paragraph.split(' ')) {
      if (currentLine !== null) {
        // Annotated because currentLine is reassigned from it, which otherwise
        // makes the inference circular (TS7022).
        const candidate: string = `${currentLine} ${token}`

        if (params.measure(candidate, fontSize) <= params.width) {
          currentLine = candidate
          continue
        }

        lines.push(currentLine)
        currentLine = null
      }

      const chunks = breakOversizedToken(token, params.width, fontSize, params.measure)
      lines.push(...chunks.slice(0, -1))
      currentLine = chunks[chunks.length - 1] ?? ''
    }

    lines.push(currentLine ?? '')
  }

  const requiredHeight = lines.length * lineHeight

  return { lines, fontSize, lineHeight, requiredHeight, overflows: requiredHeight > params.height }
}
