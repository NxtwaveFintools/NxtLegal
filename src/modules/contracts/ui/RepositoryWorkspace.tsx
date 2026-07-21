'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value'
import { toast } from 'sonner'
import ContractStatusBadge from '@/modules/contracts/ui/ContractStatusBadge'
import ThirdPartyUploadSidebar from '@/modules/contracts/ui/third-party-upload/ThirdPartyUploadSidebar'
import ProtectedAppShell from '@/modules/dashboard/ui/ProtectedAppShell'
import {
  contractUploadModes,
  contractRepositoryExportColumnLabels,
  contractRepositoryExportColumns,
  contractRepositoryStatusLabels,
} from '@/core/constants/contracts'
import {
  contractsClient,
  type ContractRecord,
  type DepartmentOption,
  type LegalTeamMemberOption,
  type RepositoryDateBasis,
  type RepositoryExportColumn,
  type RepositoryStatusFilter,
  type RepositoryDatePreset,
  type RepositorySortBy,
} from '@/core/client/contracts-client'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import type { RepositoryWorkspaceTableProps } from './RepositoryWorkspaceTable'
import styles from './RepositoryWorkspace.module.css'

const RepositoryWorkspaceTable = dynamic<RepositoryWorkspaceTableProps>(() => import('./RepositoryWorkspaceTable'), {
  ssr: false,
})

const DocxPreview = dynamic(() => import('@/modules/contracts/ui/DocxPreview'), {
  ssr: false,
})

type RepositoryWorkspaceProps = {
  session: {
    fullName?: string | null
    email?: string | null
    team?: string | null
    role?: string | null
    canAccessApproverHistory?: boolean
  }
}

const timestampFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const legalDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const resolveFileExtension = (fileName: string): string => {
  const normalizedFileName = fileName.trim().toLowerCase()
  const lastDotIndex = normalizedFileName.lastIndexOf('.')

  if (lastDotIndex <= 0 || lastDotIndex === normalizedFileName.length - 1) {
    return ''
  }

  return normalizedFileName.slice(lastDotIndex + 1)
}

const sortableColumnMap: Record<string, RepositorySortBy> = {
  title: 'title',
  requestDate: 'created_at',
  hodApprovedAt: 'hod_approved_at',
  status: 'status',
  contractAging: 'tat_deadline_at',
}

const repositoryDatePresetOptions: Array<{ value: RepositoryDatePreset; label: string }> = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'multiple_months', label: 'Multiple Months' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom Date Range' },
]

const repositoryDateBasisOptions: Array<{ value: RepositoryDateBasis; label: string }> = [
  { value: 'request_created_at', label: 'Request Date' },
  { value: 'hod_approved_at', label: 'HOD Approval Date' },
]

const agingPolicyText = '7 business days'
const defaultExportColumns = Object.values(contractRepositoryExportColumns) as RepositoryExportColumn[]
const stuckStateStatuses = new Set([
  'UNDER_REVIEW',
  'PENDING_WITH_INTERNAL_STAKEHOLDERS',
  'PENDING_WITH_EXTERNAL_STAKEHOLDERS',
  'SIGNING',
])

function getDaysInStatus(updatedAt?: string): number | null {
  if (!updatedAt) {
    return null
  }

  const updatedAtDate = new Date(updatedAt)
  if (Number.isNaN(updatedAtDate.getTime())) {
    return null
  }

  const msDifference = Date.now() - updatedAtDate.getTime()
  return Math.max(0, Math.floor(msDifference / (1000 * 60 * 60 * 24)))
}

function getStuckTone(daysInStatus: number): 'green' | 'yellow' | 'red' {
  if (daysInStatus <= 3) {
    return 'green'
  }

  if (daysInStatus <= 7) {
    return 'yellow'
  }

  return 'red'
}

function getAgingTone(agingBusinessDays: number | null | undefined): 'green' | 'yellow' | 'red' | 'neutral' {
  if (typeof agingBusinessDays !== 'number') {
    return 'neutral'
  }

  if (agingBusinessDays <= 5) {
    return 'green'
  }

  if (agingBusinessDays <= 7) {
    return 'yellow'
  }

  return 'red'
}

function formatOverdueLabel(record: ContractRecord): string | null {
  if (!record.isTatBreached || typeof record.agingBusinessDays !== 'number') {
    return null
  }

  const overdueDays = Math.max(record.agingBusinessDays - 7, 0)
  if (overdueDays === 0) {
    return 'TAT Breached'
  }

  return `Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`
}

function formatTatSummary(record: ContractRecord): string | null {
  const overdueLabel = formatOverdueLabel(record)
  if (overdueLabel) {
    return overdueLabel
  }

  if (typeof record.agingBusinessDays === 'number') {
    return `${record.agingBusinessDays} day${record.agingBusinessDays === 1 ? '' : 's'} aging`
  }

  return null
}

