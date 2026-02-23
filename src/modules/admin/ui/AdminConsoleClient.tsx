'use client'

import { useEffect, useMemo, useState } from 'react'
import { adminClient, type AdminDepartmentOption } from '@/core/client/admin-client'
import ProtectedAppShell from '@/modules/dashboard/ui/ProtectedAppShell'
import styles from './admin-console.module.css'

type AdminConsoleClientProps = {
  session: {
    employeeId: string
    fullName?: string | null
    email?: string | null
    team?: string | null
    role?: string | null
  }
}

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
  const [selectedTeamId, setSelectedTeamId] = useState('')

  const [teamName, setTeamName] = useState('')
  const [pocEmail, setPocEmail] = useState('')
  const [hodEmail, setHodEmail] = useState('')

  const [replaceRoleType, setReplaceRoleType] = useState<'POC' | 'HOD'>('POC')
  const [newRoleEmail, setNewRoleEmail] = useState('')

  const [reason, setReason] = useState('')
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [isSubmittingReplace, setIsSubmittingReplace] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        setToastMessage(null)
        const departmentsResponse = await adminClient.departments()

        if (!departmentsResponse.ok || !departmentsResponse.data) {
          setDepartments([])
          setSelectedTeamId('')
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

  const refreshDepartments = async () => {
    const response = await adminClient.departments()
    if (!response.ok || !response.data) {
      setToastMessage(response.error?.message ?? 'Failed to load departments')
      return
    }

    setDepartments(response.data.departments)
    const refreshedDepartments = response.data.departments
    setSelectedTeamId((current) => {
      if (!current) {
        return refreshedDepartments[0]?.id ?? ''
      }

      const stillExists = refreshedDepartments.some((department) => department.id === current)
      return stillExists ? current : (refreshedDepartments[0]?.id ?? '')
    })
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
      await refreshDepartments()
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
      await refreshDepartments()
      setToastMessage('Primary role mapping replaced. Old email access is revoked immediately.')
    } finally {
      setIsSubmittingReplace(false)
    }
  }

  return (
    <ProtectedAppShell
      session={{ fullName: session.fullName, email: session.email, team: session.team, role: session.role }}
      activeNav="admin"
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
              <button type="button" className={styles.button} onClick={handleReplaceRole} disabled={!canReplace}>
                {isSubmittingReplace ? 'Replacing...' : 'Replace'}
              </button>
            </div>
          </div>

          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Team Details</h2>

            <div className={styles.field}>
              <span className={styles.label}>Selected Team</span>
              <input className={styles.input} value={selectedDepartment?.name ?? 'No team selected'} readOnly />
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Current POC</span>
              <input className={styles.input} value={selectedDepartment?.pocEmail ?? 'Not assigned'} readOnly />
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Current HOD</span>
              <input className={styles.input} value={selectedDepartment?.hodEmail ?? 'Not assigned'} readOnly />
            </div>

            <div className={styles.preview}>
              This console only supports replacement for primary team roles. Deleting POC/HOD without replacement is not
              allowed.
            </div>

            <div className={styles.warning}>
              Role checks are backend-enforced from verified Microsoft email identity.
            </div>
          </div>
        </section>
      </main>
    </ProtectedAppShell>
  )
}
