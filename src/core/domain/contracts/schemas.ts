import { z } from 'zod'
import { limits } from '@/core/constants/limits'
import { contractStatuses } from '@/core/constants/contracts'

export const contractActionNames = [
  'hod.approve',
  'hod.reject',
  'hod.bypass',
  'legal.approve',
  'legal.reject',
  'legal.query',
  'legal.query.reroute',
  'approver.approve',
  'approver.reject',
] as const

export const listContractsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(limits.paginationPageSize).default(20),
})

export const dashboardContractsFilterValues = [
  'ALL',
  'HOD_PENDING',
  'LEGAL_PENDING',
  'FINAL_APPROVED',
  'LEGAL_QUERY',
] as const

export const dashboardContractsQuerySchema = z.object({
  filter: z.enum(dashboardContractsFilterValues),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(limits.paginationPageSize).default(limits.dashboardContractsPageSize),
  includeExtras: z.coerce.boolean().optional().default(false),
})

export const additionalApproverHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(limits.dashboardContractsPageSize)
    .default(limits.dashboardContractsPageSize),
  departmentId: z.string().uuid().optional(),
})

export const pendingApprovalsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(limits.paginationPageSize).default(20),
})

export const repositorySortByValues = ['title', 'created_at', 'hod_approved_at', 'status', 'tat_deadline_at'] as const
export const repositorySortDirectionValues = ['asc', 'desc'] as const

export const repositoryContractsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(limits.paginationPageSize).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.nativeEnum(contractStatuses).optional(),
  sortBy: z.enum(repositorySortByValues).default('created_at'),
  sortDirection: z.enum(repositorySortDirectionValues).default('desc'),
})

export const contractActionSchema = z
  .object({
    action: z.enum(contractActionNames),
    noteText: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, context) => {
    const isRemarkMandatoryAction =
      value.action === 'legal.query.reroute' ||
      value.action === 'hod.bypass' ||
      value.action === 'hod.reject' ||
      value.action === 'legal.reject' ||
      value.action === 'approver.reject'

    if (isRemarkMandatoryAction && !value.noteText?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['noteText'],
        message: 'Remarks are mandatory for this action',
      })
    }
  })

export const contractNoteSchema = z.object({
  noteText: z.string().trim().min(1, 'Note is required').max(2000, 'Note exceeds maximum length'),
})

export const contractActivityMessageSchema = z.object({
  messageText: z.string().trim().min(1, 'Message is required').max(2000, 'Message exceeds maximum length'),
})

export const contractActivityReadStateSchema = z.object({
  markSeen: z.literal(true).default(true),
})

export const contractApproverSchema = z.object({
  approverEmail: z.string().trim().toLowerCase().email('Valid approver email is required'),
})

export const contractLegalAssignmentSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('set_owner'),
    ownerEmail: z.string().trim().toLowerCase().email('Valid legal owner email is required'),
  }),
  z.object({
    operation: z.literal('add_collaborator'),
    collaboratorEmail: z.string().trim().toLowerCase().email('Valid collaborator email is required'),
  }),
  z.object({
    operation: z.literal('remove_collaborator'),
    collaboratorEmail: z.string().trim().toLowerCase().email('Valid collaborator email is required'),
  }),
])

export type ContractActionName = (typeof contractActionNames)[number]
export type DashboardContractsFilter = (typeof dashboardContractsFilterValues)[number]
export type ContractLegalAssignmentOperation = z.infer<typeof contractLegalAssignmentSchema>['operation']
