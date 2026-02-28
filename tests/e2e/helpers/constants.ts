/**
 * E2E Test Constants — NxtLegal
 *
 * Centralized test data. All magic strings live here.
 * Mirrors src/core/constants/ values but kept separate so
 * application code is never imported into Playwright.
 */

// ─── Test Users (seeded via `npm run seed:test-employee`) ────────────────────

export const TEST_USERS = {
  /** POC role — can upload contracts */
  poc: {
    email: 'poc@nxtwave.co.in',
    password: 'Password@123',
    fullName: 'Finance POC',
    role: 'POC',
    team: 'Finance',
  },
  /** HOD role — can approve/reject contracts */
  hod: {
    email: 'hod@nxtwave.co.in',
    password: 'Password@123',
    fullName: 'Finance HOD',
    role: 'HOD',
    team: 'Finance',
  },
  /** Legal team member */
  legal: {
    email: 'legalteam@nxtwave.co.in',
    password: 'Password@123',
    fullName: 'Legal Team',
    role: 'LEGAL_TEAM',
    team: '',
  },
  /** Admin user */
  admin: {
    email: 'admin@nxtwave.co.in',
    password: 'Password@123',
    fullName: 'System Admin',
    role: 'ADMIN',
    team: '',
  },
} as const

export type TestUserKey = keyof typeof TEST_USERS

// ─── Cookie Names (mirrors src/core/constants/cookies.ts) ────────────────────

export const COOKIE_NAMES = {
  session: 'employee_session',
  refresh: 'employee_refresh_token',
} as const

// ─── Contract Statuses ───────────────────────────────────────────────────────

export const CONTRACT_STATUS_LABELS = {
  draft: 'Draft',
  uploaded: 'Uploaded',
  hodPending: 'HOD Pending',
  underReview: 'Under Review',
  pendingInternal: 'Pending with Internal Stakeholders',
  pendingExternal: 'Pending with External Stakeholders',
  offlineExecution: 'Offline Execution',
  onHold: 'On Hold',
  completed: 'Completed',
  executed: 'Executed',
  void: 'Voided',
  rejected: 'Rejected',
} as const

// ─── Action Labels (mirrors actionLabelMap) ──────────────────────────────────

export const ACTION_LABELS = {
  hodApprove: 'Approve (HOD)',
  hodReject: 'Reject (HOD)',
  hodBypass: 'Bypass to Legal',
  legalUnderReview: 'Set Under Review',
  legalPendingInternal: 'Set Pending Internal',
  legalPendingExternal: 'Set Pending External',
  legalOfflineExecution: 'Set Offline Execution',
  legalOnHold: 'Set On Hold',
  legalCompleted: 'Set Completed',
  legalVoid: 'Void Documents',
  legalApprove: 'Final Approve',
  legalReject: 'Reject (Legal)',
  legalQuery: 'Mark Query',
  legalQueryReroute: 'Reroute to HOD',
  approverApprove: 'Approve as Additional Approver',
  approverReject: 'Reject as Additional Approver',
} as const

// ─── Routes ──────────────────────────────────────────────────────────────────

export const ROUTES = {
  login: '/login',
  dashboard: '/dashboard',
  repository: '/repository',
  admin: '/admin',
  contract: (id: string) => `/contracts/${id}`,
} as const

// ─── API Endpoints ───────────────────────────────────────────────────────────

export const API = {
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  session: '/api/auth/session',
  contractUpload: '/api/contracts/upload',
  contractList: '/api/contracts',
  contractDetail: (id: string) => `/api/contracts/${id}`,
  contractAction: (id: string) => `/api/contracts/${id}/action`,
  contractTimeline: (id: string) => `/api/contracts/${id}/timeline`,
} as const

// ─── Test Data Prefixes ──────────────────────────────────────────────────────

/** Prefix used in test contract names for easy identification and cleanup */
export const TEST_DATA_PREFIX = '[E2E-AUTO]'

/** Generate a unique test contract signatory name */
export function testSignatoryName(): string {
  const ts = Date.now().toString(36)
  return `${TEST_DATA_PREFIX} Test Signatory ${ts}`
}

/** Generate a unique counterparty name */
export function testCounterpartyName(): string {
  const ts = Date.now().toString(36)
  return `${TEST_DATA_PREFIX} Counterparty ${ts}`
}
