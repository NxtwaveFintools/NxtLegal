import { z } from 'zod'
import { contractCounterpartyValues, contractUploadModes } from '@/core/constants/contracts'
import type { UploadContractMetadataInput } from '@/core/domain/contracts/contract-upload-service'

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

function isValidSignatoryEmail(value: string): boolean {
  const normalizedValue = value.trim()
  if (normalizedValue.toUpperCase() === 'NA') {
    return true
  }

  return EMAIL_PATTERN.test(normalizedValue)
}

export const fileMetadataSchema = z.object({
  fileName: z.string().trim().min(1, 'File name is required').max(255, 'File name is too long'),
  fileSizeBytes: z.number().int().positive('File size must be greater than zero'),
  fileMimeType: z.string().trim().min(1, 'File MIME type is required'),
})

export const uploadContractMetadataSchema = z
  .object({
    title: z.string().trim().min(1, 'Contract title is required').max(200, 'Contract title exceeds maximum length'),
    contractTypeId: z.string().trim().uuid('Valid contractTypeId is required'),
    signatoryName: z.string().trim().max(200, 'Signatory name is too long').optional(),
    signatoryDesignation: z.string().trim().max(200, 'Signatory designation is too long').optional(),
    signatoryEmail: z.string().trim().toLowerCase().optional(),
    backgroundOfRequest: z.string().trim().max(4000, 'Background of request exceeds maximum length').optional(),
    departmentId: z.string().trim(),
    budgetApproved: z.boolean().optional().default(false),
    uploadMode: z
      .enum([contractUploadModes.default, contractUploadModes.legalSendForSigning])
      .optional()
      .default(contractUploadModes.default),
    bypassHodApproval: z.boolean().optional().default(false),
    bypassReason: z.string().trim().max(2000, 'Bypass reason exceeds maximum length').optional(),
    counterpartyName: z.string().trim().max(200, 'Counterparty name is too long').optional(),
    counterparties: z
      .array(
        z.object({
          counterpartyName: z.string().trim().min(1).max(200),
          supportingFiles: z.array(fileMetadataSchema).default([]),
          backgroundOfRequest: z.string().trim().max(4000, 'Background of request exceeds maximum length').optional(),
          budgetApproved: z.boolean().optional(),
          signatories: z
            .array(
              z.object({
                name: z.string().trim().max(200),
                designation: z.string().trim().max(200),
                email: z.string().trim().toLowerCase(),
              })
            )
            .default([]),
        })
      )
      .optional(),
    file: fileMetadataSchema,
    supportingFiles: z.array(fileMetadataSchema).optional().default([]),
  })
  .superRefine((data, context) => {
    if (!data.counterparties || data.counterparties.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one counterparty is required',
        path: ['counterparties'],
      })
      return
    }

    data.counterparties.forEach((counterparty, counterpartyIndex) => {
      const normalizedCounterpartyName = counterparty.counterpartyName.trim()
      const isNotApplicableCounterparty =
        normalizedCounterpartyName.toUpperCase() === contractCounterpartyValues.notApplicable

      if (!isNotApplicableCounterparty && counterparty.signatories.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'At least one signatory is required for each counterparty',
          path: ['counterparties', counterpartyIndex, 'signatories'],
        })
      }

      if (isNotApplicableCounterparty && counterparty.signatories.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NA counterparty cannot have signatories',
          path: ['counterparties', counterpartyIndex, 'signatories'],
        })
      }

      const seenSignatoryEmails = new Set<string>()
      counterparty.signatories.forEach((signatory, signatoryIndex) => {
        if (!isNotApplicableCounterparty && !signatory.name.trim()) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Signatory name is required',
            path: ['counterparties', counterpartyIndex, 'signatories', signatoryIndex, 'name'],
          })
        }

        if (!isNotApplicableCounterparty && !signatory.designation.trim()) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Signatory designation is required',
            path: ['counterparties', counterpartyIndex, 'signatories', signatoryIndex, 'designation'],
          })
        }

        if (!isNotApplicableCounterparty && !signatory.email.trim()) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Signatory email is required',
            path: ['counterparties', counterpartyIndex, 'signatories', signatoryIndex, 'email'],
          })
        }

        if (!isNotApplicableCounterparty && !isValidSignatoryEmail(signatory.email)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Signatory email format is invalid',
            path: ['counterparties', counterpartyIndex, 'signatories', signatoryIndex, 'email'],
          })
        }

        const normalizedEmail = signatory.email.trim().toLowerCase()
        if (normalizedEmail) {
          if (seenSignatoryEmails.has(normalizedEmail)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Duplicate signatory email in same counterparty',
              path: ['counterparties', counterpartyIndex, 'signatories', signatoryIndex, 'email'],
            })
          }
          seenSignatoryEmails.add(normalizedEmail)
        }
      })
    })
  })

