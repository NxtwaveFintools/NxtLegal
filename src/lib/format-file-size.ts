export function formatFileSize(bytes: number): string {
  if (Number.isNaN(bytes) || bytes <= 0) {
    return '0 KB'
  }

  const kb = bytes / 1024
  if (kb < 1024) {
    return `${Math.round(kb)} KB`
  }

  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}
