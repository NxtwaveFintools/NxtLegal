'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { contractsClient } from '@/core/client/contracts-client'
import { contractStatuses } from '@/core/constants/contracts'
import { layoutStaticText, toStampBoxSize } from '@/core/domain/contracts/static-field-layout'
import type { PrepareForSigningPdfViewerProps } from './PrepareForSigningPdfViewer'
import styles from './prepare-for-signing-modal.module.css'

type RecipientType = 'INTERNAL' | 'EXTERNAL' | 'VIEWER'
type FieldType = 'SIGNATURE' | 'INITIAL' | 'STAMP' | 'NAME' | 'DATE' | 'TIME' | 'TEXT'

type DraftRecipient = {
  id: string
  name: string
  email: string
  recipientType: RecipientType
  routingOrder: number
  designation?: string
  counterpartyId?: string
  counterpartyName?: string
  backgroundOfRequest?: string
  budgetApproved?: boolean
}

type DraftField = {
  id: string
  fieldType: FieldType
  pageNumber?: number
  xPosition?: number
  yPosition?: number
  width?: number
  height?: number
  mirrorGroupId?: string
  anchorString?: string
  /** Static text burned into the PDF for TEXT fields before it reaches Zoho Sign. */
  textValue?: string
  assignedSignerEmail: string
}

type ResizeSession = {
  fieldId: string
  mirrorGroupId?: string
  fieldType: FieldType
  pageNumber: number
  startClientX: number
  startClientY: number
  startWidth: number
  startHeight: number
  xPosition: number
  yPosition: number
}

type DragSession = {
  fieldId: string
  mirrorGroupId?: string
  pageNumber: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
  /** Alt was held at mousedown: move only this copy, leaving its group peers put. */
  detachFromGroup: boolean
  /** Set once the pointer passes the threshold, which is what separates a drag from a click. */
  hasMoved: boolean
}

type PrepareForSigningModalProps = {
  isOpen: boolean
  contractId: string
  contractStatus: string
  pdfUrl: string
  initialRecipients?: Array<{
    name: string
    email: string
    recipientType?: RecipientType
    routingOrder?: number
  }>
  onClose: () => void
  onReviewSendRequested: (payload: {
    recipients: Array<{
      name: string
      email: string
      recipient_type: 'INTERNAL' | 'EXTERNAL' | 'VIEWER'
      routing_order: number
      designation?: string
      counterparty_id?: string
      counterparty_name?: string
      background_of_request?: string
      budget_approved?: boolean
    }>
    fields: Array<{
      field_type: 'SIGNATURE' | 'INITIAL' | 'STAMP' | 'NAME' | 'DATE' | 'TIME' | 'TEXT'
      page_number?: number
      x_position?: number
      y_position?: number
      width?: number
      height?: number
      anchor_string?: string
      text_value?: string
      assigned_signer_email: string
    }>
  }) => void
}

type PreflightCheck = {
  key: string
  label: string
  isReady: boolean
  detail: string
}

const fieldPalette: FieldType[] = ['SIGNATURE', 'INITIAL', 'STAMP', 'NAME', 'DATE', 'TIME', 'TEXT']
const sendingStatuses = [
  'Sending signature request emails...',
  'Almost there...',
  'Just a minute...',
  'Preparing the signing package...',
]

const PrepareForSigningPdfViewer = dynamic<PrepareForSigningPdfViewerProps>(
  () => import('./PrepareForSigningPdfViewer'),
  {
    ssr: false,
    loading: () => <div className={styles.placeholder}>Loading PDF…</div>,
  }
)

