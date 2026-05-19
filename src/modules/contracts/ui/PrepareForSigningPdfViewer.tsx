'use client'

import type { RefObject } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import styles from './prepare-for-signing-modal.module.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export type PrepareForSigningPdfPageLoadSuccess = {
  getViewport: (params: { scale: number }) => { width: number; height: number }
}

export type PrepareForSigningPdfDocumentLoadSuccess = {
  numPages: number
  getPage?: (pageNumber: number) => Promise<PrepareForSigningPdfPageLoadSuccess>
}

export type PrepareForSigningPdfViewerProps = {
  pdfUrl: string
  currentPage: number
  pageRenderRef: RefObject<HTMLDivElement | null>
  onDocumentLoadSuccess: (result: PrepareForSigningPdfDocumentLoadSuccess) => void
  onPageLoadSuccess: (page: PrepareForSigningPdfPageLoadSuccess) => void
}

export default function PrepareForSigningPdfViewer({
  pdfUrl,
  currentPage,
  pageRenderRef,
  onDocumentLoadSuccess,
  onPageLoadSuccess,
}: PrepareForSigningPdfViewerProps) {
  return (
    <Document
      file={pdfUrl}
      loading={<div className={styles.placeholder}>Loading PDF…</div>}
      error={<div className={styles.placeholder}>Unable to preview PDF</div>}
      onLoadSuccess={onDocumentLoadSuccess}
    >
      <div ref={pageRenderRef} className={styles.pageRender}>
        <Page
          pageNumber={currentPage}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          width={720}
          onLoadSuccess={onPageLoadSuccess}
        />
      </div>
    </Document>
  )
}
