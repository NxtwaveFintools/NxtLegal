export interface ContractStorageRepository {
  upload(params: { path: string; fileBytes: Uint8Array; contentType: string }): Promise<void>
  remove(path: string): Promise<void>
  createSignedDownloadUrl(path: string, expiresInSeconds: number): Promise<string>
}
