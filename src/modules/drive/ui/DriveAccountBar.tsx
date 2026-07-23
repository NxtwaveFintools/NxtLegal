'use client'

import Spinner from '@/components/ui/Spinner'
import DriveLogo from './DriveLogo'
import styles from './drive.module.css'

type DriveAccountBarProps = {
  email: string | null
  busy?: boolean
  onSwitch: () => void
  onDisconnect: () => void
}

/** Shows the connected Google account with Switch account / Disconnect actions. */
export default function DriveAccountBar({ email, busy, onSwitch, onDisconnect }: DriveAccountBarProps) {
  return (
    <div className={styles.accountBar}>
      <DriveLogo size={16} />
      <span className={styles.accountEmail}>{email ?? 'Connected to Google Drive'}</span>
      {busy ? (
        <Spinner size={14} />
      ) : (
        <>
          <button type="button" className={styles.accountAction} onClick={onSwitch}>
            Switch account
          </button>
          <button
            type="button"
            className={`${styles.accountAction} ${styles.accountActionDanger}`}
            onClick={onDisconnect}
          >
            Disconnect
          </button>
        </>
      )}
    </div>
  )
}
