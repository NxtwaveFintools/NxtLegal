'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import Spinner from '@/components/ui/Spinner'
import { driveClient } from '@/core/client/drive-client'
import { googleDriveErrorCodes } from '@/core/constants/google-drive'
import DriveBrowser from './DriveBrowser'
import DriveLogo from './DriveLogo'
import DriveModal from './DriveModal'
import { useDriveConnection } from './useDriveConnection'
import styles from './drive.module.css'

type Crumb = { id: string; name: string }

type ExportToDriveButtonProps = {
  contractId: string
  /** Export a specific contract document (documents panel). */
  documentId?: string
  /** Export a final signing artifact (signed docs tab). */
  artifact?: 'signed_document' | 'completion_certificate' | 'merged_pdf'
  label?: string
  disabled?: boolean
  className?: string
}

export default function ExportToDriveButton({
  contractId,
  documentId,
  artifact,
  label = 'Export to Google Drive',
  disabled,
  className,
}: ExportToDriveButtonProps) {
  const { status, loading, connecting, refresh, connect } = useDriveConnection()
  const [open, setOpen] = useState(false)
  const [currentFolder, setCurrentFolder] = useState<Crumb | null>(null)
  const [busy, setBusy] = useState(false)

  const openModal = useCallback(async () => {
    setOpen(true)
    setCurrentFolder(null)
    await refresh()
  }, [refresh])

  const handleConnect = useCallback(async () => {
    const ok = await connect()
    if (!ok) {
      toast.error('Google Drive connection was not completed')
    }
  }, [connect])

  const runExport = useCallback(
    async (folder: Crumb) => {
      setBusy(true)
      try {
        const res = await driveClient.exportDocument({
          contractId,
          documentId,
          artifact,
          folderId: folder.id,
          folderName: folder.name,
        })
        if (res.ok && res.data) {
          toast.success(`Exported "${res.data.fileName}" to ${folder.name}`)
          setOpen(false)
          return
        }
        const code = res.error?.code
        if (code === googleDriveErrorCodes.authExpired || code === googleDriveErrorCodes.notConnected) {
          toast.error('Google Drive needs to be reconnected.')
          await refresh()
        } else {
          toast.error(res.error?.message ?? 'Failed to export to Google Drive')
        }
      } finally {
        setBusy(false)
      }
    },
    [artifact, contractId, documentId, refresh]
  )

  const isConnected = status?.connected === true

  return (
    <>
      <button
        type="button"
        className={className ?? styles.triggerButton}
        onClick={() => void openModal()}
        disabled={disabled}
      >
        <DriveLogo size={15} />
        {label}
      </button>

      {open ? (
        <DriveModal
          title="Export to Google Drive"
          subtitle={isConnected && status?.googleAccountEmail ? status.googleAccountEmail : undefined}
          onClose={() => {
            if (!busy) setOpen(false)
          }}
          footer={
            isConnected && !busy ? (
              <>
                <span className={styles.footerHint}>
                  {currentFolder ? `Destination: ${currentFolder.name}` : 'Open a folder'}
                </span>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!currentFolder}
                  onClick={() => currentFolder && void runExport(currentFolder)}
                >
                  Upload here
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
              <div className={styles.progressText}>Uploading to Google Drive…</div>
              <div className={styles.progressTrack}>
                <div className={styles.progressBar} />
              </div>
            </div>
          ) : !isConnected ? (
            <div className={styles.connectPane}>
              <DriveLogo size={40} className={styles.brandHeaderLogo} />
              <div className={styles.connectTitle}>Connect Google Drive</div>
              <p className={styles.connectText}>
                Authorize NxtLegal to upload documents to your Google Drive. You only need to do this once.
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
              {status?.lastFolder ? (
                <div className={styles.lastFolder}>
                  <span className={styles.lastFolderText}>Last used: {status.lastFolder.name}</span>
                  <button
                    type="button"
                    className={styles.lastFolderButton}
                    onClick={() => status.lastFolder && void runExport(status.lastFolder)}
                  >
                    Upload here
                  </button>
                </div>
              ) : null}
              <DriveBrowser withFiles={false} onNavigate={setCurrentFolder} />
            </>
          )}
        </DriveModal>
      ) : null}
    </>
  )
}