function formatLegalDate(value?: string | null): string {
  if (!value) {
    return '-'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '-'
  }

  return legalDateFormatter.format(parsed).replace(/\//g, '-')
}

function resolveAssignedToDisplay(record: ContractRecord): {
  visibleAssignees: string
  hiddenCount: number
  fullAssignees: string
} {
  const assignees = (record.assignedToUsers ?? [record.currentAssigneeEmail]).filter((value): value is string =>
    Boolean(value)
  )

  if (assignees.length === 0) {
    return {
      visibleAssignees: '—',
      hiddenCount: 0,
      fullAssignees: '—',
    }
  }

  const visibleAssignees = assignees.slice(0, 2).join(', ')
  const hiddenCount = Math.max(assignees.length - 2, 0)

  return {
    visibleAssignees,
    hiddenCount,
    fullAssignees: assignees.join(', '),
  }
}

function toFallbackDisplayName(email: string): string {
  const localPart = email.split('@')[0] ?? email
  const normalized = localPart.replace(/[._-]+/g, ' ').trim()

  if (!normalized) {
    return email
  }

  return normalized
    .split(' ')
    .map((segment) => (segment.length > 0 ? `${segment[0].toUpperCase()}${segment.slice(1)}` : segment))
    .join(' ')
}

export default function RepositoryWorkspace({ session }: RepositoryWorkspaceProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const normalizedRole = (session.role ?? '').toUpperCase()
  const isLegalTeamRole = normalizedRole === 'LEGAL_TEAM' || normalizedRole === 'ADMIN'
  const canSeeTatAndAging =
    normalizedRole === 'LEGAL_TEAM' ||
    normalizedRole === 'LEGAL_ADMIN' ||
    normalizedRole === 'ADMIN' ||
    normalizedRole === 'SUPER_ADMIN'
  const canAccessRepositoryReporting =
    isLegalTeamRole ||
    normalizedRole === 'LEGAL_ADMIN' ||
    normalizedRole === 'ADMIN' ||
    normalizedRole === 'SUPER_ADMIN'

  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const debouncedSearch = useDebouncedValue(search, 400)
  const [statusFilters, setStatusFilters] = useState<RepositoryStatusFilter[]>(
    () => (searchParams.get('statuses')?.split(',').filter(Boolean) ?? []) as RepositoryStatusFilter[]
  )
  const [dateBasis, setDateBasis] = useState<RepositoryDateBasis>(
    () => (searchParams.get('dateBasis') as RepositoryDateBasis) ?? 'request_created_at'
  )
  const [datePreset, setDatePreset] = useState<RepositoryDatePreset | ''>(
    () => (searchParams.get('datePreset') as RepositoryDatePreset) ?? ''
  )
  const [customFromDate, setCustomFromDate] = useState(() => searchParams.get('from') ?? '')
  const [customToDate, setCustomToDate] = useState(() => searchParams.get('to') ?? '')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'requestDate', desc: true }])
  const [page, setPage] = useState<number>(1)
  const [totalCount, setTotalCount] = useState<number>(0)
  const [rowsPerPage, setRowsPerPage] = useState<number>(15)
  const [reportMetrics, setReportMetrics] = useState<{
    departmentMetrics: Array<{
      departmentId: string | null
      departmentName: string | null
      totalRequestsReceived: number
      approved: number
      rejected: number
      completed: number
      pending: number
    }>
    statusMetrics: Array<{ key: string; label: string; count: number }>
  } | null>(null)
  const [isReportLoading, setIsReportLoading] = useState(false)
  const [selectedExportColumns, setSelectedExportColumns] = useState<RepositoryExportColumn[]>(defaultExportColumns)
  const [activeExportFormat, setActiveExportFormat] = useState<'csv' | 'excel' | null>(null)
  const [activePreview, setActivePreview] = useState<{
    url: string
    fileName: string
    fileMimeType: string
    externalUrl: string
    isDocx: boolean
  } | null>(null)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [legalTeamMembers, setLegalTeamMembers] = useState<LegalTeamMemberOption[]>([])
  const [legalTeamMembersError, setLegalTeamMembersError] = useState<string | null>(null)
  const [openAssignmentDropdownContractId, setOpenAssignmentDropdownContractId] = useState<string | null>(null)
  const [assignmentSavingByContractId, setAssignmentSavingByContractId] = useState<Record<string, boolean>>({})
  const [assignmentErrorByContractId, setAssignmentErrorByContractId] = useState<Record<string, string>>({})
  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [departmentFilters, setDepartmentFilters] = useState<string[]>(
    () => searchParams.get('depts')?.split(',').filter(Boolean) ?? []
  )
  const [hodApprovalFilter, setHodApprovalFilter] = useState<'yes' | 'no' | ''>(
    () => (searchParams.get('hod') ?? '') as 'yes' | 'no' | ''
  )
  const [founderApprovalFilter, setFounderApprovalFilter] = useState<'yes' | 'no' | ''>(
    () => (searchParams.get('founderApproval') ?? '') as 'yes' | 'no' | ''
  )
  const [assignedToFilters, setAssignedToFilters] = useState<string[]>(
    () => searchParams.get('assignees')?.split(',').filter(Boolean) ?? []
  )
  const [openHeaderFilter, setOpenHeaderFilter] = useState<
    'department' | 'hodApproval' | 'founderApproval' | 'assignedTo' | 'status' | 'statusColumn' | null
  >(null)
  const tableWrapRef = useRef<HTMLElement | null>(null)
  const tableAutoScrollFrameRef = useRef<number | null>(null)
  const tableAutoScrollVelocityRef = useRef(0)

  const stopTableAutoScroll = useCallback(() => {
    tableAutoScrollVelocityRef.current = 0
    if (tableAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(tableAutoScrollFrameRef.current)
      tableAutoScrollFrameRef.current = null
    }
  }, [])

  const runTableAutoScroll = useCallback(() => {
    const tableWrap = tableWrapRef.current
    if (!tableWrap) {
      stopTableAutoScroll()
      return
    }

    const velocity = tableAutoScrollVelocityRef.current
    if (Math.abs(velocity) < 0.1) {
      stopTableAutoScroll()
      return
    }

    tableWrap.scrollLeft += velocity
    tableAutoScrollFrameRef.current = window.requestAnimationFrame(runTableAutoScroll)
  }, [stopTableAutoScroll])

  const handleTableWrapMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const tableWrap = event.currentTarget
      if (tableWrap.scrollWidth <= tableWrap.clientWidth) {
        stopTableAutoScroll()
        return
      }

      const bounds = tableWrap.getBoundingClientRect()
      const edgeThreshold = Math.min(96, bounds.width * 0.2)
      const maxSpeed = 14

      let velocity = 0
      const distanceFromLeftEdge = event.clientX - bounds.left
      const distanceFromRightEdge = bounds.right - event.clientX

      if (distanceFromLeftEdge <= edgeThreshold) {
        const ratio = (edgeThreshold - distanceFromLeftEdge) / edgeThreshold
        velocity = -Math.max(1, maxSpeed * ratio)
      } else if (distanceFromRightEdge <= edgeThreshold) {
        const ratio = (edgeThreshold - distanceFromRightEdge) / edgeThreshold
        velocity = Math.max(1, maxSpeed * ratio)
      }

      tableAutoScrollVelocityRef.current = velocity

      if (velocity !== 0 && tableAutoScrollFrameRef.current === null) {
        tableAutoScrollFrameRef.current = window.requestAnimationFrame(runTableAutoScroll)
      }

      if (velocity === 0) {
        stopTableAutoScroll()
      }
    },
    [runTableAutoScroll, stopTableAutoScroll]
  )

  const activeSort = sorting[0]
  const sortBy = sortableColumnMap[activeSort?.id ?? 'requestDate'] ?? 'created_at'
  const sortDirection = activeSort?.desc ? 'desc' : 'asc'
  const totalPages = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / rowsPerPage)) : 1
  const requestIdRef = useRef(0)

  // Fires list and report as two *parallel* browser requests rather than a single
  // combined server-side request.  The server's Promise.all approach caused internal
  const loadContractsAndReport = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    if (canAccessRepositoryReporting) {
      setIsReportLoading(true)
    }

    try {
      const response = await contractsClient.repositoryList({
        page,
        limit: rowsPerPage,
        sortBy,
        sortDirection,
        search: debouncedSearch,
        repositoryStatuses: statusFilters.length > 0 ? statusFilters : undefined,
        dateBasis,
        datePreset: datePreset || undefined,
        fromDate: datePreset === 'custom' && customFromDate ? customFromDate : undefined,
        toDate: datePreset === 'custom' && customToDate ? customToDate : undefined,
        departmentIds: departmentFilters.length > 0 ? departmentFilters : undefined,
        hodApproval: hodApprovalFilter || undefined,
        founderApproval: founderApprovalFilter || undefined,
        assignedToEmails: assignedToFilters.length > 0 ? assignedToFilters : undefined,
        includeReport: canAccessRepositoryReporting,
      })

      // A newer request has since been issued; ignore this now-stale response.
      if (requestIdRef.current !== requestId) {
        return
      }

      if (!response.ok || !response.data) {
        setContracts([])
        setTotalCount(0)
        toast.error(response.error?.message ?? 'Failed to load repository contracts')
        return
      }

      setContracts(response.data.contracts)
      setTotalCount(response.data.pagination.total)

      if (canAccessRepositoryReporting) {
        setReportMetrics(response.data.report ?? null)
      }
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return
      }
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      toast.error(errorMessage)
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false)
        if (canAccessRepositoryReporting) {
          setIsReportLoading(false)
        }
      }
    }
  }, [
    canAccessRepositoryReporting,
    page,
    customFromDate,
    customToDate,
    dateBasis,
    datePreset,
    debouncedSearch,
    statusFilters,
    sortBy,
    sortDirection,
    departmentFilters,
    hodApprovalFilter,
    founderApprovalFilter,
    assignedToFilters,
    rowsPerPage,
  ])

  const filterSignature = JSON.stringify([
    customFromDate,
    customToDate,
    dateBasis,
    datePreset,
    debouncedSearch,
    statusFilters,
    sortBy,
    sortDirection,
    departmentFilters,
    hodApprovalFilter,
    founderApprovalFilter,
    assignedToFilters,
    rowsPerPage,
  ])
  const prevFilterSignatureRef = useRef(filterSignature)

  useEffect(() => {
    if (prevFilterSignatureRef.current !== filterSignature) {
      prevFilterSignatureRef.current = filterSignature
      if (page !== 1) {
        setPage(1)
        return
      }
    }
    void loadContractsAndReport()
  }, [loadContractsAndReport, filterSignature, page])

  useEffect(() => {
    if (!isLegalTeamRole) {
      setLegalTeamMembers([])
      setLegalTeamMembersError(null)
      return
    }

    const loadLegalTeamMembers = async () => {
      const response = await contractsClient.legalTeamMembers()

      if (!response.ok || !response.data) {
        setLegalTeamMembers([])
        setLegalTeamMembersError(response.error?.message ?? 'Failed to load legal team members')
        return
      }

      setLegalTeamMembers(response.data.members)
      setLegalTeamMembersError(null)
    }

    void loadLegalTeamMembers()
  }, [isLegalTeamRole])

  useEffect(() => {
    const loadDepartments = async () => {
      const response = await contractsClient.departments()
      if (!response.ok || !response.data) {
        setDepartments([])
        return
      }
      setDepartments(response.data.departments)
    }

    void loadDepartments()
  }, [])

  useEffect(() => {
    if (!openHeaderFilter) {
      return
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) {
        setOpenHeaderFilter(null)
        return
      }
      if (target.closest('[data-repository-header-filter]')) {
        return
      }
      setOpenHeaderFilter(null)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [openHeaderFilter])

  useEffect(() => {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (statusFilters.length > 0) params.set('statuses', statusFilters.join(','))
    if (departmentFilters.length > 0) params.set('depts', departmentFilters.join(','))
    if (hodApprovalFilter) params.set('hod', hodApprovalFilter)
    if (founderApprovalFilter) params.set('founderApproval', founderApprovalFilter)
    if (assignedToFilters.length > 0) params.set('assignees', assignedToFilters.join(','))
    if (dateBasis !== 'request_created_at') params.set('dateBasis', dateBasis)
    if (datePreset) params.set('datePreset', datePreset)
    if (customFromDate) params.set('from', customFromDate)
    if (customToDate) params.set('to', customToDate)
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `/repository?${qs}` : '/repository')
  }, [
    search,
    statusFilters,
    departmentFilters,
    hodApprovalFilter,
    founderApprovalFilter,
    assignedToFilters,
    dateBasis,
    datePreset,
    customFromDate,
    customToDate,
  ])

  const toggleStatusFilter = useCallback((value: RepositoryStatusFilter) => {
    setStatusFilters((current) =>
      current.includes(value) ? current.filter((status) => status !== value) : [...current, value]
    )
  }, [])

  const handleDateBasisChange = useCallback((value: RepositoryDateBasis) => {
    setDateBasis(value)
  }, [])

  const handleDatePresetChange = useCallback((value: RepositoryDatePreset | '') => {
    setDatePreset(value)
    if (value !== 'custom') {
      setCustomFromDate('')
      setCustomToDate('')
    }
  }, [])

  const closePreview = useCallback(() => {
    setActivePreview(null)
  }, [])

  useEffect(() => {
    if (!activePreview) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePreview()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePreview, closePreview])

  useEffect(() => () => stopTableAutoScroll(), [stopTableAutoScroll])

  const handleOpenCurrentDocument = useCallback(async (contract: ContractRecord) => {
    const response = await contractsClient.download(contract.id, {
      documentId: contract.currentDocumentId ?? undefined,
    })

    if (!response.ok || !response.data?.signedUrl) {
      toast.error(response.error?.message ?? 'Failed to generate document view link')
      return
    }

    const resolvedFileName = (response.data.fileName ?? contract.fileName?.trim()) || contract.title
    const resolvedMimeType = (contract.fileMimeType ?? '').trim().toLowerCase()
    const resolvedExtension = resolveFileExtension(resolvedFileName)
    const isDocx =
      resolvedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      resolvedExtension === 'docx'
    const isSpreadsheet =
      resolvedExtension === 'xls' ||
      resolvedExtension === 'xlsx' ||
      resolvedMimeType.includes('spreadsheetml') ||
      resolvedMimeType.includes('ms-excel')
    const isTextPreview =
      resolvedExtension === 'csv' ||
      resolvedExtension === 'tsv' ||
      resolvedExtension === 'txt' ||
      resolvedMimeType.startsWith('text/') ||
      resolvedMimeType.includes('csv')
    const isPresentation =
      resolvedExtension === 'ppt' ||
      resolvedExtension === 'pptx' ||
      resolvedMimeType.includes('ms-powerpoint') ||
      resolvedMimeType.includes('presentationml')
    const isLegacyDoc = resolvedExtension === 'doc' || resolvedMimeType.includes('application/msword')
    // Word docs are rendered client-side with docx-preview for high fidelity, so they
    // need the raw binary rather than the server-side HTML conversion.
    const renderAsHtml = !isDocx && (isLegacyDoc || isPresentation || isSpreadsheet || isTextPreview)

    const binaryPreviewUrl = contractsClient.previewUrl(contract.id, {
      documentId: contract.currentDocumentId ?? undefined,
      renderAs: 'binary',
    })
    const htmlPreviewUrl = contractsClient.previewUrl(contract.id, {
      documentId: contract.currentDocumentId ?? undefined,
      renderAs: 'html',
    })

    setActivePreview({
      url: isDocx ? binaryPreviewUrl : renderAsHtml ? htmlPreviewUrl : binaryPreviewUrl,
      fileName: resolvedFileName,
      fileMimeType: resolvedMimeType,
      // Route "Open in New Tab" through our preview route (served inline) instead of
      // the raw Supabase signed URL, which forces a download instead of displaying.
      externalUrl: isDocx || renderAsHtml ? htmlPreviewUrl : binaryPreviewUrl,
      isDocx,
    })
  }, [])

  const resolveContractAssignedEmails = useCallback((contract: ContractRecord): string[] => {
    const assignees = [contract.currentAssigneeEmail, ...(contract.assignedToUsers ?? [])]
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    return Array.from(new Set(assignees))
  }, [])

  const resolveContractCollaboratorEmails = useCallback(
    (contract: ContractRecord): string[] => {
      const currentAssigneeEmail = contract.currentAssigneeEmail.trim().toLowerCase()
      return resolveContractAssignedEmails(contract).filter((email) => email !== currentAssigneeEmail)
    },
    [resolveContractAssignedEmails]
  )

  const resolveEmailDisplayName = useCallback(
    (email: string): string => {
      const member = legalTeamMembers.find((item) => item.email.toLowerCase() === email.toLowerCase())
      if (member?.fullName?.trim()) {
        return member.fullName
      }

      return toFallbackDisplayName(email)
    },
    [legalTeamMembers]
  )

  const handleContractAssignmentChange = useCallback(
    async (contractId: string, selectedEmails: string[]) => {
      if (!isLegalTeamRole) {
        return
      }

      if (assignmentSavingByContractId[contractId]) {
        return
      }

      const targetContract = contracts.find((contract) => contract.id === contractId)
      if (!targetContract) {
        return
      }

      const currentAssigneeEmail = targetContract.currentAssigneeEmail.trim().toLowerCase()
      const previousEmails = resolveContractCollaboratorEmails(targetContract)
      const nextEmails = Array.from(new Set(selectedEmails.map((value) => value.trim().toLowerCase()).filter(Boolean)))

      if (previousEmails.length === nextEmails.length && previousEmails.every((email) => nextEmails.includes(email))) {
        return
      }

      const emailsToAdd = nextEmails.filter((email) => !previousEmails.includes(email))
      const emailsToRemove = previousEmails.filter((email) => !nextEmails.includes(email))

      setAssignmentSavingByContractId((current) => ({ ...current, [contractId]: true }))
      setAssignmentErrorByContractId((current) => {
        const next = { ...current }
        delete next[contractId]
        return next
      })

      setContracts((current) =>
        current.map((contract) =>
          contract.id === contractId
            ? { ...contract, assignedToUsers: Array.from(new Set([currentAssigneeEmail, ...nextEmails])) }
            : contract
        )
      )

      try {
        for (const email of emailsToAdd) {
          const response = await contractsClient.manageAssignment(contractId, {
            operation: 'add_collaborator',
            collaboratorEmail: email,
          })

          if (!response.ok) {
            throw new Error(response.error?.message ?? 'Failed to add collaborator')
          }
        }

        for (const email of emailsToRemove) {
          const response = await contractsClient.manageAssignment(contractId, {
            operation: 'remove_collaborator',
            collaboratorEmail: email,
          })

          if (!response.ok) {
            throw new Error(response.error?.message ?? 'Failed to remove collaborator')
          }
        }

        setOpenAssignmentDropdownContractId(contractId)
      } catch (assignmentError) {
        setContracts((current) =>
          current.map((contract) =>
            contract.id === contractId
              ? { ...contract, assignedToUsers: Array.from(new Set([currentAssigneeEmail, ...previousEmails])) }
              : contract
          )
        )
        setAssignmentErrorByContractId((current) => ({
          ...current,
          [contractId]: assignmentError instanceof Error ? assignmentError.message : 'Failed to update assignment',
        }))
      } finally {
        setAssignmentSavingByContractId((current) => ({ ...current, [contractId]: false }))
      }
    },
    [assignmentSavingByContractId, contracts, isLegalTeamRole, resolveContractCollaboratorEmails]
  )

  const handleOpenContractInNewTab = useCallback((contractId: string) => {
    const url = contractsClient.resolveProtectedContractPath(contractId, { from: 'repository' })
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const columns = useMemo<ColumnDef<ContractRecord>[]>(
    () => [
      {
        accessorKey: 'requestDate',
        header: 'Request Date',
        cell: ({ row }) => {
          const requestDate = row.original.requestCreatedAt ?? row.original.createdAt
          return requestDate ? timestampFormatter.format(new Date(requestDate)) : '—'
        },
      },
      {
        accessorKey: 'creator',
        header: 'Creator',
        cell: ({ row }) => row.original.creatorName?.trim() || row.original.uploadedByEmail?.trim() || '—',
      },
      {
        accessorKey: 'department',
        enableSorting: false,
        header: () => (
          <div className={styles.filterHeader} data-repository-header-filter>
            <button
              type="button"
              className={`${styles.filterHeaderTrigger} ${departmentFilters.length > 0 ? styles.filterHeaderTriggerActive : ''}`}
              onClick={() => setOpenHeaderFilter((current) => (current === 'department' ? null : 'department'))}
            >
              <span>Department</span>
              {departmentFilters.length > 0 ? (
                <span className={styles.filterActiveCount}>{departmentFilters.length}</span>
              ) : null}
              <span className={styles.filterHeaderCaret}>{openHeaderFilter === 'department' ? '▴' : '▾'}</span>
            </button>
            {openHeaderFilter === 'department' ? (
              <div className={styles.filterHeaderDropdown}>
                <button
                  type="button"
                  className={`${styles.filterHeaderOption} ${departmentFilters.length === 0 ? styles.filterHeaderOptionSelected : ''}`}
                  onClick={() => {
                    setDepartmentFilters([])
                    setOpenHeaderFilter(null)
                  }}
                >
                  <span>All departments</span>
                  {departmentFilters.length === 0 ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                </button>
                {departments.length === 0 ? (
                  <div className={styles.filterHeaderEmpty}>No departments available</div>
                ) : (
                  departments.map((dept) => {
                    const isSelected = departmentFilters.includes(dept.id)
                    return (
                      <button
                        key={dept.id}
                        type="button"
                        className={`${styles.filterHeaderOption} ${isSelected ? styles.filterHeaderOptionSelected : ''}`}
                        onClick={() => {
                          setDepartmentFilters((current) =>
                            isSelected ? current.filter((id) => id !== dept.id) : [...current, dept.id]
                          )
                        }}
                      >
                        <span>{dept.name}</span>
                        {isSelected ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                      </button>
                    )
                  })
                )}
              </div>
            ) : null}
          </div>
        ),
        cell: ({ row }) => row.original.departmentName ?? '—',
      },
      {
        accessorKey: 'createdAt',
        header: 'Contract',
        cell: ({ row }) => (
          <button
            type="button"
            className={styles.contractTitleAction}
            // stopPropagation keeps the row's "open request in a new tab" handler from firing:
            // the title opens the document preview instead.
            onClick={(event) => {
              event.stopPropagation()
              if (event.ctrlKey || event.metaKey) {
                handleOpenContractInNewTab(row.original.id)
              } else {
                void handleOpenCurrentDocument(row.original)
              }
            }}
            title={row.original.title}
          >
            <span className={styles.contractTitleClamp}>{row.original.title}</span>
          </button>
        ),
      },
      {
        accessorKey: 'budgetApproved',
        enableSorting: false,
        header: () => (
          <div className={styles.filterHeader} data-repository-header-filter>
            <button
              type="button"
              className={`${styles.filterHeaderTrigger} ${founderApprovalFilter ? styles.filterHeaderTriggerActive : ''}`}
              onClick={() =>
                setOpenHeaderFilter((current) => (current === 'founderApproval' ? null : 'founderApproval'))
              }
            >
              <span>Founder Approval</span>
              {founderApprovalFilter ? <span className={styles.filterActiveDot} /> : null}
              <span className={styles.filterHeaderCaret}>{openHeaderFilter === 'founderApproval' ? '▴' : '▾'}</span>
            </button>
            {openHeaderFilter === 'founderApproval' ? (
              <div className={styles.filterHeaderDropdown}>
                <button
                  type="button"
                  className={`${styles.filterHeaderOption} ${!founderApprovalFilter ? styles.filterHeaderOptionSelected : ''}`}
                  onClick={() => {
                    setFounderApprovalFilter('')
                    setOpenHeaderFilter(null)
                  }}
                >
                  <span>All</span>
                  {!founderApprovalFilter ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                </button>
                <button
                  type="button"
                  className={`${styles.filterHeaderOption} ${founderApprovalFilter === 'yes' ? styles.filterHeaderOptionSelected : ''}`}
                  onClick={() => {
                    setFounderApprovalFilter('yes')
                    setOpenHeaderFilter(null)
                  }}
                >
                  <span>Yes</span>
                  {founderApprovalFilter === 'yes' ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                </button>
                <button
                  type="button"
                  className={`${styles.filterHeaderOption} ${founderApprovalFilter === 'no' ? styles.filterHeaderOptionSelected : ''}`}
                  onClick={() => {
                    setFounderApprovalFilter('no')
                    setOpenHeaderFilter(null)
                  }}
                >
                  <span>No</span>
                  {founderApprovalFilter === 'no' ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                </button>
              </div>
            ) : null}
          </div>
        ),
        cell: ({ row }) =>
          typeof row.original.budgetApproved === 'boolean' ? (row.original.budgetApproved ? 'Yes' : 'No') : '—',
      },
      {
        accessorKey: 'hodApprovedAt',
        enableSorting: false,
        header: () => (
          <div className={styles.filterHeader} data-repository-header-filter>
            <button
              type="button"
              className={`${styles.filterHeaderTrigger} ${hodApprovalFilter ? styles.filterHeaderTriggerActive : ''}`}
              onClick={() => setOpenHeaderFilter((current) => (current === 'hodApproval' ? null : 'hodApproval'))}
            >
              <span>HOD Approval</span>
              {hodApprovalFilter ? <span className={styles.filterActiveDot} /> : null}
              <span className={styles.filterHeaderCaret}>{openHeaderFilter === 'hodApproval' ? '▴' : '▾'}</span>
            </button>
            {openHeaderFilter === 'hodApproval' ? (
              <div className={styles.filterHeaderDropdown}>
                <button
                  type="button"
                  className={`${styles.filterHeaderOption} ${!hodApprovalFilter ? styles.filterHeaderOptionSelected : ''}`}
                  onClick={() => {
                    setHodApprovalFilter('')
                    setOpenHeaderFilter(null)
                  }}
                >
                  <span>All</span>
                  {!hodApprovalFilter ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                </button>
                <button
                  type="button"
                  className={`${styles.filterHeaderOption} ${hodApprovalFilter === 'yes' ? styles.filterHeaderOptionSelected : ''}`}
                  onClick={() => {
                    setHodApprovalFilter('yes')
                    setOpenHeaderFilter(null)
                  }}
                >
                  <span>Yes</span>
                  {hodApprovalFilter === 'yes' ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                </button>
                <button
                  type="button"
                  className={`${styles.filterHeaderOption} ${hodApprovalFilter === 'no' ? styles.filterHeaderOptionSelected : ''}`}
                  onClick={() => {
                    setHodApprovalFilter('no')
                    setOpenHeaderFilter(null)
                  }}
                >
                  <span>No</span>
                  {hodApprovalFilter === 'no' ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                </button>
              </div>
            ) : null}
          </div>
        ),
        cell: ({ row }) =>
          row.original.hodApprovedAt ? (
            <div className={styles.hodApprovalWrap}>
              <span className={styles.hodApproved}>Yes</span>
              <span className={styles.muted}>{timestampFormatter.format(new Date(row.original.hodApprovedAt))}</span>
            </div>
          ) : (
            <span className={styles.hodPending}>No</span>
          ),
      },
      ...(canSeeTatAndAging
        ? ([
            {
              accessorKey: 'tatPolicy',
              header: 'TAT',
              cell: () => agingPolicyText,
            },
            {
              accessorKey: 'contractAging',
              header: 'Contract Aging',
              cell: ({ row }: { row: { original: ContractRecord } }) => {
                const tone = getAgingTone(row.original.agingBusinessDays)
                const overdueLabel = formatOverdueLabel(row.original)

                return (
                  <div className={styles.agingWrap}>
                    <span className={styles[`agingTone${tone.charAt(0).toUpperCase()}${tone.slice(1)}`]}>
                      {typeof row.original.agingBusinessDays === 'number'
                        ? `${row.original.agingBusinessDays} days`
                        : '—'}
                    </span>
                    {overdueLabel ? <span className={styles.overdueLabel}>{overdueLabel}</span> : null}
                  </div>
                )
              },
            },
          ] as ColumnDef<ContractRecord>[])
        : []),
      {
        accessorKey: 'status',
        enableSorting: false,
        header: () => (
          <div className={styles.filterHeader} data-repository-header-filter>
            <button
              type="button"
              className={`${styles.filterHeaderTrigger} ${statusFilters.length > 0 ? styles.filterHeaderTriggerActive : ''}`}
              onClick={() => setOpenHeaderFilter((current) => (current === 'statusColumn' ? null : 'statusColumn'))}
            >
              <span>Status</span>
              {statusFilters.length > 0 ? (
                <span className={styles.filterActiveCount}>{statusFilters.length}</span>
              ) : null}
              <span className={styles.filterHeaderCaret}>{openHeaderFilter === 'statusColumn' ? '▴' : '▾'}</span>
            </button>
            {openHeaderFilter === 'statusColumn' ? (
              <div className={styles.filterHeaderDropdown}>
                <button
                  type="button"
                  className={`${styles.filterHeaderOption} ${statusFilters.length === 0 ? styles.filterHeaderOptionSelected : ''}`}
                  onClick={() => {
                    setStatusFilters([])
                    setOpenHeaderFilter(null)
                  }}
                >
                  <span>All statuses</span>
                  {statusFilters.length === 0 ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                </button>
                {Object.entries(contractRepositoryStatusLabels).map(([value, label]) => {
                  const isSelected = statusFilters.includes(value as RepositoryStatusFilter)
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`${styles.filterHeaderOption} ${isSelected ? styles.filterHeaderOptionSelected : ''}`}
                      onClick={() => toggleStatusFilter(value as RepositoryStatusFilter)}
                    >
                      <span>{label}</span>
                      {isSelected ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        ),
        cell: ({ row }) => {
          const daysInStatus = getDaysInStatus(row.original.updatedAt)
          const shouldShowStuckBadge = stuckStateStatuses.has(row.original.status) && typeof daysInStatus === 'number'
          const stuckTone = typeof daysInStatus === 'number' ? getStuckTone(daysInStatus) : 'green'

          return (
            <div className={styles.statusWrap}>
              <ContractStatusBadge
                status={row.original.status}
                displayLabel={row.original.repositoryStatusLabel ?? row.original.displayStatusLabel}
              />
              {shouldShowStuckBadge && canSeeTatAndAging ? (
                <span className={styles[`stuckTone${stuckTone.charAt(0).toUpperCase()}${stuckTone.slice(1)}`]}>
                  {daysInStatus} day{daysInStatus === 1 ? '' : 's'} in status
                </span>
              ) : null}
              {row.original.status === 'VOID' && row.original.voidReason ? (
                <span className={styles.voidReason}>Void: {row.original.voidReason}</span>
              ) : null}
            </div>
          )
        },
      },
      {
        accessorKey: 'assignedTo',
        enableSorting: false,
        header: () =>
          isLegalTeamRole ? (
            <div className={styles.filterHeader} data-repository-header-filter>
              <button
                type="button"
                className={`${styles.filterHeaderTrigger} ${assignedToFilters.length > 0 ? styles.filterHeaderTriggerActive : ''}`}
                onClick={() => setOpenHeaderFilter((current) => (current === 'assignedTo' ? null : 'assignedTo'))}
              >
                <span>Assigned To</span>
                {assignedToFilters.length > 0 ? (
                  <span className={styles.filterActiveCount}>{assignedToFilters.length}</span>
                ) : null}
                <span className={styles.filterHeaderCaret}>{openHeaderFilter === 'assignedTo' ? '▴' : '▾'}</span>
              </button>
              {openHeaderFilter === 'assignedTo' ? (
                <div className={styles.filterHeaderDropdown}>
                  <button
                    type="button"
                    className={`${styles.filterHeaderOption} ${assignedToFilters.length === 0 ? styles.filterHeaderOptionSelected : ''}`}
                    onClick={() => {
                      setAssignedToFilters([])
                      setOpenHeaderFilter(null)
                    }}
                  >
                    <span>All assignees</span>
                    {assignedToFilters.length === 0 ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                  </button>
                  {legalTeamMembers.length === 0 ? (
                    <div className={styles.filterHeaderEmpty}>No legal team members</div>
                  ) : (
                    legalTeamMembers.map((member) => {
                      const memberEmail = member.email.toLowerCase()
                      const isSelected = assignedToFilters.includes(memberEmail)
                      const memberDisplayName = member.fullName?.trim() || toFallbackDisplayName(member.email)

                      return (
                        <button
                          key={member.id}
                          type="button"
                          className={`${styles.filterHeaderOption} ${isSelected ? styles.filterHeaderOptionSelected : ''}`}
                          onClick={() => {
                            setAssignedToFilters((current) =>
                              isSelected ? current.filter((e) => e !== memberEmail) : [...current, memberEmail]
                            )
                          }}
                        >
                          <span>{memberDisplayName}</span>
                          {isSelected ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                        </button>
                      )
                    })
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <>Assigned To</>
          ),
        cell: ({ row }) => {
          if (isLegalTeamRole) {
            const selectedEmails = resolveContractCollaboratorEmails(row.original)
            const selectedDisplayNames = resolveContractAssignedEmails(row.original).map((email) =>
              resolveEmailDisplayName(email)
            )
            const isSaving = Boolean(assignmentSavingByContractId[row.original.id])
            const assignmentError = assignmentErrorByContractId[row.original.id]
            const isDropdownOpen = openAssignmentDropdownContractId === row.original.id
            const triggerLabel = selectedDisplayNames.length > 0 ? selectedDisplayNames.join(', ') : 'Assign Contract'

            return (
              <div
                className={styles.assignedToEditor}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className={styles.assignedToTrigger}
                  disabled={isSaving || legalTeamMembers.length === 0}
                  onClick={() =>
                    setOpenAssignmentDropdownContractId((current) =>
                      current === row.original.id ? null : row.original.id
                    )
                  }
                  title={triggerLabel}
                >
                  <span className={styles.assignedToTriggerLabel}>{triggerLabel}</span>
                  <span className={styles.assignedToTriggerCaret}>{isDropdownOpen ? '▴' : '▾'}</span>
                </button>
                {isDropdownOpen ? (
                  <div className={styles.assignedToDropdown}>
                    {selectedEmails.length > 0 ? (
                      <button
                        type="button"
                        className={styles.assignedToClearAll}
                        disabled={isSaving}
                        onClick={() => {
                          void handleContractAssignmentChange(row.original.id, [])
                        }}
                      >
                        Clear all
                      </button>
                    ) : null}
                    {legalTeamMembers.map((member) => {
                      const memberEmail = member.email.toLowerCase()
                      const isSelected = selectedEmails.includes(memberEmail)
                      const memberDisplayName = member.fullName?.trim() || toFallbackDisplayName(member.email)

                      return (
                        <button
                          key={member.id}
                          type="button"
                          className={`${styles.assignedToOption} ${isSelected ? styles.assignedToOptionSelected : ''}`}
                          disabled={isSaving}
                          onClick={() => {
                            const nextSelected = isSelected
                              ? selectedEmails.filter((email) => email !== memberEmail)
                              : [...selectedEmails, memberEmail]
                            void handleContractAssignmentChange(row.original.id, nextSelected)
                          }}
                        >
                          <span>{memberDisplayName}</span>
                          {isSelected ? <span className={styles.assignedToOptionCheck}>✓</span> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
                {legalTeamMembersError ? <span className={styles.assignmentError}>{legalTeamMembersError}</span> : null}
                {assignmentError ? <span className={styles.assignmentError}>{assignmentError}</span> : null}
                {isSaving ? <span className={styles.assignmentSaving}>Saving…</span> : null}
              </div>
            )
          }

          const display = resolveAssignedToDisplay(row.original)

          return (
            <div className={styles.assignedToWrap} title={display.fullAssignees}>
              <span className={styles.assignedToPrimary}>{display.visibleAssignees}</span>
              {display.hiddenCount > 0 ? (
                <span className={styles.assignedToMore}>+{display.hiddenCount} more</span>
              ) : null}
            </div>
          )
        },
      },
      {
        accessorKey: 'executedAt',
        header: 'Executed Date & Time',
        cell: ({ row }) =>
          row.original.executedAt ? timestampFormatter.format(new Date(row.original.executedAt)) : '—',
      },
      ...(isLegalTeamRole
        ? [
            {
              accessorKey: 'legalEffectiveDate',
              header: () => <span className={styles.legalMetadataHeader}>Effective Date</span>,
              cell: ({ row }: { row: { original: ContractRecord } }) => (
                <span className={styles.legalMetadataValue}>{formatLegalDate(row.original.legalEffectiveDate)}</span>
              ),
            },
            {
              accessorKey: 'legalTerminationDate',
              header: () => <span className={styles.legalMetadataHeader}>Termination Date</span>,
              cell: ({ row }: { row: { original: ContractRecord } }) => (
                <span className={styles.legalMetadataValue}>{formatLegalDate(row.original.legalTerminationDate)}</span>
              ),
            },
            {
              accessorKey: 'legalNoticePeriod',
              header: () => <span className={styles.legalMetadataHeader}>Notice Period</span>,
              cell: ({ row }: { row: { original: ContractRecord } }) => {
                const value = row.original.legalNoticePeriod?.trim()
                return <span className={styles.legalMetadataValue}>{value && value.length > 0 ? value : '-'}</span>
              },
            },
            {
              accessorKey: 'legalAutoRenewal',
              header: () => <span className={styles.legalMetadataHeader}>Auto-renewal</span>,
              cell: ({ row }: { row: { original: ContractRecord } }) => (
                <span className={styles.legalMetadataValue}>
                  {row.original.legalAutoRenewal === true
                    ? 'Yes'
                    : row.original.legalAutoRenewal === false
                      ? 'No'
                      : '-'}
                </span>
              ),
            },
          ]
        : []),
    ],
    [
      assignmentErrorByContractId,
      assignmentSavingByContractId,
      handleContractAssignmentChange,
      handleOpenContractInNewTab,
      handleOpenCurrentDocument,
      isLegalTeamRole,
      canSeeTatAndAging,
      legalTeamMembers,
      legalTeamMembersError,
      openAssignmentDropdownContractId,
      resolveContractAssignedEmails,
      resolveContractCollaboratorEmails,
      resolveEmailDisplayName,
      departments,
      departmentFilters,
      hodApprovalFilter,
      founderApprovalFilter,
      statusFilters,
      toggleStatusFilter,
      assignedToFilters,
      openHeaderFilter,
    ]
  )

  const toggleExportColumn = useCallback((column: RepositoryExportColumn) => {
    setSelectedExportColumns((previous) => {
      if (previous.includes(column)) {
        return previous.filter((entry) => entry !== column)
      }

      return [...previous, column]
    })
  }, [])

  const downloadExport = useCallback(
    (format: 'csv' | 'excel' | 'pdf') => {
      const exportUrl = contractsClient.repositoryExportUrl({
        search: debouncedSearch,
        repositoryStatuses: statusFilters.length > 0 ? statusFilters : undefined,
        dateBasis,
        datePreset: datePreset || undefined,
        fromDate: datePreset === 'custom' && customFromDate ? customFromDate : undefined,
        toDate: datePreset === 'custom' && customToDate ? customToDate : undefined,
        departmentIds: departmentFilters.length > 0 ? departmentFilters : undefined,
        hodApproval: hodApprovalFilter || undefined,
        founderApproval: founderApprovalFilter || undefined,
        assignedToEmails: assignedToFilters.length > 0 ? assignedToFilters : undefined,
        format,
        columns: selectedExportColumns,
      })

      window.open(exportUrl, '_blank', 'noopener,noreferrer')
      setActiveExportFormat(null)
    },
    [
      customFromDate,
      customToDate,
      dateBasis,
      datePreset,
      debouncedSearch,
      selectedExportColumns,
      statusFilters,
      departmentFilters,
      hodApprovalFilter,
      founderApprovalFilter,
      assignedToFilters,
    ]
  )

  const handleSortingChange = useCallback(
    (updater: SortingState | ((current: SortingState) => SortingState)) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      setSorting(next)
    },
    [sorting]
  )

  const handlePreviousPage = useCallback(() => {
    setPage((current) => Math.max(1, current - 1))
  }, [])

  const handleNextPage = useCallback(() => {
    setPage((current) => (current < totalPages ? current + 1 : current))
  }, [totalPages])

  return (
    <ProtectedAppShell
      session={{ fullName: session.fullName, email: session.email, team: session.team, role: session.role }}
      activeNav="repository"
      canAccessApproverHistory={session.canAccessApproverHistory}
      quickAction={
        normalizedRole === 'HOD'
          ? {
              ariaLabel: 'Upload third-party contract',
              onClick: () => setIsUploadOpen(true),
              isActive: isUploadOpen,
            }
          : undefined
      }
    >
      <main className={styles.main}>
        <ErrorBoundary sectionLabel="contract repository">
          <section className={styles.header}>
            <div>
              <h1 className={styles.title}>Repository</h1>
              <p className={styles.subtitle}>Search and browse all accessible contracts</p>
            </div>
            <div className={styles.controls}>
              <input
                className={styles.searchInput}
                placeholder="Search by contract name"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                }}
              />
              <div className={styles.filterHeader} data-repository-header-filter>
                <button
                  type="button"
                  className={`${styles.statusFilterTrigger} ${statusFilters.length > 0 ? styles.filterHeaderTriggerActive : ''}`}
                  onClick={() => setOpenHeaderFilter((current) => (current === 'status' ? null : 'status'))}
                >
                  <span>{statusFilters.length > 0 ? `Status (${statusFilters.length})` : 'All statuses'}</span>
                  <span className={styles.filterHeaderCaret}>{openHeaderFilter === 'status' ? '▴' : '▾'}</span>
                </button>
                {openHeaderFilter === 'status' ? (
                  <div className={styles.filterHeaderDropdown}>
                    <button
                      type="button"
                      className={`${styles.filterHeaderOption} ${statusFilters.length === 0 ? styles.filterHeaderOptionSelected : ''}`}
                      onClick={() => {
                        setStatusFilters([])
                        setOpenHeaderFilter(null)
                      }}
                    >
                      <span>All statuses</span>
                      {statusFilters.length === 0 ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                    </button>
                    {Object.entries(contractRepositoryStatusLabels).map(([value, label]) => {
                      const isSelected = statusFilters.includes(value as RepositoryStatusFilter)
                      return (
                        <button
                          key={value}
                          type="button"
                          className={`${styles.filterHeaderOption} ${isSelected ? styles.filterHeaderOptionSelected : ''}`}
                          onClick={() => toggleStatusFilter(value as RepositoryStatusFilter)}
                        >
                          <span>{label}</span>
                          {isSelected ? <span className={styles.filterHeaderOptionCheck}>✓</span> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
              <select
                className={styles.statusSelect}
                value={dateBasis}
                onChange={(event) => handleDateBasisChange(event.target.value as RepositoryDateBasis)}
              >
                {repositoryDateBasisOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className={styles.statusSelect}
                value={datePreset}
                onChange={(event) => handleDatePresetChange(event.target.value as RepositoryDatePreset | '')}
              >
                <option value="">All time</option>
                {repositoryDatePresetOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {datePreset === 'custom' ? (
                <>
                  <input
                    type="date"
                    className={styles.searchInput}
                    value={customFromDate}
                    onChange={(event) => setCustomFromDate(event.target.value)}
                  />
                  <input
                    type="date"
                    className={styles.searchInput}
                    value={customToDate}
                    onChange={(event) => setCustomToDate(event.target.value)}
                  />
                </>
              ) : null}
            </div>
          </section>

          {canAccessRepositoryReporting ? (
            <section className={styles.reportingSection}>
              <div className={styles.reportingHeader}>
                <h2 className={styles.reportingTitle}>Repository Reporting</h2>
                <div className={styles.exportActions}>
                  <button type="button" className={styles.pageButton} onClick={() => setActiveExportFormat('csv')}>
                    Export CSV
                  </button>
                  <button type="button" className={styles.pageButton} onClick={() => setActiveExportFormat('excel')}>
                    Export Excel
                  </button>
                </div>
              </div>
              {activeExportFormat ? (
                <div className={styles.exportConfigurator}>
                  <div className={styles.exportConfiguratorHeader}>
                    <div>
                      <h3 className={styles.exportConfiguratorTitle}>
                        Choose columns for {activeExportFormat === 'csv' ? 'CSV' : 'Excel'} export
                      </h3>
                      <p className={styles.exportConfiguratorHint}>
                        Select the fields you want to include in the file.
                      </p>
                    </div>
                    <div className={styles.exportConfiguratorActions}>
                      <button type="button" className={styles.pageButton} onClick={() => setActiveExportFormat(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={`${styles.pageButton} ${styles.primaryButton}`}
                        onClick={() => downloadExport(activeExportFormat)}
                      >
                        Download {activeExportFormat === 'csv' ? 'CSV' : 'Excel'}
                      </button>
                    </div>
                  </div>

                  <div className={styles.exportColumnsGrid}>
                    {defaultExportColumns.map((column) => (
                      <label key={column} className={styles.exportColumnItem}>
                        <input
                          type="checkbox"
                          checked={selectedExportColumns.includes(column)}
                          onChange={() => toggleExportColumn(column)}
                        />
                        <span>{contractRepositoryExportColumnLabels[column]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {isReportLoading ? (
                <div className={styles.empty}>Loading report...</div>
              ) : reportMetrics ? (
                <div className={styles.reportingGrid}>
                  <div className={styles.metricCard}>
                    <h3 className={styles.metricTitle}>Department-wise Reporting</h3>
                    {reportMetrics.departmentMetrics.length === 0 ? (
                      <p className={styles.muted}>No department metrics available.</p>
                    ) : (
                      <ul className={`${styles.metricList} ${styles.metricListScrollable}`}>
                        {reportMetrics.departmentMetrics.map((metric) => (
                          <li key={metric.departmentId ?? 'unassigned'} className={styles.metricListItem}>
                            <span className={styles.metricName}>{metric.departmentName ?? 'Unassigned'}</span>
                            <span className={styles.metricMeta}>
                              Total {metric.totalRequestsReceived} · Approved {metric.approved} · Rejected{' '}
                              {metric.rejected} · Completed {metric.completed} · Pending {metric.pending}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className={styles.metricCard}>
                    <h3 className={styles.metricTitle}>Status-wise Reporting</h3>
                    {reportMetrics.statusMetrics.length === 0 ? (
                      <p className={styles.muted}>No status metrics available.</p>
                    ) : (
                      <ul className={styles.metricList}>
                        {reportMetrics.statusMetrics.map((metric) => (
                          <li key={metric.key} className={styles.metricListItem}>
                            <span className={styles.metricName}>{metric.label}</span>
                            <span className={styles.metricValue}>{metric.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className={styles.pagination}>
            <button type="button" className={styles.pageButton} disabled={page <= 1} onClick={handlePreviousPage}>
              ← Previous
            </button>
            <span className={styles.paginationInfo}>
              Page {page} of {totalPages} · {totalCount} total
            </span>
            <label className={styles.rowsPerPageLabel}>
              Rows
              <select
                className={styles.rowsPerPageSelect}
                value={rowsPerPage}
                onChange={(event) => setRowsPerPage(Number(event.target.value))}
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
            <button type="button" className={styles.pageButton} disabled={page >= totalPages} onClick={handleNextPage}>
              Next →
            </button>
          </section>

          <section
            ref={tableWrapRef}
            className={styles.tableWrap}
            onMouseMove={handleTableWrapMouseMove}
            onMouseLeave={stopTableAutoScroll}
          >
            <RepositoryWorkspaceTable
              contracts={contracts}
              columns={columns}
              sorting={sorting}
              onSortingChange={handleSortingChange}
              isLoading={isLoading}
              onOpenContractInNewTab={handleOpenContractInNewTab}
              canSeeTatAndAging={canSeeTatAndAging}
              suppressRowPreview={openAssignmentDropdownContractId !== null}
              resolveTatLabel={formatTatSummary}
            />
          </section>

          {activePreview ? (
            <div
              className={styles.viewerOverlay}
              role="dialog"
              aria-modal="true"
              aria-label="Contract document preview"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closePreview()
                }
              }}
            >
              <div className={styles.viewerModal}>
                <div className={styles.viewerHeader}>
                  <div className={styles.viewerTitle}>{activePreview.fileName}</div>
                  <button type="button" className={styles.pageButton} onClick={closePreview}>
                    Close
                  </button>
                </div>
                <div className={styles.viewerBody}>
                  {activePreview.isDocx ? (
                    <DocxPreview url={activePreview.url} className={styles.viewerFrame} />
                  ) : activePreview.fileMimeType.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={activePreview.url} alt={activePreview.fileName} className={styles.viewerFrame} />
                  ) : (
                    <iframe src={activePreview.url} title={activePreview.fileName} className={styles.viewerFrame} />
                  )}
                </div>
                <div className={styles.viewerFooter}>
                  <span className={styles.muted}>If preview is not available, open in a new tab.</span>
                  <button
                    type="button"
                    className={`${styles.pageButton} ${styles.primaryButton}`}
                    onClick={() => window.open(activePreview.externalUrl, '_blank', 'noopener,noreferrer')}
                  >
                    Open in New Tab
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <ThirdPartyUploadSidebar
            isOpen={isUploadOpen}
            mode={contractUploadModes.default}
            actorRole={session.role ?? undefined}
            onClose={() => setIsUploadOpen(false)}
            onUploaded={async () => {
              await loadContractsAndReport()
              router.refresh()
            }}
          />
        </ErrorBoundary>
      </main>
    </ProtectedAppShell>
  )
}
