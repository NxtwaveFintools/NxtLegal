/**
 * Symmetric cipher abstraction for encrypting OAuth tokens at rest.
 * Implementation is injected from infrastructure (keeps the domain pure).
 */
export interface TokenCipher {
  encrypt(plaintext: string): string
  decrypt(ciphertext: string): string
}
