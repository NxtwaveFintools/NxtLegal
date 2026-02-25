import 'server-only'

import nodemailer from 'nodemailer'

type BrevoSmtpSenderConfig = {
  host: string
  port: number
  user: string
  pass: string
  allowSelfSigned: boolean
  fromName: string
  fromEmail: string
}

type SendSignatoryEmailInput = {
  recipientEmail: string
  contractTitle: string
  signingUrl: string
}

export class BrevoSmtpSender {
  private readonly transporter

  constructor(private readonly config: BrevoSmtpSenderConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      tls: {
        rejectUnauthorized: !config.allowSelfSigned,
      },
    })
  }

  async sendSignatoryLinkEmail(input: SendSignatoryEmailInput): Promise<void> {
    await this.transporter.sendMail({
      from: `${this.config.fromName} <${this.config.fromEmail}>`,
      to: input.recipientEmail,
      subject: `Signature requested: ${input.contractTitle}`,
      html: `<p>You have been requested to sign the contract <strong>${this.escapeHtml(input.contractTitle)}</strong>.</p><p><a href="${input.signingUrl}">Open DocuSign signing link</a></p><p>If the button does not work, copy this URL into your browser:</p><p>${this.escapeHtml(input.signingUrl)}</p>`,
      text: `You have been requested to sign the contract "${input.contractTitle}". Use this DocuSign link: ${input.signingUrl}`,
    })
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }
}
