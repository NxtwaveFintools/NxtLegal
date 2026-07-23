'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import Spinner from '@/components/ui/Spinner'
import { driveClient, type DriveFile } from '@/core/client/drive-client'
import DriveAccountBar from './DriveAccountBar'
import DriveBrowser from './DriveBrowser'
import DriveLogo from './DriveLogo'
import DriveModal from './DriveModal'
import { useDriveConnection } from './useDriveConnection'
import styles from './drive.module.css'

type DriveImportButtonProps = {
  /** Receives the imported file, ready to feed the existing upload pipeline. */
  onImported: (file: File) => void
  label?: string
  disabled?: boolean
  className?: string
}

export default function DriveImportButton({
  onImported,
  label = 'Import from Google Drive',
  disabled,
  className,
}: DriveImportButtonProps) {
  const { status, loading, connecting, refresh, connect, disconnect, switchAccount } = useDriveConnection()
  const [open, setOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)

  const openModal = useCallback(async () => {
    setOpen(true)
    setSelectedFile(null)
    await refresh()
  }, [refresh])

  const handleConnect = useCallback(async () => {
    const ok = await connect()
    if (!ok) toast.error('Google Drive connection was not completed')
  }, [connect])

  const handleSwitchAccount = useCallback(async () => {
    setAccountBusy(true)
    try {
      const ok = await switchAccount()
      if (ok) {
        setSelectedFile(null)
        toast.success('Switched Google account')
      }
    } finally {
      setAccountBusy(false)
    }
  }, [switchAccount])

  const handleDisconnect = useCallback(async () => {
    setAccountBusy(true)
    try {
      await disconnect()
      setSelectedFile(null)
    } finally {
      setAccountBusy(false)
    }
  }, [disconnect])

  const runImport = useCallback(
    async (file: DriveFile) => {
      setBusy(true)
      try {
        const imported = await driveClient.importFile(file.id)
        onImported(imported)
        toast.success(`Imported "${imported.name}" from Google Drive`)
        setOpen(false)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to import from Google Drive')
      } finally {
        setBusy(false)
      }
    },
    [onImported]
  )

  const isConnected = status?.connected === true

  return (
    <>
      <button
        type="button"
        className={className ?? styles.brandButton}
        onClick={() => void openModal()}
        disabled={disabled}
      >
        <DriveLogo size={16} />
        {label}
      </button>

      {open ? (
        <DriveModal
          title="Import from Google Drive"
          subtitle={isConnected ? 'Choose a PDF to upload' : undefined}
          onClose={() => {
            if (!busy) setOpen(false)
          }}
          footer={
            isConnected && !busy ? (
              <>
                <span className={styles.footerHint}>{selectedFile ? selectedFile.name : 'Select a PDF file'}</span>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!selectedFile}
                  onClick={() => selectedFile && void runImport(selectedFile)}
                >
                  Import
                </button>
              </>
            ) : undefined
          }
        >
          {loading ? (
            <div className={styles.listState}>
              <Spinner size={16} /> Checking Google Drive…
            </div>
          ) : busy ? (
            <div className={styles.progressWrap}>
              <div className={styles.progressText}>Importing from Google Drive…</div>
              <div className={styles.progressTrack}>
                <div className={styles.progressBar} />
              </div>
            </div>
          ) : !isConnected ? (
            <div className={styles.connectPane}>
              <DriveLogo size={40} className={styles.brandHeaderLogo} />
              <div className={styles.connectTitle}>Connect Google Drive</div>
              <p className={styles.connectText}>
                Authorize NxtLegal to read files from your Google Drive so you can import a contract PDF.
              </p>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void handleConnect()}
                disabled={connecting}
              >
                {connecting ? <Spinner size={14} /> : null}
                {connecting ? 'Connecting…' : 'Connect Google Drive'}
              </button>
            </div>
          ) : (
            <>
              <DriveAccountBar
                email={status?.googleAccountEmail ?? null}
                busy={accountBusy || connecting}
                onSwitch={() => void handleSwitchAccount()}
                onDisconnect={() => void handleDisconnect()}
              />
              <p className={styles.importIntro}>Browse your Drive and pick a PDF to import into this contract.</p>
              <DriveBrowser
                withFiles
                onNavigate={() => setSelectedFile(null)}
                onSelectFile={setSelectedFile}
                selectedFileId={selectedFile?.id ?? null}
              />
            </>
          )}
        </DriveModal>
      ) : null}
    </>
  )
}
