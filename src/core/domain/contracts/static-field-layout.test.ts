import {
  layoutStaticText,
  STATIC_TEXT_FONT_SIZE,
  STATIC_TEXT_LINE_HEIGHT,
  toPdfRect,
  toStampBoxSize,
} from './static-field-layout'

// Stand-in for pdf-lib's PDFFont.widthOfTextAtSize. Each character is `size`
// points wide, keeping the arithmetic obvious in assertions.
const fakeMeasure = (text: string, size: number) => text.length * size

describe('toPdfRect', () => {
  it('flips a top-left origin rect to bottom-left origin', () => {
    // Field 10pt from the top of an 800pt page, 36pt tall.
    // Its bottom edge sits at 800 - 10 - 36 = 754 from the bottom.
    const result = toPdfRect({ x: 20, y: 10, width: 96, height: 36, pageHeight: 800 })

    expect(result).toEqual({ x: 20, y: 754, width: 96, height: 36 })
  })

  it('places a field at the bottom of the page at y=0', () => {
    const result = toPdfRect({ x: 0, y: 764, width: 96, height: 36, pageHeight: 800 })

    expect(result.y).toBe(0)
  })

  it('is not symmetric for off-centre fields', () => {
    // Guards against a flip bug that happens to look correct when centred.
    const top = toPdfRect({ x: 0, y: 50, width: 100, height: 20, pageHeight: 800 })
    const bottom = toPdfRect({ x: 0, y: 730, width: 100, height: 20, pageHeight: 800 })

    expect(top.y).toBe(730)
    expect(bottom.y).toBe(50)
    expect(top.y).not.toBe(bottom.y)
  })

  it('clamps a field extending past the bottom edge to y=0', () => {
    const result = toPdfRect({ x: 0, y: 790, width: 96, height: 36, pageHeight: 800 })

    expect(result.y).toBe(0)
  })
})

describe('toStampBoxSize', () => {
  it('gives a square seal a square box', () => {
    // The real company stamp is 499x500. In the old 96x36 box it rendered as a
    // 36x36 circle with ~30pt of dead space per side, and that padding is what
    // stopped the seal reaching the page edge.
    const result = toStampBoxSize({ nominalWidth: 96, imageWidth: 499, imageHeight: 500 })

    expect(result.width).toBe(96)
    expect(result.height).toBeCloseTo(96.19, 1)
  })

  it('gives a wide seal a proportionally wide box', () => {
    const result = toStampBoxSize({ nominalWidth: 96, imageWidth: 400, imageHeight: 100 })

    expect(result).toEqual({ width: 96, height: 24 })
  })

  it('gives a tall seal a proportionally tall box', () => {
    const result = toStampBoxSize({ nominalWidth: 96, imageWidth: 100, imageHeight: 400 })

    expect(result).toEqual({ width: 96, height: 384 })
  })

  it('falls back to a square box when the image has no usable dimensions', () => {
    // Guessing a ratio here would reintroduce the padding this function exists
    // to remove, so a square is the honest neutral choice.
    expect(toStampBoxSize({ nominalWidth: 96, imageWidth: 0, imageHeight: 0 })).toEqual({ width: 96, height: 96 })
    expect(toStampBoxSize({ nominalWidth: 96, imageWidth: Number.NaN, imageHeight: 500 })).toEqual({
      width: 96,
      height: 96,
    })
  })
})

describe('static text metrics', () => {
  it('uses a fixed font size independent of field height', () => {
    // Font size must not scale with height: line height scales with font size,
    // so a height-derived size makes exactly one line fit at EVERY height, and
    // any wrap would always overflow. Fixed size means height sets line capacity.
    const short = layoutStaticText({ text: 'abc', width: 100, height: 20, measure: fakeMeasure })
    const tall = layoutStaticText({ text: 'abc', width: 100, height: 200, measure: fakeMeasure })

    expect(short.fontSize).toBe(STATIC_TEXT_FONT_SIZE)
    expect(tall.fontSize).toBe(STATIC_TEXT_FONT_SIZE)
  })

  it('fits more lines in a taller box', () => {
    // The remedy for overflow is resizing the box, so this must hold.
    const text = 'aaaa bbbb cccc'
    const short = layoutStaticText({ text, width: 50, height: 20, measure: fakeMeasure })
    const tall = layoutStaticText({ text, width: 50, height: 80, measure: fakeMeasure })

    expect(short.overflows).toBe(true)
    expect(tall.overflows).toBe(false)
  })
})

