'use client'

import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, CheckCircle2, FileText, XCircle } from 'lucide-react'
import Spinner from '@/components/ui/Spinner'
import { driveClient } from '@/core/client/drive-client'
import { googleDriveErrorCodes } from '@/core/constants/google-drive'
import DriveAccountBar from './DriveAccountBar'
import DriveBrowser from './DriveBrowser'
import DriveLogo from './DriveLogo'
import DriveModal from './DriveModal'
import { useDriveConnection } from './useDriveConnection'
import styles from './drive.module.css'

/** A single exportable thing: a stored document, or a final signing artifact. */
export type DriveExportItem = {
  key: string
  name: string
  group: string
  documentId?: string
  artifact?: 'signed_document' | 'completion_certificate' | 'merged_pdf'
}

type Crumb = { id: string; name: string }
type Phase = 'select' | 'folder' | 'uploading' | 'done'
type UploadResult = { key: string; name: string; ok: boolean; error?: string }
type ItemGroup = { label: string; items: DriveExportItem[] }

const buildGroups = (items: DriveExportItem[]): ItemGroup[] => {
  const order: string[] = []
  const byGroup = new Map<string, DriveExportItem[]>()
  for (const item of items) {
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, [])
      order.push(item.group)
    }
    byGroup.get(item.group)!.push(item)
  }
  return order.map((label) => ({ label, items: byGroup.get(label)! }))
}

type ExportDocumentsToDriveButtonProps = {
  contractId: string
  items: DriveExportItem[]
  buttonLabel?: string
  className?: string
}

