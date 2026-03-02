import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import {
  contractRepositoryExportColumnLabels,
  contractRepositoryExportColumns,
  contractRepositoryExportFormats,
} from '@/core/constants/contracts'
import { withAuth } from '@/core/http/with-auth'
import { errorResponse } from '@/core/http/response'
import { isAppError } from '@/core/http/errors'
import { getContractQueryService } from '@/core/registry/service-registry'
import { repositoryExportQuerySchema } from '@/core/domain/contracts/schemas'
import type { RepositoryExportColumn } from '@/core/domain/contracts/contract-query-repository'

const defaultColumns = Object.values(contractRepositoryExportColumns) as RepositoryExportColumn[]
const repositoryReportingAllowedRoles = new Set(['LEGAL_TEAM', 'ADMIN', 'LEGAL_ADMIN', 'SUPER_ADMIN'])

const toLabeledRows = (rows: Record<string, string | number>[], columns: RepositoryExportColumn[]) =>
  rows.map((row) => {
    const labeled: Record<string, string | number> = {}

    for (const column of columns) {
      labeled[contractRepositoryExportColumnLabels[column]] = row[column] ?? ''
    }

    return labeled
  })

const buildCsvHeader = (columns: RepositoryExportColumn[]): string =>
  columns.map((column) => contractRepositoryExportColumnLabels[column]).join(',')

const buildCsvChunk = (rows: Record<string, string | number>[], columns: RepositoryExportColumn[]): string => {
  if (rows.length === 0) {
    return ''
  }

  const escapeValue = (value: unknown): string => {
    const raw = typeof value === 'string' ? value : String(value ?? '')
    return `"${raw.replace(/"/g, '""')}"`
  }

  return `${rows.map((row) => columns.map((column) => escapeValue(row[column])).join(',')).join('\n')}\n`
}

const buildXlsxBuffer = async (
  rows: Record<string, string | number>[],
  columns: RepositoryExportColumn[]
): Promise<Buffer> => {
  const XLSX = await import('xlsx')
  const worksheet = XLSX.utils.json_to_sheet(toLabeledRows(rows, columns))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Repository Report')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const buildPdfBuffer = async (
  rows: Record<string, string | number>[],
  columns: RepositoryExportColumn[]
): Promise<Buffer> => {
  const pdfkit = await import('pdfkit')
  const PDFDocument = pdfkit.default
  const headers = columns.map((column) => contractRepositoryExportColumnLabels[column])

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const doc = new PDFDocument({ size: 'A4', margin: 36 })

    doc.on('data', (chunk: Uint8Array | Buffer) => chunks.push(Buffer.from(chunk)))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', (error) => reject(error))

    doc.fontSize(14).text('Contract Repository Report', { underline: true })
    doc.moveDown(0.8)
    doc.fontSize(9).text(headers.join(' | '))
    doc.moveDown(0.6)

    for (const row of rows) {
      const values = columns.map((column) => String(row[column] ?? ''))
      doc.text(values.join(' | '), {
        width: 520,
      })
      doc.moveDown(0.3)
    }

    doc.end()
  })
}

const GETHandler = withAuth(async (request: NextRequest, { session }) => {
  try {
    if (!session.tenantId) {
      return NextResponse.json(errorResponse('SESSION_INVALID', 'Session tenant is required'), { status: 401 })
    }

    const tenantId = session.tenantId

    const normalizedRole = (session.role ?? '').toUpperCase()
    if (!repositoryReportingAllowedRoles.has(normalizedRole)) {
      return NextResponse.json(errorResponse('FORBIDDEN', 'You are not allowed to export repository reports'), {
        status: 403,
      })
    }

    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const { search, status, repositoryStatus, dateBasis, datePreset, fromDate, toDate, format, columns } =
      repositoryExportQuerySchema.parse(queryParams)

    const selectedColumns = columns.length > 0 ? columns : defaultColumns

    const contractQueryService = getContractQueryService()
    if (format === contractRepositoryExportFormats.csv) {
      const encoder = new TextEncoder()
      let isAborted = request.signal.aborted
      const abortListener = () => {
        isAborted = true
      }
      request.signal.addEventListener('abort', abortListener)

      const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          try {
            if (isAborted) {
              controller.close()
              return
            }

            controller.enqueue(encoder.encode('\uFEFF'))
            controller.enqueue(encoder.encode(`${buildCsvHeader(selectedColumns)}\n`))

            let cursor: string | undefined

            while (true) {
              if (isAborted) {
                break
              }

              const chunk = await contractQueryService.listRepositoryExportRowsChunk({
                tenantId,
                employeeId: session.employeeId,
                role: session.role,
                cursor,
                limit: 200,
                search,
                status,
                repositoryStatus,
                dateBasis,
                datePreset,
                fromDate,
                toDate,
                columns: selectedColumns,
              })

              if (chunk.items.length === 0) {
                break
              }

              controller.enqueue(encoder.encode(buildCsvChunk(chunk.items, selectedColumns)))

              if (!chunk.nextCursor) {
                break
              }

              cursor = chunk.nextCursor
            }

            controller.close()
          } catch (streamError) {
            const isAbortError =
              isAborted ||
              (streamError instanceof DOMException && streamError.name === 'AbortError') ||
              (streamError instanceof Error && streamError.name === 'AbortError')

            if (isAbortError) {
              try {
                controller.close()
              } catch {
                return
              }
              return
            }

            controller.error(streamError)
          } finally {
            request.signal.removeEventListener('abort', abortListener)
          }
        },
        cancel: () => {
          isAborted = true
        },
      })

      return new NextResponse(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="contract-repository-report.csv"',
        },
      })
    }

    const rows = await contractQueryService.listRepositoryExportRows({
      tenantId,
      employeeId: session.employeeId,
      role: session.role,
      search,
      status,
      repositoryStatus,
      dateBasis,
      datePreset,
      fromDate,
      toDate,
      columns: selectedColumns,
    })

    if (format === contractRepositoryExportFormats.excel) {
      const buffer = await buildXlsxBuffer(rows, selectedColumns)
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="contract-repository-report.xlsx"',
        },
      })
    }

    const pdfBuffer = await buildPdfBuffer(rows, selectedColumns)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="contract-repository-report.pdf"',
      },
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(errorResponse('VALIDATION_ERROR', 'Invalid repository export query params'), {
        status: 400,
      })
    }

    const status = isAppError(error) ? error.statusCode : 500
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const message = isAppError(error) ? error.message : 'Failed to export repository report'

    return NextResponse.json(errorResponse(code, message), { status })
  }
})

export const GET = GETHandler
