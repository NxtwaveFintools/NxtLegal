import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { flattenStaticFields, StaticFieldRenderError } from './pdf-static-field-renderer'
import { BusinessRuleError } from '@/core/http/errors'

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([600, 800])
  }
  return doc.save()
}

async function makePng(): Promise<Uint8Array> {
  // 1x1 transparent PNG.
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

async function makeWidePng(): Promise<Uint8Array> {
  // 4x2 opaque PNG — a deliberate 2:1 aspect so a fitted draw is
  // distinguishable from a stretch-to-box draw.
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAADklEQVR4nGNwQAIMyBwAThoGAV4Fz1IAAAAASUVORK5CYII='
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

/**
 * Returns the decoded content stream for a page of a saved PDF.
 *
 * Asserting on getPageCount() alone cannot tell a drawn stamp from a skipped
 * one — the page count is identical either way. Reading the operators is what
 * makes these tests capable of failing.
 */
async function readPageContentStream(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(pageIndex)
  const context = page.node.context
  const contents = context.lookup(page.node.get(PDFName.of('Contents')))

  if (!contents) {
    return ''
  }

  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => context.lookup(ref)) : [contents]

  return streams
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'))
    .join('\n')
}

/** pdf-lib writes show-text operands as an uppercase hex string of WinAnsi bytes. */
function toPdfHexString(value: string): string {
  return Array.from(value)
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase())
    .join('')
}

/**
 * Extracts the translate and scale matrices pdf-lib emits ahead of each
 * `/Image-* Do`, giving the effective draw rect in PDF user space.
 */
function readDrawnImageRects(contentStream: string): Array<{ x: number; y: number; width: number; height: number }> {
  const pattern =
    /1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\s+1 0 0 1 0 0 cm\s+(-?[\d.]+) 0 0 (-?[\d.]+) 0 0 cm\s+1 0 0 1 0 0 cm\s+\/Image-\d+ Do/g

  const rects: Array<{ x: number; y: number; width: number; height: number }> = []
  let match = pattern.exec(contentStream)

  while (match) {
    rects.push({
      x: Number(match[1]),
      y: Number(match[2]),
      width: Number(match[3]),
      height: Number(match[4]),
    })
    match = pattern.exec(contentStream)
  }

  return rects
}