export type UploadContractMetadataRequest = z.infer<typeof uploadContractMetadataSchema>

export const resolveUploadContractMetadataInput = (
  requestBody: UploadContractMetadataRequest,
  session: { tenantId: string; employeeId: string; email: string; role: string }
): UploadContractMetadataInput => {
  const counterparties = requestBody.counterparties?.map((counterparty) => ({
    counterpartyName: counterparty.counterpartyName,
    supportingFiles:
      counterparty.counterpartyName.trim().toUpperCase() === contractCounterpartyValues.notApplicable
        ? []
        : counterparty.supportingFiles.map((file) => ({
            fileName: file.fileName,
            fileSizeBytes: file.fileSizeBytes,
            fileMimeType: file.fileMimeType,
          })),
    backgroundOfRequest:
      counterparty.counterpartyName.trim().toUpperCase() === contractCounterpartyValues.notApplicable
        ? contractCounterpartyValues.notApplicable
        : (requestBody.backgroundOfRequest?.trim() ?? ''),
    budgetApproved:
      counterparty.counterpartyName.trim().toUpperCase() === contractCounterpartyValues.notApplicable
        ? false
        : Boolean(requestBody.budgetApproved),
    signatories:
      counterparty.counterpartyName.trim().toUpperCase() === contractCounterpartyValues.notApplicable
        ? []
        : (counterparty.signatories ?? []).map((signatory) => ({
            name: signatory.name.trim(),
            designation: signatory.designation.trim(),
            email: signatory.email.trim().toLowerCase(),
          })),
  }))

  const isLegalSendForSigningMode = requestBody.uploadMode === contractUploadModes.legalSendForSigning
  const fallbackSignatoryDesignation = 'Not provided'
  const fallbackSignatoryEmail = session.email
  const fallbackBackgroundOfRequest = 'Send for signing workflow'
  const primaryCounterpartyForUpload = counterparties?.[0]
  const primarySignatoryForUpload = primaryCounterpartyForUpload?.signatories?.[0]
  const resolvedSignatoryName = isLegalSendForSigningMode
    ? (requestBody.signatoryName ?? '')
    : (primarySignatoryForUpload?.name ??
      (primaryCounterpartyForUpload?.counterpartyName?.toUpperCase() === contractCounterpartyValues.notApplicable
        ? contractCounterpartyValues.notApplicable
        : ''))
  const resolvedSignatoryDesignation = isLegalSendForSigningMode
    ? fallbackSignatoryDesignation
    : (primarySignatoryForUpload?.designation ??
      (primaryCounterpartyForUpload?.counterpartyName?.toUpperCase() === contractCounterpartyValues.notApplicable
        ? contractCounterpartyValues.notApplicable
        : ''))
  const resolvedSignatoryEmail = isLegalSendForSigningMode
    ? fallbackSignatoryEmail
    : (primarySignatoryForUpload?.email ??
      (primaryCounterpartyForUpload?.counterpartyName?.toUpperCase() === contractCounterpartyValues.notApplicable
        ? contractCounterpartyValues.notApplicable
        : ''))
  const resolvedBackgroundOfRequest = isLegalSendForSigningMode
    ? requestBody.backgroundOfRequest?.trim() || fallbackBackgroundOfRequest
    : (requestBody.backgroundOfRequest?.trim() ?? '')

  return {
    tenantId: session.tenantId,
    uploadedByEmployeeId: session.employeeId,
    uploadedByEmail: session.email,
    uploadedByRole: session.role,
    title: requestBody.title,
    contractTypeId: requestBody.contractTypeId,
    signatoryName: resolvedSignatoryName,
    signatoryDesignation: resolvedSignatoryDesignation,
    signatoryEmail: resolvedSignatoryEmail,
    backgroundOfRequest: resolvedBackgroundOfRequest,
    departmentId: requestBody.departmentId,
    budgetApproved: requestBody.budgetApproved,
    uploadMode: requestBody.uploadMode,
    bypassHodApproval: requestBody.bypassHodApproval,
    bypassReason: requestBody.bypassReason,
    counterpartyName: requestBody.counterpartyName,
    counterparties,
    file: requestBody.file,
    supportingFiles: requestBody.supportingFiles ?? [],
  }
}
