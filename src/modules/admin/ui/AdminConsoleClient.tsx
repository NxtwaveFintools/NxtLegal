'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  adminClient,
  type AdminDepartmentOption,
  type AdminDepartmentUserGroup,
  type AdminUserOption,
} from '@/core/client/admin-client'
import ProtectedAppShell from '@/modules/dashboard/ui/ProtectedAppShell'
import styles from './admin-console.module.css'

type AdminConsoleClientProps = {
  session: {
    employeeId: string
    fullName?: string | null
    email?: string | null
    team?: string | null
    role?: string | null
    canAccessApproverHistory?: boolean
  }
}

type AdminConfirmationIntent =
  | { kind: 'replace-primary-role' }
  | { kind: 'deactivate-user' }
  | { kind: 'assign-department-role' }
  | { kind: 'add-legal-matrix' }

const sectionTitles = [
  'Team Management',
  'User Management',
  'Role Management',
  'HOD & POC Assignment Control',
  'Legal Team Assignment Matrix',
  'System Configuration',
  'Audit Logs Viewer',
] as const

const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export default function AdminConsoleClient({ session }: AdminConsoleClientProps) {
  const [departments, setDepartments] = useState<AdminDepartmentOption[]>([])
  const [users, setUsers] = useState<AdminUserOption[]>([])
  const [usersByDepartment, setUsersByDepartment] = useState<AdminDepartmentUserGroup[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')

  const [teamName, setTeamName] = useState('')
  const [pocEmail, setPocEmail] = useState('')
  const [hodEmail, setHodEmail] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserFullName, setNewUserFullName] = useState('')
  const [assignmentDepartmentId, setAssignmentDepartmentId] = useState('')
  const [assignmentDepartmentRole, setAssignmentDepartmentRole] = useState<'POC' | 'HOD'>('POC')

  const [replaceRoleType, setReplaceRoleType] = useState<'POC' | 'HOD'>('POC')
  const [newRoleEmail, setNewRoleEmail] = useState('')

  const [reason, setReason] = useState('')
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [isSubmittingReplace, setIsSubmittingReplace] = useState(false)
  const [isSubmittingUserCreate, setIsSubmittingUserCreate] = useState(false)
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false)
  const [isSubmittingAssignment, setIsSubmittingAssignment] = useState(false)
  const [isSubmittingLegalMatrix, setIsSubmittingLegalMatrix] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [confirmationIntent, setConfirmationIntent] = useState<AdminConfirmationIntent | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        setToastMessage(null)
        const [departmentsResponse, usersResponse, usersByDepartmentResponse] = await Promise.all([
          adminClient.departments(),
          adminClient.users(),
          adminClient.usersByDepartment(),
        ])

        if (!departmentsResponse.ok || !departmentsResponse.data) {
          setDepartments([])
          setSelectedTeamId('')
          setAssignmentDepartmentId('')
          setToastMessage(departmentsResponse.error?.message ?? 'Failed to load departments')
        } else {
          const nextDepartments = departmentsResponse.data.departments
          setDepartments(nextDepartments)
          setSelectedTeamId((current) => {
            if (!current) {
              return nextDepartments[0]?.id || ''
            }

            return nextDepartments.some((department) => department.id === current)
              ? current
              : nextDepartments[0]?.id || ''
          })

          setAssignmentDepartmentId((current) => {
            if (!current) {
              return nextDepartments[0]?.id || ''
            }
            return nextDepartments.some((department) => department.id === current)
              ? current
              : nextDepartments[0]?.id || ''
          })
        }

        if (!usersResponse.ok || !usersResponse.data) {
          setUsers([])
          setSelectedUserId('')
        } else {
          const nextUsers = usersResponse.data.users
          setUsers(nextUsers)
          setSelectedUserId((current) => {
            if (!current) {
              return nextUsers[0]?.id || ''
            }
            return nextUsers.some((user) => user.id === current) ? current : nextUsers[0]?.id || ''
          })
        }

        if (!usersByDepartmentResponse.ok || !usersByDepartmentResponse.data) {
          setUsersByDepartment([])
        } else {
          setUsersByDepartment(usersByDepartmentResponse.data.departments)
        }
      } catch {
        setToastMessage('Failed to load admin team governance data')
      } finally {
        setIsLoading(false)
      }
    }

    void loadData()
  }, [])

  const selectedDepartment = useMemo(
    () => departments.find((department) => department.id === selectedTeamId) ?? null,
    [departments, selectedTeamId]
  )

  const normalizedPocEmail = pocEmail.trim().toLowerCase()
  const normalizedHodEmail = hodEmail.trim().toLowerCase()
  const normalizedNewRoleEmail = newRoleEmail.trim().toLowerCase()

  const isPocEmailValid = normalizedPocEmail.length > 0 && emailPattern.test(normalizedPocEmail)
  const isHodEmailValid = normalizedHodEmail.length > 0 && emailPattern.test(normalizedHodEmail)
  const arePrimaryEmailsDifferent =
    normalizedPocEmail !== '' && normalizedHodEmail !== '' && normalizedPocEmail !== normalizedHodEmail

  const isNewRoleEmailValid = normalizedNewRoleEmail.length > 0 && emailPattern.test(normalizedNewRoleEmail)
  const selectedOppositeRoleEmail =
    replaceRoleType === 'POC'
      ? (selectedDepartment?.hodEmail?.toLowerCase() ?? null)
      : (selectedDepartment?.pocEmail?.toLowerCase() ?? null)
  const isReplacementDifferentFromOtherRole =
    !selectedOppositeRoleEmail || selectedOppositeRoleEmail !== normalizedNewRoleEmail

  const canCreate =
    !isLoading &&
    !isSubmittingCreate &&
    teamName.trim().length >= 2 &&
    isPocEmailValid &&
    isHodEmailValid &&
    arePrimaryEmailsDifferent

  const canReplace =
    !isLoading &&
    !isSubmittingReplace &&
    Boolean(selectedDepartment) &&
    isNewRoleEmailValid &&
    isReplacementDifferentFromOtherRole

  const normalizedNewUserEmail = newUserEmail.trim().toLowerCase()
  const canCreateUser =
    !isLoading &&
    !isSubmittingUserCreate &&
    emailPattern.test(normalizedNewUserEmail) &&
    newUserFullName.trim().length >= 2

  const selectedUser = useMemo(() => users.find((user) => user.id === selectedUserId) ?? null, [users, selectedUserId])

  const canAssignDepartmentRole =
    !isLoading && !isSubmittingAssignment && Boolean(selectedUser) && assignmentDepartmentId.length > 0

  const canAssignLegalMatrix =
    !isLoading &&
    !isSubmittingLegalMatrix &&
    Boolean(selectedDepartment) &&
    Boolean(selectedUser) &&
    (selectedUser?.roles ?? []).includes('LEGAL_TEAM')

  const refreshAdminData = async () => {
    const [departmentsResponse, usersResponse, usersByDepartmentResponse] = await Promise.all([
      adminClient.departments(),
      adminClient.users(),
      adminClient.usersByDepartment(),
    ])

    if (!departmentsResponse.ok || !departmentsResponse.data) {
      setToastMessage(departmentsResponse.error?.message ?? 'Failed to load departments')
    } else {
      const refreshedDepartments = departmentsResponse.data.departments
      setDepartments(refreshedDepartments)
      setSelectedTeamId((current) => {
        if (!current) {
          return refreshedDepartments[0]?.id ?? ''
        }

        const stillExists = refreshedDepartments.some((department) => department.id === current)
        return stillExists ? current : (refreshedDepartments[0]?.id ?? '')
      })
    }

    if (!usersResponse.ok || !usersResponse.data) {
      setToastMessage(usersResponse.error?.message ?? 'Failed to load users')
    } else {
      const refreshedUsers = usersResponse.data.users
      setUsers(refreshedUsers)
      setSelectedUserId((current) => {
        if (!current) {
          return refreshedUsers[0]?.id ?? ''
        }
        return refreshedUsers.some((user) => user.id === current) ? current : (refreshedUsers[0]?.id ?? '')
      })
    }

    if (!usersByDepartmentResponse.ok || !usersByDepartmentResponse.data) {
      setUsersByDepartment([])
    } else {
      setUsersByDepartment(usersByDepartmentResponse.data.departments)
    }
  }

  const handleCreateTeam = async () => {
    if (!canCreate) {
      return
    }

    setIsSubmittingCreate(true)
    try {
      const response = await adminClient.createDepartment({
        name: teamName.trim(),
        pocEmail: normalizedPocEmail,
        hodEmail: normalizedHodEmail,
        reason: reason.trim() || undefined,
      })

      if (!response.ok || !response.data) {
        setToastMessage(response.error?.message ?? 'Department creation failed')
        return
      }

      setTeamName('')
      setPocEmail('')
      setHodEmail('')
      setReason('')
      await refreshAdminData()
      setToastMessage('Department created. Access will be granted on next Microsoft login for mapped emails.')
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  const handleReplaceRole = async () => {
    if (!selectedDepartment || !canReplace) {
      return
    }

    setIsSubmittingReplace(true)
    try {
      const response = await adminClient.assignPrimaryRole(selectedDepartment.id, {
        roleType: replaceRoleType,
        newEmail: normalizedNewRoleEmail,
        reason: reason.trim() || undefined,
      })

      if (!response.ok || !response.data) {
        setToastMessage(response.error?.message ?? 'Role replacement failed')
        return
      }

      setNewRoleEmail('')
      setReason('')
      await refreshAdminData()
      setToastMessage('Primary role mapping replaced. Old email access is revoked immediately.')
    } finally {
      setIsSubmittingReplace(false)
    }
  }

  const handleCreateUser = async () => {
    if (!canCreateUser) {
      return
    }

    setIsSubmittingUserCreate(true)
    try {
      const response = await adminClient.createUser({
        email: normalizedNewUserEmail,
        fullName: newUserFullName.trim(),
        role: 'LEGAL_TEAM',
        isActive: true,
      })

      if (!response.ok || !response.data) {
        setToastMessage(response.error?.message ?? 'User creation failed')
        return
      }

      setNewUserEmail('')
      setNewUserFullName('')
      await refreshAdminData()
      setToastMessage('User created with default development password: Password@123')
    } finally {
      setIsSubmittingUserCreate(false)
    }
  }

  const handleToggleUserStatus = async (isActive: boolean) => {
    if (!selectedUser) {
      return
    }

    setIsSubmittingStatus(true)
    try {
      const response = await adminClient.setUserStatus(selectedUser.id, { isActive })
      if (!response.ok || !response.data) {
        setToastMessage(response.error?.message ?? 'Failed to update user status')
        return
      }

      await refreshAdminData()
      setToastMessage(`User ${isActive ? 'activated' : 'deactivated'} successfully.`)
    } finally {
      setIsSubmittingStatus(false)
    }
  }

  const handleAssignUserDepartmentRole = async () => {
    if (!selectedUser || !canAssignDepartmentRole) {
      return
    }

    setIsSubmittingAssignment(true)
    try {
      const response = await adminClient.assignUserDepartmentRole(selectedUser.id, {
        departmentId: assignmentDepartmentId,
        departmentRole: assignmentDepartmentRole,
      })

      if (!response.ok || !response.data) {
        setToastMessage(response.error?.message ?? 'Failed to assign department role')
        return
      }

      await refreshAdminData()
      setToastMessage('Department role assigned successfully.')
    } finally {
      setIsSubmittingAssignment(false)
    }
  }

  const handleAddUserToLegalMatrix = async () => {
    if (!selectedDepartment || !selectedUser || !canAssignLegalMatrix) {
      return
    }

    setIsSubmittingLegalMatrix(true)
    try {
      const legalUserIds = Array.from(
        new Set([selectedUser.id, ...selectedDepartment.legalAssignments.map((assignment) => assignment.userId)])
      )

      const response = await adminClient.setLegalMatrix(selectedDepartment.id, {
        legalUserIds,
      })

      if (!response.ok || !response.data) {
        setToastMessage(response.error?.message ?? 'Failed to update legal assignment matrix')
        return
      }

      await refreshAdminData()
      setToastMessage('Legal user mapped successfully.')
    } finally {
      setIsSubmittingLegalMatrix(false)
    }
  }

  const openConfirmation = (intent: AdminConfirmationIntent) => {
    setConfirmationIntent(intent)
  }

  const closeConfirmation = () => {
    if (isSubmittingReplace || isSubmittingStatus || isSubmittingAssignment || isSubmittingLegalMatrix) {
      return
    }

    setConfirmationIntent(null)
  }

  const confirmationText = useMemo(() => {
    if (!confirmationIntent) {
      return null
    }

    if (confirmationIntent.kind === 'replace-primary-role') {
      return {
        title: 'Confirm Primary Role Replacement',
        body: `Replace ${replaceRoleType} for ${selectedDepartment?.name ?? 'selected department'} with ${normalizedNewRoleEmail}? Existing access for the previous user will be revoked.`,
        confirmLabel: 'Confirm Replace',
      }
    }

    if (confirmationIntent.kind === 'deactivate-user') {
      return {
        title: 'Confirm User Deactivation',
        body: `Deactivate ${selectedUser?.email ?? 'selected user'}? This will revoke active access until reactivated.`,
        confirmLabel: 'Confirm Deactivate',
      }
    }

    if (confirmationIntent.kind === 'assign-department-role') {
      const selectedAssignmentDepartment = departments.find((department) => department.id === assignmentDepartmentId)
      return {
        title: 'Confirm Department Role Assignment',
        body: `Assign ${assignmentDepartmentRole} role for ${selectedUser?.email ?? 'selected user'} in ${selectedAssignmentDepartment?.name ?? 'selected department'}?`,
        confirmLabel: 'Confirm Assign',
      }
    }

    return {
      title: 'Confirm Legal Matrix Update',
      body: `Add ${selectedUser?.email ?? 'selected user'} to legal assignment matrix for ${selectedDepartment?.name ?? 'selected department'}?`,
      confirmLabel: 'Confirm Update',
    }
  }, [
    assignmentDepartmentId,
    assignmentDepartmentRole,
    confirmationIntent,
    departments,
    normalizedNewRoleEmail,
    replaceRoleType,
    selectedDepartment,
    selectedUser,
  ])

  const handleConfirmAction = async () => {
    if (!confirmationIntent) {
      return
    }

    const intent = confirmationIntent
    setConfirmationIntent(null)

    if (intent.kind === 'replace-primary-role') {
      await handleReplaceRole()
      return
    }

    if (intent.kind === 'deactivate-user') {
      await handleToggleUserStatus(false)
      return
    }

    if (intent.kind === 'assign-department-role') {
      await handleAssignUserDepartmentRole()
      return
    }

    await handleAddUserToLegalMatrix()
  }

  return (
    <ProtectedAppShell
      session={{ fullName: session.fullName, email: session.email, team: session.team, role: session.role }}
      activeNav="admin"
      canAccessApproverHistory={session.canAccessApproverHistory}
    >
      <main className={styles.main}>
        <section className={styles.header}>
          <h1 className={styles.title}>Admin Console</h1>
          <p className={styles.subtitle}>
            Enterprise governance controls for roles, assignments, and integrity-safe access.
          </p>
        </section>

        <section className={styles.sections}>
          {sectionTitles.map((title) => (
            <div key={title} className={styles.sectionItem}>
              {title}
            </div>
          ))}
        </section>

        {toastMessage ? <div className={styles.toast}>{toastMessage}</div> : null}

        <section className={styles.workspace}>
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Team Management</h2>

            <label className={styles.field}>
              <span className={styles.label}>Team Name</span>
              <input
                className={styles.input}
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="Enter department/team name"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>POC Microsoft Email</span>
              <input
                className={styles.input}
                value={pocEmail}
                onChange={(event) => setPocEmail(event.target.value)}
                placeholder="poc@yourdomain.com"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>HOD Microsoft Email</span>
              <input
                className={styles.input}
                value={hodEmail}
                onChange={(event) => setHodEmail(event.target.value)}
                placeholder="hod@yourdomain.com"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Reason</span>
              <textarea
                className={styles.textarea}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Add optional governance reason"
              />
            </label>

            {!arePrimaryEmailsDifferent && normalizedPocEmail && normalizedHodEmail ? (
              <div className={styles.warning}>POC and HOD must use different email addresses.</div>
            ) : null}

            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={handleCreateTeam}
                disabled={!canCreate}
              >
                {isSubmittingCreate ? 'Creating...' : 'Create Team'}
              </button>
            </div>

            <div className={styles.preview}>Access will be granted when this email logs in via Microsoft SSO.</div>

            <label className={styles.field}>
              <span className={styles.label}>Select Team for Replacement</span>
              <select
                className={styles.select}
                value={selectedTeamId}
                onChange={(event) => setSelectedTeamId(event.target.value)}
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Role To Replace</span>
              <select
                className={styles.select}
                value={replaceRoleType}
                onChange={(event) => setReplaceRoleType(event.target.value as 'POC' | 'HOD')}
              >
                <option value="POC">POC</option>
                <option value="HOD">HOD</option>
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>New Microsoft Email</span>
              <input
                className={styles.input}
                value={newRoleEmail}
                onChange={(event) => setNewRoleEmail(event.target.value)}
                placeholder="new.owner@yourdomain.com"
              />
            </label>

            {!isReplacementDifferentFromOtherRole && normalizedNewRoleEmail ? (
              <div className={styles.warning}>Replacement email cannot match the other primary role email.</div>
            ) : null}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                onClick={() => openConfirmation({ kind: 'replace-primary-role' })}
                disabled={!canReplace}
              >
                {isSubmittingReplace ? 'Replacing...' : 'Replace'}
              </button>
            </div>
          </div>

          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>User & Department Management</h2>

            <label className={styles.field}>
              <span className={styles.label}>New User Email</span>
              <input
                className={styles.input}
                value={newUserEmail}
                onChange={(event) => setNewUserEmail(event.target.value)}
                placeholder="user@yourdomain.com"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Full Name</span>
              <input
                className={styles.input}
                value={newUserFullName}
                onChange={(event) => setNewUserFullName(event.target.value)}
                placeholder="Legal Team Member"
              />
            </label>

            <div className={styles.preview}>Creates a Legal user in the global Legal department context.</div>

            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={handleCreateUser}
                disabled={!canCreateUser}
              >
                {isSubmittingUserCreate ? 'Creating User...' : 'Create User'}
              </button>
            </div>

            <label className={styles.field}>
              <span className={styles.label}>Select Existing User</span>
              <select
                className={styles.select}
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.email}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                disabled={!selectedUser || isSubmittingStatus || selectedUser?.isActive}
                onClick={() => void handleToggleUserStatus(true)}
              >
                Activate User
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={!selectedUser || isSubmittingStatus || !selectedUser?.isActive}
                onClick={() => openConfirmation({ kind: 'deactivate-user' })}
              >
                Deactivate User
              </button>
            </div>

            <label className={styles.field}>
              <span className={styles.label}>Assign Department</span>
              <select
                className={styles.select}
                value={assignmentDepartmentId}
                onChange={(event) => setAssignmentDepartmentId(event.target.value)}
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Assign Department Role</span>
              <select
                className={styles.select}
                value={assignmentDepartmentRole}
                onChange={(event) => setAssignmentDepartmentRole(event.target.value as 'POC' | 'HOD')}
              >
                <option value="POC">POC</option>
                <option value="HOD">HOD</option>
              </select>
            </label>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                onClick={() => openConfirmation({ kind: 'assign-department-role' })}
                disabled={!canAssignDepartmentRole}
              >
                {isSubmittingAssignment ? 'Assigning...' : 'Assign Role'}
              </button>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                onClick={() => openConfirmation({ kind: 'add-legal-matrix' })}
                disabled={!canAssignLegalMatrix}
              >
                {isSubmittingLegalMatrix ? 'Updating Legal Matrix...' : 'Add Selected User To Legal Matrix'}
              </button>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Users Grouped by Department</span>
              <div className={styles.preview}>
                {usersByDepartment.length === 0 ? (
                  <div>No user department assignments found.</div>
                ) : (
                  usersByDepartment.map((group) => (
                    <div key={group.departmentId}>
                      <strong>{group.departmentName}</strong>
                      <div>
                        {group.users.length === 0
                          ? 'No users assigned'
                          : group.users
                              .map(
                                (user) =>
                                  `${user.email} (${user.departmentRole}) ${user.isActive ? 'Active' : 'Inactive'}`
                              )
                              .join(', ')}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {confirmationIntent && confirmationText ? (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label={confirmationText.title}>
            <div className={styles.modal}>
              <div className={styles.modalTitle}>{confirmationText.title}</div>
              <div className={styles.modalBody}>{confirmationText.body}</div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={closeConfirmation}
                  disabled={
                    isSubmittingReplace || isSubmittingStatus || isSubmittingAssignment || isSubmittingLegalMatrix
                  }
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={() => {
                    void handleConfirmAction()
                  }}
                  disabled={
                    isSubmittingReplace || isSubmittingStatus || isSubmittingAssignment || isSubmittingLegalMatrix
                  }
                >
                  {confirmationText.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </ProtectedAppShell>
  )
}