describe('layoutStaticText', () => {
  it('keeps short text on one line and reports no overflow', () => {
    // 'abc' at size 11 measures 33pt, well inside 100pt.
    const result = layoutStaticText({ text: 'abc', width: 100, height: 24, measure: fakeMeasure })

    expect(result.lines).toEqual(['abc'])
    expect(result.overflows).toBe(false)
  })

  it('wraps at word boundaries when text exceeds field width', () => {
    // Each word is 4 chars = 44pt at size 11; two words with a space is 99pt,
    // which exceeds a 50pt box, so each word lands on its own line.
    // 3 lines x 13.2pt line height = 39.6pt, inside an 80pt box.
    const result = layoutStaticText({ text: 'aaaa bbbb cccc', width: 50, height: 80, measure: fakeMeasure })

    expect(result.lines).toEqual(['aaaa', 'bbbb', 'cccc'])
    expect(result.overflows).toBe(false)
  })

  it('packs multiple words onto one line when they fit', () => {
    // 'aaaa bbbb' is 99pt, inside a 120pt box.
    const result = layoutStaticText({ text: 'aaaa bbbb cccc', width: 120, height: 80, measure: fakeMeasure })

    expect(result.lines).toEqual(['aaaa bbbb', 'cccc'])
    expect(result.overflows).toBe(false)
  })

  it('reports overflow when wrapped lines exceed field height', () => {
    // 3 lines x 13.2pt = 39.6pt, which does not fit a 24pt box.
    const result = layoutStaticText({ text: 'aaaa bbbb cccc', width: 50, height: 24, measure: fakeMeasure })

    expect(result.overflows).toBe(true)
  })

  it('breaks a word wider than the field at character level rather than reporting overflow', () => {
    // Previously this was declared unbreakable and blocked the send. A long URL
    // or reference number is ordinary input, so it now wraps: at size 11 each
    // char is 11pt, so 4 chars (44pt) fit a 50pt box and a 5th (55pt) does not.
    const result = layoutStaticText({
      text: 'aaaaaaaaaaaaaaaaaaaa',
      width: 50,
      height: 200,
      measure: fakeMeasure,
    })

    expect(result.lines).toEqual(['aaaa', 'aaaa', 'aaaa', 'aaaa', 'aaaa'])
    expect(result.overflows).toBe(false)
  })

  it('keeps a single character on its line even when it is wider than the field', () => {
    // Nothing narrower exists to break down to. Emitting it is the only option
    // that does not silently drop the character.
    const result = layoutStaticText({ text: 'ab', width: 5, height: 200, measure: fakeMeasure })

    expect(result.lines).toEqual(['a', 'b'])
  })

  it('reports no overflow for empty text', () => {
    const result = layoutStaticText({ text: '', width: 100, height: 24, measure: fakeMeasure })

    expect(result.lines).toEqual([])
    expect(result.overflows).toBe(false)
  })

  it('exposes a line height consistent with the fixed font size', () => {
    const result = layoutStaticText({ text: 'abc', width: 100, height: 24, measure: fakeMeasure })

    expect(result.lineHeight).toBeCloseTo(STATIC_TEXT_FONT_SIZE * STATIC_TEXT_LINE_HEIGHT)
  })
})

// Legal types addresses, clause blocks and signature blocks. Collapsing the
// whitespace out of those silently rewrites the text the user typed, which for
// a contract is the same class of failure as dropping it.
describe('whitespace fidelity', () => {
  it('starts a new line at a newline character', () => {
    const result = layoutStaticText({ text: 'abc\ndef', width: 500, height: 200, measure: fakeMeasure })

    expect(result.lines).toEqual(['abc', 'def'])
  })

  it('preserves blank lines between paragraphs', () => {
    const result = layoutStaticText({ text: 'abc\n\ndef', width: 500, height: 200, measure: fakeMeasure })

    expect(result.lines).toEqual(['abc', '', 'def'])
  })

  it('preserves runs of spaces inside a line', () => {
    const result = layoutStaticText({ text: 'abc   def', width: 500, height: 200, measure: fakeMeasure })

    expect(result.lines).toEqual(['abc   def'])
  })

  it('preserves leading indentation', () => {
    const result = layoutStaticText({ text: '    indented', width: 500, height: 200, measure: fakeMeasure })

    expect(result.lines).toEqual(['    indented'])
  })

  it('preserves a trailing space rather than trimming the line', () => {
    const result = layoutStaticText({ text: 'abc ', width: 500, height: 200, measure: fakeMeasure })

    expect(result.lines).toEqual(['abc '])
  })

  it('wraps each paragraph independently', () => {
    // 'aaaa bbbb' is 99pt and does not fit 50pt, so each paragraph wraps on its
    // own; the newline between them is still honoured.
    const result = layoutStaticText({ text: 'aaaa bbbb\ncccc dddd', width: 50, height: 200, measure: fakeMeasure })

    expect(result.lines).toEqual(['aaaa', 'bbbb', 'cccc', 'dddd'])
  })
})

describe('requiredHeight', () => {
  it('reports the height the wrapped text actually needs', () => {
    const result = layoutStaticText({ text: 'aaaa bbbb cccc', width: 50, height: 24, measure: fakeMeasure })

    // 3 lines x 13.2pt. The editor grows the box to this, which is what makes
    // typing unrestricted: the remedy is applied automatically.
    expect(result.requiredHeight).toBeCloseTo(3 * STATIC_TEXT_FONT_SIZE * STATIC_TEXT_LINE_HEIGHT)
  })

  it('grows as more lines are added', () => {
    const oneLine = layoutStaticText({ text: 'abc', width: 500, height: 24, measure: fakeMeasure })
    const threeLines = layoutStaticText({ text: 'abc\ndef\nghi', width: 500, height: 24, measure: fakeMeasure })

    expect(threeLines.requiredHeight).toBeCloseTo(oneLine.requiredHeight * 3)
  })

  it('is zero for empty text', () => {
    const result = layoutStaticText({ text: '', width: 100, height: 24, measure: fakeMeasure })

    expect(result.requiredHeight).toBe(0)
  })
})