describe('flattenStaticFields', () => {
  it('returns the original bytes unchanged when there are no static fields', async () => {
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({ pdfBytes: pdf, fields: [], stampBytes: undefined })

    expect(result).toBe(pdf)
  })

  it('produces a valid loadable PDF after drawing a stamp', async () => {
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [{ fieldType: 'STAMP', pageNumber: 1, x: 20, y: 10, width: 96, height: 36, textValue: undefined }],
      stampBytes: await makePng(),
    })

    const reloaded = await PDFDocument.load(result)
    expect(reloaded.getPageCount()).toBe(1)
    expect(result).not.toBe(pdf)

    // The stamp must actually be painted, not merely embedded as a resource.
    const contentStream = await readPageContentStream(result, 0)
    expect(contentStream).toMatch(/\/Image-\d+ Do/)
    expect(readDrawnImageRects(contentStream)).toHaveLength(1)
  })

  it('draws stamps on every page they are placed on', async () => {
    const pdf = await makePdf(3)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [1, 2, 3].map((pageNumber) => ({
        fieldType: 'STAMP' as const,
        pageNumber,
        x: 20,
        y: 10,
        width: 96,
        height: 36,
        textValue: undefined,
      })),
      stampBytes: await makePng(),
    })

    const reloaded = await PDFDocument.load(result)
    expect(reloaded.getPageCount()).toBe(3)

    for (const pageIndex of [0, 1, 2]) {
      const contentStream = await readPageContentStream(result, pageIndex)
      expect(readDrawnImageRects(contentStream)).toHaveLength(1)
    }
  })

  it('fits the stamp inside its box preserving aspect ratio, centred', async () => {
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      // 2:1 image inside a 100x100 box on an 800pt-tall page.
      fields: [{ fieldType: 'STAMP', pageNumber: 1, x: 50, y: 100, width: 100, height: 100, textValue: undefined }],
      stampBytes: await makeWidePng(),
    })

    const rects = readDrawnImageRects(await readPageContentStream(result, 0))
    expect(rects).toHaveLength(1)

    // contain => scale = min(100/4, 100/2) = 25 => 100x50, letterboxed
    // vertically inside the box whose PDF-space bottom edge is 800-100-100=600.
    expect(rects[0].width).toBeCloseTo(100, 3)
    expect(rects[0].height).toBeCloseTo(50, 3)
    expect(rects[0].x).toBeCloseTo(50, 3)
    expect(rects[0].y).toBeCloseTo(625, 3)
  })

  it('throws when a stamp field is present but no stamp image was supplied', async () => {
    const pdf = await makePdf(1)

    await expect(
      flattenStaticFields({
        pdfBytes: pdf,
        fields: [{ fieldType: 'STAMP', pageNumber: 1, x: 0, y: 0, width: 96, height: 36, textValue: undefined }],
        stampBytes: undefined,
      })
    ).rejects.toThrow(StaticFieldRenderError)
  })

  it('draws text longer than its box instead of blocking the send', async () => {
    // The box auto-grows downward, so outgrowing the height the editor stored
    // is the normal case rather than an error. The box has no visible border in
    // the output, so extra lines simply continue below where it was drawn.
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          x: 0,
          y: 0,
          width: 40,
          height: 20,
          textValue: 'this is a great deal more text than can possibly fit inside forty points',
        },
      ],
      stampBytes: undefined,
    })

    // Wrapped across many lines, and the final word still reached the page —
    // the tail is what silent truncation would have dropped.
    const contentStream = await readPageContentStream(result, 0)
    expect(contentStream.match(/Tj/g)?.length ?? 0).toBeGreaterThan(1)
    expect(contentStream).toContain(`<${toPdfHexString('points')}> Tj`)
  })

  it('throws when text cannot fit between the box top and the page bottom', async () => {
    // The one case auto-grow cannot rescue: there is no page left to grow into.
    // Drawing anyway would run the text off the page edge, losing it silently.
    const pdf = await makePdf(1)

    await expect(
      flattenStaticFields({
        pdfBytes: pdf,
        fields: [
          {
            fieldType: 'TEXT',
            pageNumber: 1,
            x: 0,
            // 20pt above the bottom of an 800pt page: one 13.2pt line fits, two do not.
            y: 780,
            width: 40,
            height: 20,
            textValue: 'this is a great deal more text than can possibly fit inside forty points',
          },
        ],
        stampBytes: undefined,
      })
    ).rejects.toThrow(/page/i)
  })

  it('preserves newlines and runs of spaces typed by the user', async () => {
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [
        {
          fieldType: 'TEXT',
          pageNumber: 1,
          x: 10,
          y: 10,
          width: 400,
          height: 60,
          textValue: 'Line  one\nLine two',
        },
      ],
      stampBytes: undefined,
    })

    // Two separate show-text operators, and the double space inside the first
    // survives rather than being collapsed on its way to the page.
    const contentStream = await readPageContentStream(result, 0)
    expect(contentStream).toContain(`<${toPdfHexString('Line  one')}> Tj`)
    expect(contentStream).toContain(`<${toPdfHexString('Line two')}> Tj`)
  })

  it('preserves leading indentation rather than trimming it away', async () => {
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [{ fieldType: 'TEXT', pageNumber: 1, x: 10, y: 10, width: 400, height: 24, textValue: '    Indented' }],
      stampBytes: undefined,
    })

    const contentStream = await readPageContentStream(result, 0)
    expect(contentStream).toContain(`<${toPdfHexString('    Indented')}> Tj`)
  })

  it('draws text that fits without throwing', async () => {
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [{ fieldType: 'TEXT', pageNumber: 1, x: 10, y: 10, width: 400, height: 24, textValue: 'Hello' }],
      stampBytes: undefined,
    })

    const reloaded = await PDFDocument.load(result)
    expect(reloaded.getPageCount()).toBe(1)

    // embedFont runs unconditionally, so only a show-text operator carrying the
    // actual glyphs proves the text reached the page.
    const contentStream = await readPageContentStream(result, 0)
    expect(contentStream).toMatch(/Tj|TJ/)
    expect(contentStream).toContain(`<${toPdfHexString('Hello')}> Tj`)
  })

  it('throws when a field lands on a page the document does not have', async () => {
    // Deliberate behaviour change: this previously skipped the field silently,
    // producing an unsealed contract that looked like a clean send.
    const pdf = await makePdf(3)

    await expect(
      flattenStaticFields({
        pdfBytes: pdf,
        fields: [{ fieldType: 'STAMP', pageNumber: 9, x: 0, y: 0, width: 96, height: 36, textValue: undefined }],
        stampBytes: await makePng(),
      })
    ).rejects.toThrow(/page 9.*only 3 pages/i)
  })

  it('throws when a static field has zero width or height', async () => {
    const pdf = await makePdf(1)

    await expect(
      flattenStaticFields({
        pdfBytes: pdf,
        fields: [{ fieldType: 'STAMP', pageNumber: 1, x: 10, y: 10, width: 0, height: 0, textValue: undefined }],
        stampBytes: await makePng(),
      })
    ).rejects.toThrow(/no size/i)

    await expect(
      flattenStaticFields({
        pdfBytes: pdf,
        fields: [{ fieldType: 'TEXT', pageNumber: 1, x: 10, y: 10, width: 200, height: 0, textValue: 'Sealed' }],
        stampBytes: undefined,
      })
    ).rejects.toThrow(/no size/i)
  })

  it('throws when a TEXT field carries no text', async () => {
    const pdf = await makePdf(1)

    await expect(
      flattenStaticFields({
        pdfBytes: pdf,
        fields: [{ fieldType: 'TEXT', pageNumber: 1, x: 10, y: 10, width: 200, height: 24, textValue: '   ' }],
        stampBytes: undefined,
      })
    ).rejects.toThrow(/is empty/i)
  })

  it('reports render failures as a business rule error so the API surfaces the message', async () => {
    const pdf = await makePdf(1)

    const error = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [{ fieldType: 'STAMP', pageNumber: 4, x: 0, y: 0, width: 96, height: 36, textValue: undefined }],
      stampBytes: await makePng(),
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(StaticFieldRenderError)
    expect(error).toBeInstanceOf(BusinessRuleError)
    expect((error as StaticFieldRenderError).code).toBe('CONTRACT_STATIC_FIELD_RENDER_FAILED')
    expect((error as StaticFieldRenderError).statusCode).toBe(422)
  })
})
