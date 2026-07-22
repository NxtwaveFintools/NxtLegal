import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { BusinessRuleError } from '@/core/http/errors'
import { layoutStaticText, toPdfRect, type PdfRect } from './static-field-layout'

export const staticFieldRenderErrorCode = 'CONTRACT_STATIC_FIELD_RENDER_FAILED'

/**
 * Extends BusinessRuleError (not plain Error) so the API layer's isAppError
 * check carries the message through to the operator. As a bare Error every
 * guard below collapsed into a generic 500, which defeats the point of
 * guarding at all: the operator could not tell a broken stamp from an outage.
 */
export class StaticFieldRenderError extends BusinessRuleError {
  constructor(message: string) {
    super(staticFieldRenderErrorCode, message)
  }
}

const fieldLabel = (fieldType: StaticField['fieldType']): string =>
  fieldType === 'STAMP' ? 'A stamp field' : 'A static text field'

/**
 * Scales an image to fit inside `rect` without distortion and centres it,
 * mirroring the editor preview's `object-fit: contain`.
 */
export function fitContain(params: { imageWidth: number; imageHeight: number; rect: PdfRect }): PdfRect {
  const { imageWidth, imageHeight, rect } = params

  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new StaticFieldRenderError(
      'The configured company stamp image has no usable dimensions. Re-upload the stamp and try again.'
    )
  }

  const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale

  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  }
}

export type StaticField = {
  fieldType: 'STAMP' | 'TEXT'
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  textValue: string | undefined
}

/**
 * Burns stamp images and static text into a copy of the PDF.
 *
 * The caller's bytes are never mutated: flattening happens on the way to Zoho
 * so the stored source document stays clean and a recalled envelope can be
 * re-sent without double-stamping.
 */
export async function flattenStaticFields(params: {
  pdfBytes: Uint8Array
  fields: StaticField[]
  stampBytes: Uint8Array | undefined
}): Promise<Uint8Array> {
  if (params.fields.length === 0) {
    return params.pdfBytes
  }

  const stampFields = params.fields.filter((field) => field.fieldType === 'STAMP')

  if (stampFields.length > 0 && !params.stampBytes) {
    throw new StaticFieldRenderError(
      'A stamp field is placed on this contract but no company stamp is configured for this organisation.'
    )
  }

  // A zero-sized box draws nothing and reports nothing: drawImage at 0x0 is a
  // no-op and drawText has no room to wrap into. Reject before loading so the
  // operator is told which field is broken rather than receiving a clean send
  // of an unsealed contract.
  for (const field of params.fields) {
    const hasUsableSize =
      Number.isFinite(field.width) && Number.isFinite(field.height) && field.width > 0 && field.height > 0

    if (!hasUsableSize) {
      throw new StaticFieldRenderError(
        `${fieldLabel(field.fieldType)} on page ${field.pageNumber} has no size (width ${field.width}, height ${field.height}). Remove it and place it again.`
      )
    }
  }

  const pdfDoc = await PDFDocument.load(params.pdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()
  const stampImage = params.stampBytes ? await pdfDoc.embedPng(params.stampBytes) : undefined

  for (const field of params.fields) {
    const page = pages[field.pageNumber - 1]
    if (!page) {
      throw new StaticFieldRenderError(
        `${fieldLabel(field.fieldType)} is placed on page ${field.pageNumber}, but this document has only ${pages.length} page${pages.length === 1 ? '' : 's'}. Move the field onto an existing page and try again.`
      )
    }

    const pageHeight = page.getHeight()
    const rect = toPdfRect({
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      pageHeight,
    })

    if (field.fieldType === 'STAMP') {
      if (!stampImage) {
        // Unreachable via the guard above, but a narrowing `&& stampImage`
        // here would fall through and draw nothing at all — the exact silent
        // failure this module exists to prevent.
        throw new StaticFieldRenderError(
          `A stamp field is placed on page ${field.pageNumber} but no company stamp image is available to draw.`
        )
      }

      // Stretching the seal to the box distorts it, and the editor previews
      // with object-fit: contain, so the distortion is invisible until the
      // contract is already executed. Letterbox to match the preview.
      page.drawImage(stampImage, fitContain({ imageWidth: stampImage.width, imageHeight: stampImage.height, rect }))
      continue
    }

    if (field.fieldType === 'TEXT') {
      // Emptiness is tested on a trimmed copy, but the value drawn below keeps
      // its whitespace: newlines, indentation and runs of spaces are content the
      // user typed, and collapsing them rewrites the clause.
      const text = field.textValue ?? ''
      if (text.trim().length === 0) {
        throw new StaticFieldRenderError(
          `A static text field on page ${field.pageNumber} is empty. Type the text into the box or remove the field.`
        )
      }

      const layout = layoutStaticText({
        text,
        width: field.width,
        height: field.height,
        measure: (value, size) => font.widthOfTextAtSize(value, size),
      })

      // The box auto-grows downward in the editor and has no visible border in
      // the output, so outgrowing the stored height is ordinary and draws fine.
      // The only unsatisfiable request is text taller than the page left below
      // the box top — drawing that would run off the page edge and lose it.
      const heightAvailableBelowBoxTop = pageHeight - field.y

      if (layout.requiredHeight > heightAvailableBelowBoxTop) {
        throw new StaticFieldRenderError(
          `Static text on page ${field.pageNumber} needs ${Math.ceil(layout.requiredHeight)}pt but only ${Math.floor(heightAvailableBelowBoxTop)}pt remain before the bottom of the page. Move the box higher, widen it, or shorten the text.`
        )
      }

      // Measured from the box top rather than `rect.y + rect.height`: toPdfRect
      // clamps rect.y to 0, so once the text grows past the stored box height
      // that sum stops tracking the top edge and the block drifts upward.
      const boxTopY = pageHeight - field.y

      layout.lines.forEach((line, index) => {
        if (line.length === 0) {
          // A blank line between paragraphs advances the baseline and draws nothing.
          return
        }

        // pdf-lib positions text by its baseline, so the first line sits one
        // line-height below the box top edge.
        page.drawText(line, {
          x: rect.x,
          y: boxTopY - layout.lineHeight * (index + 1),
          size: layout.fontSize,
          font,
          color: rgb(0, 0, 0),
        })
      })
    }
  }

  return pdfDoc.save()
}
