import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { TokenCipher } from '@/core/domain/drive/token-cipher'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_LENGTH = 32

/**
 * AES-256-GCM cipher for encrypting OAuth tokens at rest.
 * Ciphertext format: base64(iv):base64(authTag):base64(cipher).
 */
export class AesTokenCipher implements TokenCipher {
  private readonly key: Buffer

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64')
    if (key.length !== KEY_LENGTH) {
      throw new Error('GOOGLE_DRIVE_TOKEN_ENC_KEY must be a base64-encoded 32-byte key')
    }
    this.key = key
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
  }

  decrypt(ciphertext: string): string {
    const [ivB64, tagB64, dataB64] = ciphertext.split(':')
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Invalid ciphertext format')
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  }
}
