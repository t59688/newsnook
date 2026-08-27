/**
 * 邮件出口：验证邮件与重置邮件。
 * 传输方式可注入——测试用内存收件箱，生产用 SMTP；没有配置 SMTP 时只记日志，
 * 这样自托管者在还没接邮件服务前也能先把服务跑起来（但邮箱验证会失败）。
 */

import type { CloudConfig } from './config.js'

export interface MailMessage {
  to: string
  subject: string
  text: string
  /** 邮件里的动作链接，测试直接读它，不去解析正文 */
  url?: string
}

export interface Mailer {
  send: (message: MailMessage) => Promise<void>
}

export interface MemoryMailer extends Mailer {
  outbox: MailMessage[]
  /** 取某个收件人最后一封信；测试里比逐条筛选更直观 */
  lastTo: (email: string) => MailMessage | undefined
  clear: () => void
}

export function createMemoryMailer(): MemoryMailer {
  const outbox: MailMessage[] = []
  return {
    outbox,
    send: async (message) => {
      outbox.push(message)
    },
    lastTo: (email) => [...outbox].reverse().find((message) => message.to === email),
    clear: () => {
      outbox.length = 0
    },
  }
}

export function createMailer(config: CloudConfig): Mailer {
  const smtp = config.smtp
  if (!smtp) {
    return {
      send: async (message) => {
        // 收件人与主题可以进日志，正文与链接里可能含一次性令牌，不记
        process.stdout.write(
          `[mail] SMTP not configured, dropping message to=${message.to} subject=${message.subject}\n`,
        )
      },
    }
  }

  let transportPromise: Promise<import('nodemailer').Transporter> | null = null
  const transport = async () => {
    transportPromise ??= import('nodemailer').then((nodemailer) =>
      nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
      }),
    )
    return transportPromise
  }

  return {
    send: async (message) => {
      const mailer = await transport()
      await mailer.sendMail({
        from: smtp.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      })
    },
  }
}
