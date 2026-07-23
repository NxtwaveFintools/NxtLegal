import { z } from 'zod'

/** Query params for browsing folders (parentId defaults to Drive root in the route). */
export const driveFoldersQuerySchema = z.object({
  parentId: z.string().trim().min(1).max(256).optional(),
})

/**
 * Export payload. Provide `artifact` for final signing artifacts, or `documentId`
 * for a specific contract document; omit both to export the active document.
 */
export const driveExportSchema = z.object({
  contractId: z.string().uuid(),
  documentId: z.string().uuid().optional(),
  artifact: z.enum(['signed_document', 'completion_certificate', 'merged_pdf']).optional(),
  folderId: z.string().trim().min(1).max(256),
  folderName: z.string().trim().min(1).max(512),
})

export const driveImportQuerySchema = z.object({
  fileId: z.string().trim().min(1).max(256),
})

export type DriveExportInput = z.infer<typeof driveExportSchema>
export type DriveFoldersQuery = z.infer<typeof driveFoldersQuerySchema>
export type DriveImportQuery = z.infer<typeof driveImportQuerySchema>