const createDraftId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`
const defaultFieldSizeByType: Record<FieldType, { width: number; height: number }> = {
  SIGNATURE: { width: 96, height: 22 },
  INITIAL: { width: 40, height: 15 },
  STAMP: { width: 96, height: 36 },
  NAME: { width: 110, height: 22 },
  DATE: { width: 110, height: 22 },
  TIME: { width: 96, height: 22 },
  TEXT: { width: 200, height: 22 },
}
/**
 * Nominal width for a stamp box. Height is derived from the seal image so the
 * box carries no invisible padding — see toStampBoxSize.
 */
const STAMP_NOMINAL_WIDTH = 96
const imageFieldTypes: FieldType[] = ['SIGNATURE', 'INITIAL', 'STAMP']
const isImageFieldType = (fieldType: FieldType) => imageFieldTypes.includes(fieldType)
const allPagesFieldTypes: FieldType[] = ['SIGNATURE', 'STAMP']
const supportsAllPages = (fieldType: FieldType) => allPagesFieldTypes.includes(fieldType)

/**
 * Fallback for environments with no canvas (SSR, and jsdom under test).
 * 0.5em per character is roughly Helvetica's mean advance over mixed-case prose.
 */
const HELVETICA_AVERAGE_CHAR_WIDTH_RATIO = 0.5

/** Pointer travel, in screen pixels, before a press on a chip counts as a drag. */
const DRAG_MOVEMENT_THRESHOLD_PX = 3

/** Points a selected field moves per arrow key press; Shift multiplies by this. */
const NUDGE_STEP_POINTS = 1
const NUDGE_COARSE_MULTIPLIER = 10

const roundToPoints = (value: number) => Number(value.toFixed(2))
const clampToRange = (value: number, max: number) => Math.max(0, Math.min(Math.max(0, max), value))

/**
 * Measures Helvetica advance widths for the editor's box auto-grow.
 *
 * Canvas measureText against Helvetica gives near-real metrics, so the editor
 * and the send-time renderer (which measures with the embedded font via
 * PDFFont.widthOfTextAtSize) agree on where lines break. The previous
 * 0.5em-per-character estimate disagreed by roughly a character per line, which
 * sized boxes the burned text then spilled out of.
 *
 * The context is created once and reused; `font` is reassigned per call because
 * size is a parameter.
 */
const measureStaticText = (() => {
  let context: CanvasRenderingContext2D | null | undefined

  return (text: string, size: number): number => {
    if (context === undefined) {
      context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    }

    if (!context) {
      return text.length * size * HELVETICA_AVERAGE_CHAR_WIDTH_RATIO
    }

    context.font = `${size}px Helvetica, Arial, sans-serif`
    return context.measureText(text).width
  }
})()

function mergeRecipientsWithDefaults(
  recipients: DraftRecipient[],
  defaultRecipients: DraftRecipient[]
): DraftRecipient[] {
  const byEmail = new Map<string, DraftRecipient>()

  for (const recipient of recipients) {
    const normalizedEmail = recipient.email.trim().toLowerCase()
    if (!normalizedEmail) {
      continue
    }

    byEmail.set(normalizedEmail, {
      ...recipient,
      email: normalizedEmail,
    })
  }

  for (const defaultRecipient of defaultRecipients) {
    const normalizedEmail = defaultRecipient.email.trim().toLowerCase()
    if (!normalizedEmail) {
      continue
    }

    const existingRecipient = byEmail.get(normalizedEmail)
    if (!existingRecipient) {
      byEmail.set(normalizedEmail, defaultRecipient)
      continue
    }

    // Keep saved row identity/position, but enforce default directory values.
    byEmail.set(normalizedEmail, {
      ...existingRecipient,
      name: defaultRecipient.name,
      recipientType: defaultRecipient.recipientType,
      routingOrder: defaultRecipient.routingOrder,
    })
  }

  return Array.from(byEmail.values())
}

export default function PrepareForSigningModal({
  isOpen,
  contractId,
  contractStatus,
  pdfUrl,
  initialRecipients,
  onClose,
  onReviewSendRequested,
}: PrepareForSigningModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [isLoadingDraft, setIsLoadingDraft] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [sendingStatusIndex, setSendingStatusIndex] = useState(0)
  const [numPages, setNumPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedFieldType, setSelectedFieldType] = useState<FieldType>('SIGNATURE')
  const [selectedRecipientId, setSelectedRecipientId] = useState('')
  const [applyToAllPages, setApplyToAllPages] = useState(false)
  const [recipients, setRecipients] = useState<DraftRecipient[]>([])
  const [fields, setFields] = useState<DraftField[]>([])
  const [pageMetricsByNumber, setPageMetricsByNumber] = useState<Record<number, { width: number; height: number }>>({})
  const [pageRenderBoxByNumber, setPageRenderBoxByNumber] = useState<
    Record<number, { widthPx: number; heightPx: number }>
  >({})
  const [stampSignedUrl, setStampSignedUrl] = useState<string | null>(null)
  const [isStampConfigured, setIsStampConfigured] = useState(true)
  const [stampImageSize, setStampImageSize] = useState<{ width: number; height: number } | null>(null)

  const pageSurfaceRef = useRef<HTMLDivElement | null>(null)
  const pageRenderRef = useRef<HTMLDivElement | null>(null)
  const resizeSessionRef = useRef<ResizeSession | null>(null)
  const dragSessionRef = useRef<DragSession | null>(null)
  const suppressPlacementUntilMsRef = useRef(0)
  const [activeResizeFieldId, setActiveResizeFieldId] = useState<string | null>(null)
  const [activeDragFieldId, setActiveDragFieldId] = useState<string | null>(null)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [isDetachedDrag, setIsDetachedDrag] = useState(false)

  const isLocked = contractStatus === contractStatuses.signing || contractStatus === contractStatuses.pendingExternal
  const canEdit = !isLocked && !isSending
  const effectiveInitialRecipients = useMemo(() => initialRecipients ?? [], [initialRecipients])
  const normalizedInitialRecipients = useMemo(() => {
    const byEmail = new Map<string, DraftRecipient>()

    for (const recipient of effectiveInitialRecipients) {
      const normalizedEmail = recipient.email.trim().toLowerCase()
      if (!normalizedEmail) {
        continue
      }

      if (byEmail.has(normalizedEmail)) {
        continue
      }

      byEmail.set(normalizedEmail, {
        id: createDraftId(),
        name: recipient.name.trim(),
        email: normalizedEmail,
        recipientType: recipient.recipientType ?? 'EXTERNAL',
        routingOrder: recipient.routingOrder && recipient.routingOrder > 0 ? recipient.routingOrder : 1,
      })
    }

    return Array.from(byEmail.values())
  }, [effectiveInitialRecipients])

  useEffect(() => {
    if (!isSending) {
      setSendingStatusIndex(0)
      return
    }

    const interval = window.setInterval(() => {
      setSendingStatusIndex((current) => (current + 1) % sendingStatuses.length)
    }, 1800)

    return () => window.clearInterval(interval)
  }, [isSending])

  useEffect(() => {
    if (!isOpen) {
      setIsSending(false)
      setSendingStatusIndex(0)
      return
    }

    setPageMetricsByNumber({})
    setPageRenderBoxByNumber({})
  }, [isOpen, pdfUrl])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    void (async () => {
      try {
        const response = await fetch('/api/contracts/org-assets/stamp')

        if (!response.ok) {
          setIsStampConfigured(false)
          return
        }

        const payload = (await response.json()) as {
          ok: boolean
          data: { configured: boolean; signedUrl: string | null }
        }
        setIsStampConfigured(payload.data.configured)
        setStampSignedUrl(payload.data.signedUrl)
      } catch {
        // A transient network failure is not evidence that the org has no stamp.
        // Fail open: leave the palette enabled and let the send-time check —
        // which reads the stamp bytes directly — be the authority.
      }
    })()
  }, [isOpen])

  /**
   * Reads the seal's intrinsic dimensions so the stamp box can match them.
   *
   * Until this resolves the box falls back to the static default, which only
   * means the first render is letterboxed; it corrects itself on load.
   */
  useEffect(() => {
    if (!stampSignedUrl) {
      setStampImageSize(null)
      return
    }

    let isCurrent = true
    const image = new window.Image()

    image.onload = () => {
      if (isCurrent && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setStampImageSize({ width: image.naturalWidth, height: image.naturalHeight })
      }
    }
    image.src = stampSignedUrl

    return () => {
      isCurrent = false
    }
  }, [stampSignedUrl])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const loadDraft = async () => {
      setIsLoadingDraft(true)

      try {
        const response = await contractsClient.getSigningPreparationDraft(contractId)

        if (!response.ok) {
          toast.error(response.error?.message ?? 'Failed to load signing draft')
          return
        }

        const data = response.data
        if (!data) {
          setRecipients(normalizedInitialRecipients)
          setFields([])
          setSelectedRecipientId(normalizedInitialRecipients[0]?.id ?? '')
          return
        }

        const mappedRecipients: DraftRecipient[] = data.recipients.map((recipient) => ({
          id: createDraftId(),
          name: recipient.name,
          email: recipient.email,
          recipientType: recipient.recipientType,
          routingOrder: recipient.routingOrder,
          designation: recipient.designation,
          counterpartyId: recipient.counterpartyId,
          counterpartyName: recipient.counterpartyName,
          backgroundOfRequest: recipient.backgroundOfRequest,
          budgetApproved: recipient.budgetApproved,
        }))

        const mappedFields: DraftField[] = data.fields.map((field) => ({
          id: createDraftId(),
          fieldType: field.fieldType,
          pageNumber: field.pageNumber ?? undefined,
          xPosition: field.xPosition ?? undefined,
          yPosition: field.yPosition ?? undefined,
          width: field.width ?? undefined,
          height: field.height ?? undefined,
          anchorString: field.anchorString ?? undefined,
          textValue: field.textValue ?? undefined,
          assignedSignerEmail: field.assignedSignerEmail,
        }))

        const mergedRecipients = mergeRecipientsWithDefaults(mappedRecipients, normalizedInitialRecipients)
        setRecipients(mergedRecipients)
        setFields(mappedFields)
        setSelectedRecipientId(mergedRecipients[0]?.id ?? '')
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
        toast.error(errorMessage)
      } finally {
        setIsLoadingDraft(false)
      }
    }

    void loadDraft()
  }, [contractId, isOpen, normalizedInitialRecipients])

  const activeRecipient = recipients.find((recipient) => recipient.id === selectedRecipientId) ?? recipients[0] ?? null
  const activeRecipientEmail = activeRecipient?.email ?? ''

  const preflightChecks = useMemo<PreflightCheck[]>(() => {
    const normalizedRecipients = recipients
      .map((recipient) => ({
        ...recipient,
        email: recipient.email.trim().toLowerCase(),
        name: recipient.name.trim(),
      }))
      .filter((recipient) => recipient.email)

    const uniqueRoutingOrders = new Set(
      normalizedRecipients.filter((r) => r.recipientType !== 'VIEWER').map((recipient) => recipient.routingOrder)
    )
    const signingRecipientCount = normalizedRecipients.filter((r) => r.recipientType !== 'VIEWER').length
    const allRoutingOrdersSame = uniqueRoutingOrders.size === 1
    const allRoutingOrdersUnique = uniqueRoutingOrders.size === signingRecipientCount
    const hasValidRoutingOrder =
      signingRecipientCount > 0 &&
      (allRoutingOrdersSame || allRoutingOrdersUnique) &&
      normalizedRecipients.filter((r) => r.recipientType !== 'VIEWER').every((recipient) => recipient.routingOrder >= 1)

    const missingSignatureEmails = normalizedRecipients
      .filter(
        (recipient) =>
          recipient.recipientType !== 'VIEWER' &&
          !fields.some(
            (field) =>
              field.fieldType === 'SIGNATURE' && field.assignedSignerEmail.trim().toLowerCase() === recipient.email
          )
      )
      .map((recipient) => recipient.email)

    const invalidFields = fields.filter((field) => {
      const hasAnchor = Boolean(field.anchorString?.trim())
      const hasCoordinates =
        typeof field.pageNumber === 'number' &&
        typeof field.xPosition === 'number' &&
        typeof field.yPosition === 'number'

      return !hasAnchor && !hasCoordinates
    })

    return [
      {
        key: 'document',
        label: 'Primary document available',
        isReady: Boolean(pdfUrl),
        detail: pdfUrl ? 'Ready' : 'No preview document available',
      },
      {
        key: 'recipients',
        label: 'Recipients added',
        isReady: normalizedRecipients.length > 0,
        detail:
          normalizedRecipients.length > 0
            ? `${normalizedRecipients.length} recipient(s)`
            : 'Add at least one recipient',
      },
      {
        key: 'signature_fields',
        label: 'SIGNATURE fields assigned',
        isReady: missingSignatureEmails.length === 0,
        detail:
          missingSignatureEmails.length === 0
            ? 'All recipients have a SIGNATURE field'
            : `Missing for: ${missingSignatureEmails.join(', ')}`,
      },
      {
        key: 'routing_order',
        label: 'Routing order valid',
        isReady: hasValidRoutingOrder,
        detail: hasValidRoutingOrder
          ? allRoutingOrdersSame
            ? 'All recipients share one routing order (parallel send)'
            : 'Unique routing order per recipient (sequential send)'
          : 'Use either same order for all recipients or unique order for each recipient',
      },
      {
        key: 'field_positions',
        label: 'Field placement complete',
        isReady: invalidFields.length === 0,
        detail:
          invalidFields.length === 0
            ? 'All fields have anchor or coordinates'
            : `${invalidFields.length} field(s) missing anchor/page/x/y`,
      },
    ]
  }, [fields, pdfUrl, recipients])

  const blockingPreflightChecks = preflightChecks.filter((check) => !check.isReady)

  const getPageMetrics = useCallback((pageNumber: number) => pageMetricsByNumber[pageNumber], [pageMetricsByNumber])
  const getPageRenderBox = useCallback(
    (pageNumber: number) => pageRenderBoxByNumber[pageNumber],
    [pageRenderBoxByNumber]
  )

  const measureRenderBox = (pageNumber: number) => {
    const el = pageRenderRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPageRenderBoxByNumber((current) => ({
      ...current,
      [pageNumber]: { widthPx: rect.width, heightPx: rect.height },
    }))
  }

  /**
   * Default box size for a field type, with STAMP sized to the seal's own
   * proportions once the image has loaded.
   *
   * Everything downstream keys off this — placement, resize's aspect lock, and
   * the reset handle — so correcting it here corrects all three at once.
   */
  const resolveDefaultFieldSize = useCallback(
    (fieldType: FieldType) => {
      if (fieldType !== 'STAMP' || !stampImageSize) {
        return defaultFieldSizeByType[fieldType]
      }

      return toStampBoxSize({
        nominalWidth: STAMP_NOMINAL_WIDTH,
        imageWidth: stampImageSize.width,
        imageHeight: stampImageSize.height,
      })
    },
    [stampImageSize]
  )

  const resolveFieldDimensions = (field: DraftField) => {
    const defaults = resolveDefaultFieldSize(field.fieldType)
    const rawWidth = field.width ?? defaults.width
    const rawHeight = field.height ?? defaults.height

    if (!isImageFieldType(field.fieldType)) {
      return {
        width: rawWidth,
        height: rawHeight,
      }
    }

    const widthScale = rawWidth / defaults.width
    const heightScale = rawHeight / defaults.height
    const normalizedScale = Number(Math.max(0.5, Math.min(2.5, (widthScale + heightScale) / 2)).toFixed(3))

    return {
      width: Number((defaults.width * normalizedScale).toFixed(2)),
      height: Number((defaults.height * normalizedScale).toFixed(2)),
    }
  }

  const normalizeFieldToPoints = (field: DraftField): DraftField => {
    const pageNumber = field.pageNumber ?? 1
    const metrics = getPageMetrics(pageNumber)
    const dimensions = resolveFieldDimensions(field)
    const normalizedWidth = Number(Math.max(1, dimensions.width).toFixed(2))
    const normalizedHeight = Number(Math.max(1, dimensions.height).toFixed(2))

    if (typeof field.xPosition !== 'number' || typeof field.yPosition !== 'number') {
      return {
        ...field,
        width: normalizedWidth,
        height: normalizedHeight,
      }
    }

    if (!metrics) {
      return {
        ...field,
        xPosition: Number(Math.max(0, field.xPosition).toFixed(2)),
        yPosition: Number(Math.max(0, field.yPosition).toFixed(2)),
        width: normalizedWidth,
        height: normalizedHeight,
      }
    }

    const maxX = Math.max(0, metrics.width - normalizedWidth)
    const maxY = Math.max(0, metrics.height - normalizedHeight)

    return {
      ...field,
      xPosition: Number(Math.max(0, Math.min(maxX, field.xPosition)).toFixed(2)),
      yPosition: Number(Math.max(0, Math.min(maxY, field.yPosition)).toFixed(2)),
      width: normalizedWidth,
      height: normalizedHeight,
    }
  }

  const removeFieldWithCurrentScope = (current: DraftField[], field: DraftField, scope: 'page' | 'group') => {
    // Scope keys off mirrorGroupId, not the live toolbar toggle: a field
    // mirrored at placement time must still delete as a group after the
    // toggle is switched off.
    if (scope === 'group' && field.mirrorGroupId) {
      return current.filter((item) => item.mirrorGroupId !== field.mirrorGroupId)
    }

    return current.filter((item) => item.id !== field.id)
  }

  /**
   * Moves `field` to a new pdf-space position, carrying its mirror group along.
   *
   * Shared by drag and arrow-key nudge so the two cannot drift apart on the
   * group and clamping rules. Group peers are re-projected by ratio against
   * their own page dimensions, matching how placement mirrors a field, so a
   * document mixing A4 and Letter pages stays aligned.
   */
  const moveFieldTo = (
    current: DraftField[],
    field: DraftField,
    nextX: number,
    nextY: number,
    detachFromGroup: boolean
  ): DraftField[] => {
    const pageNumber = field.pageNumber ?? currentPage
    const metrics = getPageMetrics(pageNumber)

    if (!metrics) {
      return current
    }

    const dimensions = resolveFieldDimensions(field)
    const clampedX = clampToRange(nextX, metrics.width - dimensions.width)
    const clampedY = clampToRange(nextY, metrics.height - dimensions.height)
    const xRatio = metrics.width > 0 ? clampedX / metrics.width : 0
    const yRatio = metrics.height > 0 ? clampedY / metrics.height : 0
    const movesAsGroup = Boolean(field.mirrorGroupId) && !detachFromGroup

    return current.map((item) => {
      if (item.id === field.id) {
        return { ...item, xPosition: roundToPoints(clampedX), yPosition: roundToPoints(clampedY) }
      }

      if (!movesAsGroup || item.mirrorGroupId !== field.mirrorGroupId) {
        return item
      }

      const peerMetrics = getPageMetrics(item.pageNumber ?? pageNumber) ?? metrics
      const peerDimensions = resolveFieldDimensions(item)

      return {
        ...item,
        xPosition: roundToPoints(clampToRange(xRatio * peerMetrics.width, peerMetrics.width - peerDimensions.width)),
        yPosition: roundToPoints(clampToRange(yRatio * peerMetrics.height, peerMetrics.height - peerDimensions.height)),
      }
    })
  }

  /**
   * Grows a TEXT box to fit what has been typed, clamped to the page bottom.
   *
   * This is what makes typing unrestricted: the remedy for overflow is applied
   * automatically instead of being demanded of the user. The renderer only
   * refuses when even the clamped height cannot hold the text.
   */
  const applyTextValue = (current: DraftField[], field: DraftField, nextValue: string): DraftField[] =>
    current.map((item) => {
      if (item.id !== field.id) {
        return item
      }

      const dimensions = resolveFieldDimensions(item)
      const layout = layoutStaticText({
        text: nextValue,
        width: dimensions.width,
        height: dimensions.height,
        measure: measureStaticText,
      })

      const minimumHeight = defaultFieldSizeByType.TEXT.height
      const metrics = getPageMetrics(item.pageNumber ?? currentPage)
      const heightAvailableBelowTop = metrics
        ? Math.max(minimumHeight, metrics.height - (item.yPosition ?? 0))
        : Number.POSITIVE_INFINITY

      return {
        ...item,
        textValue: nextValue,
        height: roundToPoints(Math.min(Math.max(minimumHeight, layout.requiredHeight), heightAvailableBelowTop)),
      }
    })

  const resetFieldSize = (field: DraftField) => {
    const defaults = resolveDefaultFieldSize(field.fieldType)

    setFields((current) =>
      current.map((item) => {
        // Reset is always group-wide, deliberately unlike delete: mismatched
        // sizes across pages is the problem it exists to solve.
        const isInScope = field.mirrorGroupId ? item.mirrorGroupId === field.mirrorGroupId : item.id === field.id

        return isInScope ? { ...item, width: defaults.width, height: defaults.height } : item
      })
    )
  }

  const fieldsForCurrentPage = useMemo(
    () => fields.filter((field) => (field.pageNumber ?? 1) === currentPage),
    [currentPage, fields]
  )

  /** Pages the in-flight drag will move; 0 or 1 means there is nothing to warn about. */
  const mirrorDragPageCount = useMemo(() => {
    const dragged = activeDragFieldId ? fields.find((field) => field.id === activeDragFieldId) : undefined

    if (!dragged?.mirrorGroupId) {
      return 0
    }

    return fields.filter((field) => field.mirrorGroupId === dragged.mirrorGroupId).length
  }, [activeDragFieldId, fields])

  const validateDraft = () => {
    if (recipients.length === 0) {
      return 'At least one recipient is required'
    }

    for (const recipient of recipients) {
      if (!recipient.name.trim() || !recipient.email.trim() || recipient.routingOrder < 1) {
        return 'Each recipient needs name, email, type, and routing order'
      }
    }

    return null
  }

  const validateSend = () => {
    const draftError = validateDraft()
    if (draftError) {
      return draftError
    }

    const normalizedRecipients = recipients.map((recipient) => ({
      email: recipient.email.trim().toLowerCase(),
      routingOrder: recipient.routingOrder,
      recipientType: recipient.recipientType,
    }))
    const signingRecipients = normalizedRecipients.filter((r) => r.recipientType !== 'VIEWER')
    const uniqueRoutingOrders = new Set(signingRecipients.map((recipient) => recipient.routingOrder))
    const allRoutingOrdersSame = uniqueRoutingOrders.size === 1
    const allRoutingOrdersUnique = uniqueRoutingOrders.size === signingRecipients.length

    if (!allRoutingOrdersSame && !allRoutingOrdersUnique) {
      return 'Use either same routing order for all recipients or unique order for each recipient'
    }

    for (const recipient of recipients) {
      if (recipient.recipientType === 'VIEWER') {
        continue
      }
      const hasSignature = fields.some(
        (field) =>
          field.assignedSignerEmail.trim().toLowerCase() === recipient.email.trim().toLowerCase() &&
          field.fieldType === 'SIGNATURE'
      )

      if (!hasSignature) {
        return `At least one SIGNATURE field is required for ${recipient.email}`
      }
    }

    for (const field of fields) {
      const hasAnchor = Boolean(field.anchorString?.trim())
      const hasCoordinates =
        typeof field.pageNumber === 'number' &&
        typeof field.xPosition === 'number' &&
        typeof field.yPosition === 'number'

      if (!hasAnchor && !hasCoordinates) {
        return 'Each field must include anchor_string OR page/x/y coordinates'
      }

      // An empty TEXT chip is stripped from the Zoho payload AND rejected by
      // the burn-in renderer, so it would evaporate on both paths. Catch it
      // here rather than after the round-trip.
      if (field.fieldType === 'TEXT' && !field.textValue?.trim()) {
        return `Type the text for the empty text field on page ${field.pageNumber ?? 1}, or remove it`
      }
    }

    return null
  }

  const handleAddRecipient = (recipientType: RecipientType) => {
    setRecipients((current) => [
      ...current,
      {
        id: createDraftId(),
        name: '',
        email: '',
        recipientType,
        routingOrder: 1,
      },
    ])
  }

  const handleRecipientChange = (recipientId: string, patch: Partial<DraftRecipient>) => {
    setRecipients((current) =>
      current.map((recipient) => (recipient.id === recipientId ? { ...recipient, ...patch } : recipient))
    )
  }

  const handleRemoveRecipient = (recipientId: string) => {
    const target = recipients.find((recipient) => recipient.id === recipientId)
    setRecipients((current) => current.filter((recipient) => recipient.id !== recipientId))

    if (target?.email) {
      setFields((current) =>
        current.filter((field) => field.assignedSignerEmail.trim().toLowerCase() !== target.email.trim().toLowerCase())
      )
    }
  }

  const handlePageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Clicking bare page always drops the selection, even when placement below
    // is blocked, so the outline never lingers on a field the user moved off.
    setSelectedFieldId(null)

    if (!canEdit || !activeRecipientEmail || step < 2) {
      return
    }
    if (Date.now() < suppressPlacementUntilMsRef.current) {
      return
    }

    const pageSurface = pageSurfaceRef.current
    if (!pageSurface) {
      return
    }

    const renderBox = getPageRenderBox(currentPage)
    const metrics = getPageMetrics(currentPage)
    const rect = pageRenderRef.current?.getBoundingClientRect()

    if (!renderBox || !metrics || !rect) {
      return
    }

    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top
    const xInPdfSpace = (Math.max(0, Math.min(renderBox.widthPx, clickX)) / renderBox.widthPx) * metrics.width
    const yInPdfSpace = (Math.max(0, Math.min(renderBox.heightPx, clickY)) / renderBox.heightPx) * metrics.height

    const normalizedSignerEmail = activeRecipientEmail.trim().toLowerCase()
    const defaultDimensions = resolveDefaultFieldSize(selectedFieldType)
    const xRatio = metrics.width > 0 ? xInPdfSpace / metrics.width : 0
    const yRatio = metrics.height > 0 ? yInPdfSpace / metrics.height : 0

    const placementPages =
      supportsAllPages(selectedFieldType) && applyToAllPages
        ? Array.from({ length: numPages }, (_, index) => index + 1)
        : [currentPage]
    const mirrorGroupId = supportsAllPages(selectedFieldType) && applyToAllPages ? createDraftId() : undefined

    setFields((current) => {
      if (supportsAllPages(selectedFieldType) && applyToAllPages) {
        const hitField = current.find((field) => {
          if (
            field.fieldType !== selectedFieldType ||
            field.assignedSignerEmail.trim().toLowerCase() !== normalizedSignerEmail ||
            (field.pageNumber ?? 1) !== currentPage ||
            typeof field.xPosition !== 'number' ||
            typeof field.yPosition !== 'number'
          ) {
            return false
          }

          const dimensions = resolveFieldDimensions(field)
          return (
            xInPdfSpace >= field.xPosition &&
            xInPdfSpace <= field.xPosition + dimensions.width &&
            yInPdfSpace >= field.yPosition &&
            yInPdfSpace <= field.yPosition + dimensions.height
          )
        })

        if (hitField) {
          return removeFieldWithCurrentScope(current, hitField, 'group')
        }
      }

      return [
        ...current,
        ...placementPages.map((pageNumber) => ({
          // Keep mirrored placement aligned to each page's dimensions.
          ...((): Pick<DraftField, 'xPosition' | 'yPosition'> => {
            const targetMetrics = getPageMetrics(pageNumber) ?? metrics
            const rawX = xRatio * targetMetrics.width
            const rawY = yRatio * targetMetrics.height
            const clampedX = Number(
              Math.max(0, Math.min(targetMetrics.width - defaultDimensions.width, rawX)).toFixed(2)
            )
            const clampedY = Number(
              Math.max(0, Math.min(targetMetrics.height - defaultDimensions.height, rawY)).toFixed(2)
            )
            return { xPosition: clampedX, yPosition: clampedY }
          })(),
          id: createDraftId(),
          fieldType: selectedFieldType,
          pageNumber,
          width: defaultDimensions.width,
          height: defaultDimensions.height,
          mirrorGroupId,
          assignedSignerEmail: normalizedSignerEmail,
        })),
      ]
    })
  }

  const resolveFieldChipStyle = (field: DraftField): { left: string; top: string; width: string; height: string } => {
    const pageNumber = field.pageNumber ?? 1
    const metrics = getPageMetrics(pageNumber)
    const x = field.xPosition ?? 0
    const y = field.yPosition ?? 0
    const dimensions = resolveFieldDimensions(field)

    if (!metrics) {
      return {
        left: `${Math.max(0, Math.min(100, x))}%`,
        top: `${Math.max(0, Math.min(100, y))}%`,
        width: '12%',
        height: '4%',
      }
    }

    const left = (x / metrics.width) * 100
    const top = (y / metrics.height) * 100
    const width = (dimensions.width / metrics.width) * 100
    const height = (dimensions.height / metrics.height) * 100
    const maxLeft = Math.max(0, 100 - width)
    const maxTop = Math.max(0, 100 - height)

    return {
      left: `${Math.max(0, Math.min(maxLeft, left))}%`,
      top: `${Math.max(0, Math.min(maxTop, top))}%`,
      width: `${Math.max(1, Math.min(100, width))}%`,
      height: `${Math.max(1, Math.min(100, height))}%`,
    }
  }

  useEffect(() => {
    if (!activeResizeFieldId || !canEdit) {
      return
    }

    const onMouseMove = (event: MouseEvent) => {
      const session = resizeSessionRef.current
      if (!session || session.fieldId !== activeResizeFieldId) {
        return
      }

      const metrics = getPageMetrics(session.pageNumber)
      const renderBox = getPageRenderBox(session.pageNumber)
      if (!metrics || !renderBox || renderBox.widthPx <= 0 || renderBox.heightPx <= 0) {
        return
      }

      const scaleX = metrics.width / renderBox.widthPx
      const scaleY = metrics.height / renderBox.heightPx
      const minWidth = 20
      const minHeight = 12

      const deltaWidth = (event.clientX - session.startClientX) * scaleX
      const deltaHeight = (event.clientY - session.startClientY) * scaleY

      setFields((current) =>
        (() => {
          const candidateFields = current.filter(
            (field) =>
              field.id === session.fieldId ||
              (session.mirrorGroupId && field.mirrorGroupId && field.mirrorGroupId === session.mirrorGroupId)
          )

          let groupMaxWidth = Math.max(minWidth, metrics.width - session.xPosition)
          let groupMaxHeight = Math.max(minHeight, metrics.height - session.yPosition)

          for (const candidateField of candidateFields) {
            const candidatePageNumber = candidateField.pageNumber ?? session.pageNumber
            const candidateMetrics = getPageMetrics(candidatePageNumber)
            if (!candidateMetrics) {
              continue
            }
            const candidateX = typeof candidateField.xPosition === 'number' ? candidateField.xPosition : 0
            const candidateY = typeof candidateField.yPosition === 'number' ? candidateField.yPosition : 0
            groupMaxWidth = Math.min(groupMaxWidth, Math.max(minWidth, candidateMetrics.width - candidateX))
            groupMaxHeight = Math.min(groupMaxHeight, Math.max(minHeight, candidateMetrics.height - candidateY))
          }

          const nextDimensions = (() => {
            if (!isImageFieldType(session.fieldType)) {
              return {
                width: Number(Math.max(minWidth, Math.min(groupMaxWidth, session.startWidth + deltaWidth)).toFixed(2)),
                height: Number(
                  Math.max(minHeight, Math.min(groupMaxHeight, session.startHeight + deltaHeight)).toFixed(2)
                ),
              }
            }

            const aspectRatio = session.startHeight / session.startWidth
            const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 22 / 96
            const minWidthForAspect = Math.max(minWidth, minHeight / safeAspectRatio)
            const maxWidthForAspect = Math.max(
              minWidthForAspect,
              Math.min(groupMaxWidth, groupMaxHeight / safeAspectRatio)
            )
            const width = Number(
              Math.max(minWidthForAspect, Math.min(maxWidthForAspect, session.startWidth + deltaWidth)).toFixed(2)
            )
            return {
              width,
              height: Number((width * safeAspectRatio).toFixed(2)),
            }
          })()

          return current.map((field) =>
            field.id === session.fieldId ||
            (session.mirrorGroupId && field.mirrorGroupId && field.mirrorGroupId === session.mirrorGroupId)
              ? { ...field, width: nextDimensions.width, height: nextDimensions.height }
              : field
          )
        })()
      )
    }

    const onMouseUp = () => {
      if (resizeSessionRef.current?.fieldId) {
        // Prevent synthetic click after resize from creating a new field on page surface.
        suppressPlacementUntilMsRef.current = Date.now() + 250
      }
      resizeSessionRef.current = null
      setActiveResizeFieldId(null)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [activeResizeFieldId, canEdit, getPageMetrics, getPageRenderBox, pageMetricsByNumber, pageRenderBoxByNumber])

  useEffect(() => {
    if (!activeDragFieldId || !canEdit) {
      return
    }

    const onMouseMove = (event: MouseEvent) => {
      const session = dragSessionRef.current
      if (!session || session.fieldId !== activeDragFieldId) {
        return
      }

      const metrics = getPageMetrics(session.pageNumber)
      const renderBox = getPageRenderBox(session.pageNumber)
      if (!metrics || !renderBox || renderBox.widthPx <= 0 || renderBox.heightPx <= 0) {
        return
      }

      const deltaXPx = event.clientX - session.startClientX
      const deltaYPx = event.clientY - session.startClientY

      // Below the threshold this is still a click. Without it no click ever
      // registers, because a real press always drifts a pixel or two.
      if (!session.hasMoved && Math.hypot(deltaXPx, deltaYPx) < DRAG_MOVEMENT_THRESHOLD_PX) {
        return
      }
      session.hasMoved = true

      const nextX = session.startX + deltaXPx * (metrics.width / renderBox.widthPx)
      const nextY = session.startY + deltaYPx * (metrics.height / renderBox.heightPx)

      setFields((current) => {
        const dragged = current.find((item) => item.id === session.fieldId)
        return dragged ? moveFieldTo(current, dragged, nextX, nextY, session.detachFromGroup) : current
      })
    }

    const onMouseUp = () => {
      const session = dragSessionRef.current

      if (session?.hasMoved) {
        // Releasing over the page surface fires a click on the common ancestor,
        // which would place a brand new field on top of the one just moved.
        suppressPlacementUntilMsRef.current = Date.now() + 250
      }

      dragSessionRef.current = null
      setActiveDragFieldId(null)
      setIsDetachedDrag(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDragFieldId, canEdit, getPageMetrics, getPageRenderBox, pageMetricsByNumber, pageRenderBoxByNumber])

  const handleChipMouseDown = (event: React.MouseEvent<HTMLDivElement>, field: DraftField) => {
    if (!canEdit) {
      return
    }

    // The textarea and the handles own their own gestures; starting a drag from
    // them would make the text box impossible to click into.
    if ((event.target as HTMLElement).closest('[data-chip-control]')) {
      return
    }

    event.stopPropagation()
    setSelectedFieldId(field.id)

    const pageNumber = field.pageNumber ?? currentPage
    const metrics = getPageMetrics(pageNumber)
    const renderBox = getPageRenderBox(pageNumber)

    if (!metrics || !renderBox || typeof field.xPosition !== 'number' || typeof field.yPosition !== 'number') {
      return
    }

    dragSessionRef.current = {
      fieldId: field.id,
      mirrorGroupId: field.mirrorGroupId,
      pageNumber,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: field.xPosition,
      startY: field.yPosition,
      detachFromGroup: event.altKey,
      hasMoved: false,
    }
    setActiveDragFieldId(field.id)
    setIsDetachedDrag(event.altKey)
  }

  const handleChipKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, field: DraftField) => {
    if (!canEdit || (event.target as HTMLElement).closest('[data-chip-control]')) {
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      setFields((current) => removeFieldWithCurrentScope(current, field, 'page'))
      setSelectedFieldId(null)
      return
    }

    // Drag resolution is capped by page zoom, so arrows are how a stamp lands
    // exactly on a ruled line. Alt matches drag: nudge this copy only.
    const step = event.shiftKey ? NUDGE_STEP_POINTS * NUDGE_COARSE_MULTIPLIER : NUDGE_STEP_POINTS
    const nudgeByKey: Record<string, { x: number; y: number } | undefined> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const nudge = nudgeByKey[event.key]

    if (!nudge || typeof field.xPosition !== 'number' || typeof field.yPosition !== 'number') {
      return
    }

    event.preventDefault()
    setFields((current) =>
      moveFieldTo(current, field, field.xPosition! + nudge.x, field.yPosition! + nudge.y, event.altKey)
    )
  }

  const handleResizeStart = (event: React.MouseEvent<HTMLSpanElement>, field: DraftField) => {
    event.stopPropagation()
    event.preventDefault()
    if (!canEdit) {
      return
    }

    const pageNumber = field.pageNumber ?? currentPage
    const metrics = getPageMetrics(pageNumber)
    const renderBox = getPageRenderBox(pageNumber)
    if (!metrics || !renderBox || typeof field.xPosition !== 'number' || typeof field.yPosition !== 'number') {
      return
    }

    const dimensions = resolveFieldDimensions(field)
    resizeSessionRef.current = {
      fieldId: field.id,
      mirrorGroupId: field.mirrorGroupId,
      fieldType: field.fieldType,
      pageNumber,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: dimensions.width,
      startHeight: dimensions.height,
      xPosition: field.xPosition,
      yPosition: field.yPosition,
    }
    setActiveResizeFieldId(field.id)
  }

  const handleSaveDraft = async () => {
    if (!canEdit || isSavingDraft) {
      return
    }

    const validationError = validateDraft()
    if (validationError) {
      toast.error(validationError)
      return
    }

    setIsSavingDraft(true)

    const normalizedFields = fields.map(normalizeFieldToPoints)

    const draftPayload = {
      recipients: recipients.map((recipient) => ({
        name: recipient.name.trim(),
        email: recipient.email.trim().toLowerCase(),
        recipient_type: recipient.recipientType,
        routing_order: recipient.routingOrder,
        designation: recipient.designation?.trim() || undefined,
        counterparty_id: recipient.counterpartyId?.trim() || undefined,
        counterparty_name: recipient.counterpartyName?.trim() || undefined,
        background_of_request: recipient.backgroundOfRequest?.trim() || undefined,
        budget_approved: recipient.budgetApproved,
      })),
      fields: normalizedFields.map((field) => ({
        field_type: field.fieldType,
        page_number: field.pageNumber,
        x_position: field.xPosition,
        y_position: field.yPosition,
        width: field.width,
        height: field.height,
        anchor_string: field.anchorString,
        // Emptiness is decided on a trimmed copy, but the value sent keeps its
        // whitespace: newlines and indentation are part of the typed clause.
        text_value: field.textValue?.trim() ? field.textValue : undefined,
        assigned_signer_email: field.assignedSignerEmail.trim().toLowerCase(),
      })),
    }

    try {
      const response = await contractsClient.saveSigningPreparationDraft(contractId, draftPayload)

      if (!response.ok) {
        toast.error(response.error?.message ?? 'Failed to save draft')
        return
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      toast.error(errorMessage)
    } finally {
      setIsSavingDraft(false)
    }
  }

  const handleReviewSend = async () => {
    if (!canEdit || isSending) {
      return
    }

    const validationError = validateSend()
    if (validationError) {
      toast.error(validationError)
      return
    }

    setIsSending(true)

    const normalizedFields = fields.map(normalizeFieldToPoints)

    const draftPayload = {
      recipients: recipients.map((recipient) => ({
        name: recipient.name.trim(),
        email: recipient.email.trim().toLowerCase(),
        recipient_type: recipient.recipientType,
        routing_order: recipient.routingOrder,
        designation: recipient.designation?.trim() || undefined,
        counterparty_id: recipient.counterpartyId?.trim() || undefined,
        counterparty_name: recipient.counterpartyName?.trim() || undefined,
        background_of_request: recipient.backgroundOfRequest?.trim() || undefined,
        budget_approved: recipient.budgetApproved,
      })),
      fields: normalizedFields.map((field) => ({
        field_type: field.fieldType,
        page_number: field.pageNumber,
        x_position: field.xPosition,
        y_position: field.yPosition,
        width: field.width,
        height: field.height,
        anchor_string: field.anchorString,
        // Emptiness is decided on a trimmed copy, but the value sent keeps its
        // whitespace: newlines and indentation are part of the typed clause.
        text_value: field.textValue?.trim() ? field.textValue : undefined,
        assigned_signer_email: field.assignedSignerEmail.trim().toLowerCase(),
      })),
    }

    try {
      onReviewSendRequested(draftPayload)
      onClose()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      toast.error(errorMessage)
    } finally {
      setIsSending(false)
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Prepare for signing">
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Prepare For Signing</div>
            <div className={styles.stepper}>Step {step} of 3</div>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.steps}>
          <button type="button" className={step === 1 ? styles.stepActive : styles.step} onClick={() => setStep(1)}>
            1. Add Recipients
          </button>
          <button type="button" className={step === 2 ? styles.stepActive : styles.step} onClick={() => setStep(2)}>
            2. Assign Fields
          </button>
          <button type="button" className={step === 3 ? styles.stepActive : styles.step} onClick={() => setStep(3)}>
            3. Review & Send
          </button>
        </div>

        <div className={styles.body}>
          <aside className={styles.leftPanel}>
            <div className={styles.panelTitle}>Recipients</div>

            {(['EXTERNAL', 'INTERNAL', 'VIEWER'] as const).map((recipientType) => {
              const groupTitle =
                recipientType === 'EXTERNAL' ? 'Counter Party' : recipientType === 'INTERNAL' ? 'NxtWave' : 'Viewers'
              const groupRecipients = recipients.filter((recipient) => recipient.recipientType === recipientType)

              return (
                <section key={recipientType} className={styles.recipientGroup}>
                  <div className={styles.recipientGroupHeader}>
                    <div className={styles.recipientGroupTitle}>{groupTitle}</div>
                    <button
                      type="button"
                      className={styles.smallButton}
                      onClick={() => handleAddRecipient(recipientType)}
                      disabled={!canEdit}
                    >
                      + Add Recipient
                    </button>
                  </div>

                  <div className={styles.recipientList}>
                    {groupRecipients.length === 0 ? (
                      <div className={styles.recipientGroupEmpty}>No recipients yet</div>
                    ) : (
                      groupRecipients.map((recipient) => (
                        <div key={recipient.id} className={styles.recipientCard}>
                          <input
                            className={styles.input}
                            placeholder="Name"
                            value={recipient.name}
                            disabled={!canEdit}
                            onChange={(event) => handleRecipientChange(recipient.id, { name: event.target.value })}
                          />
                          <input
                            className={styles.input}
                            placeholder="Email"
                            value={recipient.email}
                            disabled={!canEdit}
                            onChange={(event) => handleRecipientChange(recipient.id, { email: event.target.value })}
                          />
                          {recipientType !== 'VIEWER' ? (
                            <div className={styles.row}>
                              <input className={styles.input} value={groupTitle} disabled aria-label="Recipient type" />
                              <input
                                className={styles.input}
                                type="number"
                                min={1}
                                value={recipient.routingOrder}
                                disabled={!canEdit}
                                onChange={(event) =>
                                  handleRecipientChange(recipient.id, {
                                    routingOrder: Math.max(1, Number(event.target.value) || 1),
                                  })
                                }
                              />
                            </div>
                          ) : (
                            <div className={styles.row}>
                              <input
                                className={styles.input}
                                value="Viewer (read-only)"
                                disabled
                                aria-label="Recipient type"
                              />
                            </div>
                          )}
                          <button
                            type="button"
                            className={styles.linkButton}
                            onClick={() => handleRemoveRecipient(recipient.id)}
                            disabled={!canEdit}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              )
            })}
          </aside>

          <main className={styles.previewArea}>
            <div className={styles.palette}>
              {fieldPalette.map((fieldType) => (
                <button
                  key={fieldType}
                  type="button"
                  className={selectedFieldType === fieldType ? styles.paletteItemActive : styles.paletteItem}
                  onClick={() => setSelectedFieldType(fieldType)}
                  disabled={!canEdit || (fieldType === 'STAMP' && !isStampConfigured)}
                  title={
                    fieldType === 'STAMP' && !isStampConfigured
                      ? 'No company stamp configured for this organisation'
                      : undefined
                  }
                >
                  {fieldType}
                </button>
              ))}
              <select
                className={styles.input}
                value={activeRecipient?.id ?? ''}
                onChange={(event) => setSelectedRecipientId(event.target.value)}
                disabled={!canEdit}
              >
                <option value="">Assign to recipient</option>
                {recipients
                  .filter((r) => r.recipientType !== 'VIEWER')
                  .map((recipient) => (
                    <option key={recipient.id} value={recipient.id}>
                      {recipient.name || recipient.email || 'Unnamed'}
                    </option>
                  ))}
              </select>
              {supportsAllPages(selectedFieldType) ? (
                <label className={styles.toggleLabel}>
                  <input
                    type="checkbox"
                    checked={applyToAllPages}
                    onChange={(event) => setApplyToAllPages(event.target.checked)}
                    disabled={!canEdit}
                  />
                  Add on all pages
                </label>
              ) : null}
            </div>

            <div className={styles.pageTools}>
              <button
                type="button"
                className={styles.smallButton}
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                Prev
              </button>
              <span>
                Page {currentPage} / {numPages}
              </span>
              <button
                type="button"
                className={styles.smallButton}
                disabled={currentPage >= numPages}
                onClick={() => setCurrentPage((page) => Math.min(numPages, page + 1))}
              >
                Next
              </button>
            </div>

            <div className={styles.pageContainer}>
              {isLoadingDraft ? (
                <div className={styles.placeholder}>Loading draft…</div>
              ) : (
                <div ref={pageSurfaceRef} className={styles.pageSurface} onClick={handlePageClick}>
                  <PrepareForSigningPdfViewer
                    pdfUrl={pdfUrl}
                    currentPage={currentPage}
                    pageRenderRef={pageRenderRef}
                    onDocumentLoadSuccess={(result) => {
                      setNumPages(result.numPages)
                      setCurrentPage((page) => Math.min(page, result.numPages))

                      const getPage = result.getPage

                      if (typeof getPage === 'function') {
                        void (async () => {
                          const nextMetrics: Record<number, { width: number; height: number }> = {}
                          for (let pageNumber = 1; pageNumber <= result.numPages; pageNumber += 1) {
                            try {
                              const page = await getPage(pageNumber)
                              const viewport = page.getViewport({ scale: 1 })
                              nextMetrics[pageNumber] = {
                                width: viewport.width,
                                height: viewport.height,
                              }
                            } catch {
                              // Keep best-effort metrics collection; current page metrics are still captured on page load.
                            }
                          }

                          if (Object.keys(nextMetrics).length > 0) {
                            setPageMetricsByNumber((current) => ({
                              ...current,
                              ...nextMetrics,
                            }))
                          }
                        })()
                      }
                    }}
                    onPageLoadSuccess={(page) => {
                      const viewport = page.getViewport({ scale: 1 })
                      setPageMetricsByNumber((current) => ({
                        ...current,
                        [currentPage]: {
                          width: viewport.width,
                          height: viewport.height,
                        },
                      }))

                      requestAnimationFrame(() => measureRenderBox(currentPage))
                    }}
                  />

                  {fieldsForCurrentPage.map((field) => {
                    const chipDimensions = resolveFieldDimensions(field)
                    // Mirrors the renderer's only remaining hard stop. Outgrowing
                    // the box is no longer worth flagging — the box grows — so the
                    // warning fires solely when there is no page left to grow into.
                    const staticTextOverflows = (() => {
                      if (field.fieldType !== 'TEXT') {
                        return false
                      }

                      const layout = layoutStaticText({
                        text: field.textValue ?? '',
                        width: chipDimensions.width,
                        height: chipDimensions.height,
                        measure: measureStaticText,
                      })
                      const metrics = getPageMetrics(field.pageNumber ?? currentPage)

                      return layout.requiredHeight > (metrics ? metrics.height - (field.yPosition ?? 0) : Infinity)
                    })()

                    const isSelected = selectedFieldId === field.id
                    const chipClassNames = [
                      styles.fieldChip,
                      staticTextOverflows ? styles.fieldChipOverflow : '',
                      isSelected ? styles.fieldChipSelected : '',
                      activeDragFieldId === field.id ? styles.fieldChipDragging : '',
                    ]
                      .filter(Boolean)
                      .join(' ')

                    return (
                      // A div, not a button: a text control nested in a button is
                      // invalid HTML, and any keystroke the browser resolves as a
                      // button activation ran the chip's delete handler. Deleting
                      // now lives only on the × handle and the Delete key.
                      <div
                        key={field.id}
                        role="button"
                        tabIndex={canEdit ? 0 : -1}
                        aria-label={`${field.fieldType} field for ${field.assignedSignerEmail} on page ${field.pageNumber ?? 1}`}
                        aria-pressed={isSelected}
                        className={chipClassNames}
                        style={resolveFieldChipStyle(field)}
                        onMouseDown={(event) => handleChipMouseDown(event, field)}
                        onKeyDown={(event) => handleChipKeyDown(event, field)}
                        // Stops the page surface from treating the release as a
                        // click and placing another field underneath this one.
                        onClick={(event) => event.stopPropagation()}
                        title={
                          staticTextOverflows
                            ? 'Text does not fit above the bottom of the page — move the box higher, widen it, or shorten the text'
                            : `${field.fieldType} → ${field.assignedSignerEmail} (${Math.round(chipDimensions.width)}x${Math.round(chipDimensions.height)}) — drag to move, arrow keys to nudge`
                        }
                      >
                        {field.fieldType === 'STAMP' && stampSignedUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={stampSignedUrl} alt="Company stamp" className={styles.stampPreview} />
                        ) : null}
                        {field.fieldType === 'TEXT' ? (
                          <textarea
                            className={styles.chipTextInput}
                            value={field.textValue ?? ''}
                            placeholder="Type anything…"
                            disabled={!canEdit}
                            spellCheck={false}
                            aria-label={`Static text for ${field.assignedSignerEmail}`}
                            // Marks this as owning its own pointer and key events, so
                            // pressing here neither starts a drag nor nudges the field.
                            data-chip-control="text"
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              const nextValue = event.target.value
                              setFields((current) => applyTextValue(current, field, nextValue))
                            }}
                          />
                        ) : (
                          <>
                            {field.fieldType} {Math.round(chipDimensions.width)}x{Math.round(chipDimensions.height)}
                          </>
                        )}
                        <span
                          className={styles.resizeHandle}
                          role="presentation"
                          data-chip-control="resize"
                          onMouseDown={(event) => handleResizeStart(event, field)}
                          onClick={(event) => {
                            event.stopPropagation()
                            event.preventDefault()
                          }}
                        />
                        {/* Positioned flex row so handle placement does not depend on
                            sibling index: the delete-all handle renders conditionally. */}
                        <span className={styles.chipHandles} role="presentation" data-chip-control="handles">
                          <span
                            className={styles.chipHandle}
                            role="presentation"
                            title="Remove from this page"
                            onClick={(event) => {
                              event.stopPropagation()
                              event.preventDefault()
                              if (!canEdit) {
                                return
                              }
                              setFields((current) => removeFieldWithCurrentScope(current, field, 'page'))
                            }}
                          >
                            ×
                          </span>
                          {field.mirrorGroupId ? (
                            <span
                              className={styles.chipHandle}
                              role="presentation"
                              title="Remove from all pages"
                              onClick={(event) => {
                                event.stopPropagation()
                                event.preventDefault()
                                if (!canEdit) {
                                  return
                                }
                                setFields((current) => removeFieldWithCurrentScope(current, field, 'group'))
                              }}
                            >
                              ⨯⨯
                            </span>
                          ) : null}
                          <span
                            className={styles.chipHandle}
                            role="presentation"
                            title="Reset to default size"
                            onClick={(event) => {
                              event.stopPropagation()
                              event.preventDefault()
                              if (!canEdit) {
                                return
                              }
                              resetFieldSize(field)
                            }}
                          >
                            ↺
                          </span>
                        </span>
                      </div>
                    )
                  })}

                  {/* A modifier nobody is told about is the same as no feature, so
                      the Alt escape hatch announces itself during the drag. */}
                  {mirrorDragPageCount > 1 ? (
                    <div className={styles.dragHint} role="status">
                      {/* Alt is read once at mousedown, so the copy must not imply
                          it can be toggled part-way through the drag. */}
                      {isDetachedDrag
                        ? 'Moving this page only (Alt held)'
                        : `Moving all ${mirrorDragPageCount} pages — hold Alt as you start dragging to move just this one`}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </main>
        </div>

        {step === 3 ? (
          <div className={styles.reviewBoxWrap}>
            <div className={styles.reviewBox}>
              <div>Recipients: {recipients.length}</div>
              <div>Placed Fields: {fields.length}</div>
            </div>
            <div className={styles.preflightBox}>
              <div className={styles.preflightTitle}>Execution Readiness</div>
              {preflightChecks.map((check) => (
                <div key={check.key} className={styles.preflightRow}>
                  <span className={check.isReady ? styles.preflightReady : styles.preflightBlocked}>
                    {check.isReady ? '✓' : '✕'}
                  </span>
                  <span className={styles.preflightLabel}>{check.label}</span>
                  <span className={styles.preflightDetail}>{check.detail}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {isSending ? (
          <div className={styles.sendingProgress} aria-live="polite">
            <span className={styles.sendingDot} />
            <span>{sendingStatuses[sendingStatusIndex]}</span>
          </div>
        ) : null}
        <div className={styles.footer}>
          <button type="button" className={styles.smallButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.smallButton}
            onClick={() => void handleSaveDraft()}
            disabled={!canEdit || isSavingDraft}
          >
            {isSavingDraft ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleReviewSend()}
            disabled={!canEdit || isSending || blockingPreflightChecks.length > 0}
          >
            {isSending ? 'Sending…' : 'Review & Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
