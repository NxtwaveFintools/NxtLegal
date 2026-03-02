export interface ContractStorageRepository {
  upload(params: { path: string; fileBody: Blob | Uint8Array; contentType: string }): Promise<void>
  remove(path: string): Promise<void>
  createSignedDownloadUrl(path: string, expiresInSeconds: number): Promise<string>
}
