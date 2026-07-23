'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronRight, FileText, Folder, RefreshCw } from 'lucide-react'
import Spinner from '@/components/ui/Spinner'
import { driveClient, type DriveFile, type DriveFolder } from '@/core/client/drive-client'
import styles from './drive.module.css'

type Crumb = { id: string; name: string }

const ROOT: Crumb = { id: 'root', name: 'My Drive' }

type DriveBrowserProps = {
  /** When true, also lists files (for import). Only PDFs are selectable. */
  withFiles?: boolean
  /** Called whenever the current folder changes (destination for export). */
  onNavigate?: (folder: Crumb) => void
  /** Called when a selectable (PDF) file is clicked (import). */
  onSelectFile?: (file: DriveFile) => void
  selectedFileId?: string | null
}

const isSelectablePdf = (file: DriveFile): boolean =>
  file.mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

export default function DriveBrowser({
  withFiles = false,
  onNavigate,
  onSelectFile,
  selectedFileId,
}: DriveBrowserProps) {
  const [stack, setStack] = useState<Crumb[]>([ROOT])
  const [folders, setFolders] = useState<DriveFolder[]>([])
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  const current = stack[stack.length - 1]
  const onNavigateRef = useRef(onNavigate)

  useEffect(() => {
    onNavigateRef.current = onNavigate
  }, [onNavigate])

  useEffect(() => {
    let active = true
    onNavigateRef.current?.(current)

    void (async () => {
      const res = await driveClient.listFolders(current.id, withFiles)
      if (!active) return
      if (res.ok && res.data) {
        setFolders(res.data.folders)
        setFiles(res.data.files ?? [])
        setError(null)
      } else {
        setError(res.error?.message ?? 'Failed to load Google Drive folders')
      }
      setLoading(false)
    })()

    return () => {
      active = false
    }
  }, [current, withFiles, reloadNonce])

  const openFolder = (folder: DriveFolder) => {
    setLoading(true)
    setStack((prev) => [...prev, { id: folder.id, name: folder.name }])
  }

  const goToCrumb = (index: number) => {
    if (index === stack.length - 1) return
    setLoading(true)
    setStack((prev) => prev.slice(0, index + 1))
  }

  const retry = () => {
    setLoading(true)
    setReloadNonce((value) => value + 1)
  }

  return (
    <div className={styles.browser}>
      <div className={styles.breadcrumbs}>
        {stack.map((crumb, index) => (
          <span key={crumb.id} className={styles.crumb}>
            <button
              type="button"
              className={styles.crumbBtn}
              onClick={() => goToCrumb(index)}
              disabled={index === stack.length - 1}
            >
              {crumb.name}
            </button>
            {index < stack.length - 1 ? <ChevronRight size={12} className={styles.crumbSep} /> : null}
          </span>
        ))}
        <button type="button" className={styles.refreshBtn} onClick={retry} aria-label="Refresh folder">
          <RefreshCw size={13} />
        </button>
      </div>

      <div className={styles.list}>
        {loading ? (
          <div className={styles.listState}>
            <Spinner size={16} /> Loading…
          </div>
        ) : error ? (
          <div className={styles.listError}>
            <span>{error}</span>
            <button type="button" className={styles.linkButton} onClick={retry}>
              Retry
            </button>
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className={styles.listState}>This folder is empty.</div>
        ) : (
          <>
            {folders.map((folder) => (
              <button key={folder.id} type="button" className={styles.folderRow} onClick={() => openFolder(folder)}>
                <Folder size={16} className={styles.folderIcon} />
                <span className={styles.rowName}>{folder.name}</span>
                <ChevronRight size={14} className={styles.rowChevron} />
              </button>
            ))}
            {withFiles &&
              files.map((file) => {
                const selectable = isSelectablePdf(file)
                return (
                  <button
                    key={file.id}
                    type="button"
                    disabled={!selectable}
                    className={`${styles.fileRow} ${selectedFileId === file.id ? styles.fileRowSelected : ''} ${
                      selectable ? '' : styles.fileRowDisabled
                    }`}
                    onClick={() => selectable && onSelectFile?.(file)}
                    title={selectable ? file.name : 'Only PDF files can be imported'}
                  >
                    <FileText size={16} className={styles.fileIcon} />
                    <span className={styles.rowName}>{file.name}</span>
                  </button>
                )
              })}
          </>
        )}
      </div>
    </div>
  )
}