export default function ExportDocumentsToDriveButton({
  contractId,
  items,
  buttonLabel = 'Export to Google Drive',
  className,
}: ExportDocumentsToDriveButtonProps) {
  const { status, loading, connecting, refresh, connect, disconnect, switchAccount } = useDriveConnection()
  const [open, setOpen] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>('select')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [currentFolder, setCurrentFolder] = useState<Crumb | null>(null)
  const [progress, setProgress] = useState<{ total: number; done: number; current: string }>({
    total: 0,
    done: 0,
    current: '',
  })
  const [results, setResults] = useState<UploadResult[]>([])

  const groups = useMemo(() => buildGroups(items), [items])
  const allKeys = useMemo(() => items.map((item) => item.key), [items])
  const keyToItem = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])

  const allSelected = allKeys.length > 0 && selectedKeys.size === allKeys.length
  const isConnected = status?.connected === true
  const busy = phase === 'uploading'

  const openModal = useCallback(async () => {
    setOpen(true)
    setPhase('select')
    setSelectedKeys(new Set())
    setCurrentFolder(null)
    setResults([])
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
        setPhase('select')
        setSelectedKeys(new Set())
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
    } finally {
      setAccountBusy(false)
    }
  }, [disconnect])

  const toggle = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const toggleAll = () => setSelectedKeys((prev) => (prev.size === allKeys.length ? new Set() : new Set(allKeys)))

  const toggleGroup = (group: ItemGroup) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      const groupKeys = group.items.map((item) => item.key)
      const allIn = groupKeys.every((key) => next.has(key))
      for (const key of groupKeys) {
        if (allIn) next.delete(key)
        else next.add(key)
      }
      return next
    })

  const runExport = useCallback(
    async (folder: Crumb) => {
      const keys = allKeys.filter((key) => selectedKeys.has(key))
      if (!keys.length) return

      setPhase('uploading')
      const collected: UploadResult[] = []

      for (let index = 0; index < keys.length; index += 1) {
        const item = keyToItem.get(keys[index])
        if (!item) continue
        setProgress({ total: keys.length, done: index, current: item.name })

        const res = await driveClient.exportDocument({
          contractId,
          documentId: item.documentId,
          artifact: item.artifact,
          folderId: folder.id,
          folderName: folder.name,
        })

        if (res.ok) {
          collected.push({ key: item.key, name: item.name, ok: true })
        } else {
          collected.push({ key: item.key, name: item.name, ok: false, error: res.error?.message ?? 'Upload failed' })
          if (res.error?.code === googleDriveErrorCodes.authExpired) {
            setResults([...collected])
            setProgress({ total: keys.length, done: index + 1, current: '' })
            setPhase('done')
            await refresh()
            toast.error('Google Drive needs to be reconnected.')
            return
          }
        }
        setResults([...collected])
      }

      setProgress({ total: keys.length, done: keys.length, current: '' })
      setPhase('done')

      const okCount = collected.filter((result) => result.ok).length
      const failCount = collected.length - okCount
      if (failCount === 0) {
        toast.success(`Exported ${okCount} file${okCount === 1 ? '' : 's'} to ${folder.name}`)
      } else {
        toast.error(`Exported ${okCount}, ${failCount} failed`)
      }
    },
    [allKeys, contractId, keyToItem, refresh, selectedKeys]
  )

  const renderCheckbox = (checked: boolean) => (
    <span className={`${styles.checkbox} ${checked ? styles.checkboxChecked : ''}`}>
      {checked ? <Check size={13} strokeWidth={3} /> : null}
    </span>
  )

  const okCount = results.filter((result) => result.ok).length
  const failCount = results.length - okCount

  const footer = (() => {
    if (loading || !isConnected || busy) return undefined
    if (phase === 'select') {
      return (
        <>
          <span className={styles.footerHint}>{selectedKeys.size} selected</span>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={selectedKeys.size === 0}
            onClick={() => setPhase('folder')}
          >
            Choose folder
          </button>
        </>
      )
    }
    if (phase === 'folder') {
      return (
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
            Upload {selectedKeys.size} here
          </button>
        </>
      )
    }
    if (phase === 'done') {
      return (
        <>
          <span className={styles.footerHint} />
          <button type="button" className={styles.primaryButton} onClick={() => setOpen(false)}>
            Done
          </button>
        </>
      )
    }
    return undefined
  })()

  return (
    <>
      <button
        type="button"
        className={className ?? styles.brandButton}
        onClick={() => void openModal()}
        disabled={items.length === 0}
      >
        <DriveLogo size={16} />
        {buttonLabel}
      </button>

      {open ? (
        <DriveModal
          title="Export to Google Drive"
          subtitle={isConnected && status?.googleAccountEmail ? status.googleAccountEmail : undefined}
          onClose={() => {
            if (!busy) setOpen(false)
          }}
          footer={footer}
        >
          {loading ? (
            <div className={styles.listState}>
              <Spinner size={16} /> Checking Google Drive…
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
              {!busy ? (
                <DriveAccountBar
                  email={status?.googleAccountEmail ?? null}
                  busy={accountBusy || connecting}
                  onSwitch={() => void handleSwitchAccount()}
                  onDisconnect={() => void handleDisconnect()}
                />
              ) : null}
              <div className={styles.steps}>
                <span className={`${styles.step} ${phase === 'select' ? styles.stepActive : styles.stepDone}`}>
                  <span className={styles.stepDot}>
                    {phase === 'select' ? '1' : <Check size={12} strokeWidth={3} />}
                  </span>
                  Select
                </span>
                <span className={styles.stepBar} />
                <span
                  className={`${styles.step} ${
                    phase === 'folder' ? styles.stepActive : phase === 'select' ? '' : styles.stepDone
                  }`}
                >
                  <span className={styles.stepDot}>
                    {phase === 'uploading' || phase === 'done' ? <Check size={12} strokeWidth={3} /> : '2'}
                  </span>
                  Folder
                </span>
                <span className={styles.stepBar} />
                <span
                  className={`${styles.step} ${
                    phase === 'done' ? styles.stepDone : phase === 'uploading' ? styles.stepActive : ''
                  }`}
                >
                  <span className={styles.stepDot}>3</span>
                  Upload
                </span>
              </div>

              {phase === 'select' ? (
                <>
                  <div className={styles.selectAllRow}>
                    <span className={styles.selectAllLabel} onClick={toggleAll} role="button" tabIndex={0}>
                      {renderCheckbox(allSelected)}
                      Select all
                    </span>
                    <span className={styles.selectedPill}>{selectedKeys.size} selected</span>
                  </div>

                  {groups.map((group) => {
                    const groupKeys = group.items.map((item) => item.key)
                    const allIn = groupKeys.every((key) => selectedKeys.has(key))
                    return (
                      <div key={group.label} className={styles.groupBlock}>
                        <button type="button" className={styles.groupHeader} onClick={() => toggleGroup(group)}>
                          {renderCheckbox(allIn)}
                          {group.label}
                        </button>
                        {group.items.map((item) => {
                          const checked = selectedKeys.has(item.key)
                          return (
                            <button
                              key={item.key}
                              type="button"
                              className={`${styles.docRow} ${checked ? styles.docRowSelected : ''}`}
                              onClick={() => toggle(item.key)}
                            >
                              {renderCheckbox(checked)}
                              <FileText size={16} className={styles.docFileIcon} />
                              <span className={styles.rowName}>{item.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </>
              ) : null}

              {phase === 'folder' ? (
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
              ) : null}

              {phase === 'uploading' || phase === 'done' ? (
                <div className={styles.batchProgress}>
                  {phase === 'done' ? (
                    <div
                      className={`${styles.summaryBanner} ${failCount === 0 ? styles.summaryOk : styles.summaryPartial}`}
                    >
                      {failCount === 0 ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                      {failCount === 0
                        ? `All ${okCount} file${okCount === 1 ? '' : 's'} exported to Google Drive`
                        : `${okCount} exported · ${failCount} failed`}
                    </div>
                  ) : (
                    <>
                      <div className={styles.batchProgressHead}>
                        <span>Uploading to Google Drive…</span>
                        <span className={styles.batchProgressCount}>
                          {progress.done} / {progress.total}
                        </span>
                      </div>
                      <div className={styles.batchBarTrack}>
                        <div
                          className={styles.batchBarFill}
                          style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                        />
                      </div>
                    </>
                  )}

                  <div className={styles.resultList}>
                    {results.map((result) => (
                      <div key={result.key} className={styles.resultRow}>
                        {result.ok ? (
                          <CheckCircle2 size={15} className={styles.resultOk} />
                        ) : (
                          <XCircle size={15} className={styles.resultErr} />
                        )}
                        <span className={styles.resultName}>{result.name}</span>
                      </div>
                    ))}
                    {phase === 'uploading' && progress.current ? (
                      <div className={styles.resultRow}>
                        <span className={styles.resultPending}>
                          <Spinner size={14} />
                        </span>
                        <span className={styles.resultName}>{progress.current}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </DriveModal>
      ) : null}
    </>
  )
}
