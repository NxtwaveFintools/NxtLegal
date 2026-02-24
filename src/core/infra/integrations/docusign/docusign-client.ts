import 'server-only'

import { createSign, randomUUID } from 'crypto'

type DocusignClientConfig = {
  authBaseUrl: string
  apiBaseUrl: string
  accountId: string
  userId: string
  integrationKey: string
  rsaPrivateKey: string
}

type CreateSigningEnvelopeInput = {
  signerEmail: string
  signerName: string
  documentName: string
  documentMimeType: string
  documentBytes: Uint8Array
  emailSubject: string
  returnUrl: string
}

type CreateSigningEnvelopeResult = {
  envelopeId: string
  recipientId: string
  clientUserId: string
  signingUrl: string
}

export class DocusignClient {
  constructor(private readonly config: DocusignClientConfig) {}

  async createSigningEnvelope(input: CreateSigningEnvelopeInput): Promise<CreateSigningEnvelopeResult> {
    const accessToken = await this.getAccessToken()
    const clientUserId = randomUUID()
    const recipientId = '1'

    const envelopeResponse = await fetch(`${this.config.apiBaseUrl}/v2.1/accounts/${this.config.accountId}/envelopes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        emailSubject: input.emailSubject,
        documents: [
          {
            documentBase64: Buffer.from(input.documentBytes).toString('base64'),
            name: input.documentName,
            fileExtension: this.resolveFileExtension(input.documentName, input.documentMimeType),
            documentId: '1',
          },
        ],
        recipients: {
          signers: [
            {
              email: input.signerEmail,
              name: input.signerName,
              recipientId,
              routingOrder: '1',
              clientUserId,
            },
          ],
        },
        status: 'sent',
      }),
    })

    if (!envelopeResponse.ok) {
      const errorBody = await envelopeResponse.text()
      throw new Error(`DocuSign envelope creation failed: ${errorBody}`)
    }

    const envelopePayload = (await envelopeResponse.json()) as { envelopeId?: string }
    const envelopeId = envelopePayload.envelopeId

    if (!envelopeId) {
      throw new Error('DocuSign did not return envelopeId')
    }

    const viewResponse = await fetch(
      `${this.config.apiBaseUrl}/v2.1/accounts/${this.config.accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          returnUrl: input.returnUrl,
          authenticationMethod: 'none',
          email: input.signerEmail,
          userName: input.signerName,
          clientUserId,
          recipientId,
        }),
      }
    )

    if (!viewResponse.ok) {
      const errorBody = await viewResponse.text()
      throw new Error(`DocuSign recipient view generation failed: ${errorBody}`)
    }

    const viewPayload = (await viewResponse.json()) as { url?: string }
    if (!viewPayload.url) {
      throw new Error('DocuSign did not return signing URL')
    }

    return {
      envelopeId,
      recipientId,
      clientUserId,
      signingUrl: viewPayload.url,
    }
  }

  private async getAccessToken(): Promise<string> {
    const assertion = this.createJwtAssertion()
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    })

    const tokenResponse = await fetch(`${this.config.authBaseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text()
      throw new Error(`DocuSign auth failed: ${errorBody}`)
    }

    const payload = (await tokenResponse.json()) as { access_token?: string }
    if (!payload.access_token) {
      throw new Error('DocuSign auth response missing access_token')
    }

    return payload.access_token
  }

  private createJwtAssertion(): string {
    const nowInSeconds = Math.floor(Date.now() / 1000)
    const header = {
      alg: 'RS256',
      typ: 'JWT',
    }

    const audienceHost = new URL(this.config.authBaseUrl).host
    const payload = {
      iss: this.config.integrationKey,
      sub: this.config.userId,
      aud: audienceHost,
      scope: 'signature impersonation',
      iat: nowInSeconds,
      exp: nowInSeconds + 300,
    }

    const encodedHeader = this.toBase64Url(JSON.stringify(header))
    const encodedPayload = this.toBase64Url(JSON.stringify(payload))
    const unsignedToken = `${encodedHeader}.${encodedPayload}`

    const signer = createSign('RSA-SHA256')
    signer.update(unsignedToken)
    signer.end()

    const normalizedPrivateKey = this.config.rsaPrivateKey.replace(/\\n/g, '\n')
    const signature = signer.sign(normalizedPrivateKey)

    return `${unsignedToken}.${this.toBase64Url(signature)}`
  }

  private toBase64Url(value: string | Buffer): string {
    const base64 = Buffer.isBuffer(value) ? value.toString('base64') : Buffer.from(value).toString('base64')
    return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  }

  private resolveFileExtension(fileName: string, mimeType: string): string {
    const extensionFromName = fileName.split('.').pop()?.trim().toLowerCase()
    if (extensionFromName && extensionFromName.length > 0) {
      return extensionFromName
    }

    if (mimeType.includes('pdf')) {
      return 'pdf'
    }

    if (mimeType.includes('wordprocessingml.document')) {
      return 'docx'
    }

    return 'bin'
  }
}
