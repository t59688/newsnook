/**
 * 用户 Secret 的静态加密：AES-256-GCM + 随机 12 字节 nonce + AAD 绑定。
 *
 * 边界（设计已接受）：这不是 E2EE，服务端可以解密。要求是：
 * - PostgreSQL 里只有密文
 * - AAD 绑定 `${userId}:${secretKey}`，密文无法在用户之间或键之间搬运
 * - `keyVersion` 为将来的轻量密钥轮换留位
 * - 任何日志 / 错误信息都不得带上明文
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

import { decodeEncryptionKey } from '../config.js'

export const SECRET_KEY_VERSION = 1
const ALGORITHM = 'aes-256-gcm'
const NONCE_BYTES = 12
const AUTH_TAG_BYTES = 16

export interface EncryptedSecret {
  /** 密文与 GCM auth tag 拼接后的字节串 */
  ciphertext: Buffer
  nonce: Buffer
  keyVersion: number
}

export interface SecretCipher {
  encrypt: (params: { userId: string; secretKey: string; value: string }) => EncryptedSecret
  decrypt: (params: {
    userId: string
    secretKey: string
    secret: Pick<EncryptedSecret, 'ciphertext' | 'nonce' | 'keyVersion'>
  }) => string
}

export class SecretDecryptionError extends Error {
  constructor(message = 'Failed to decrypt secret') {
    super(message)
    this.name = 'SecretDecryptionError'
  }
}

function additionalData(userId: string, secretKey: string): Buffer {
  return Buffer.from(`${userId}:${secretKey}`, 'utf8')
}

/**
 * 主密钥只解码一次。传入的是 `NEWSNOOK_DATA_ENCRYPTION_KEY` 的原始字符串。
 */
export function createSecretCipher(rawKey: string): SecretCipher {
  const key = decodeEncryptionKey(rawKey)

  return {
    encrypt: ({ userId, secretKey, value }) => {
      const nonce = randomBytes(NONCE_BYTES)
      const cipher = createCipheriv(ALGORITHM, key, nonce)
      cipher.setAAD(additionalData(userId, secretKey))
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      const authTag = cipher.getAuthTag()
      return {
        ciphertext: Buffer.concat([encrypted, authTag]),
        nonce,
        keyVersion: SECRET_KEY_VERSION,
      }
    },

    decrypt: ({ userId, secretKey, secret }) => {
      if (secret.keyVersion !== SECRET_KEY_VERSION) {
        throw new SecretDecryptionError('Unknown secret key version')
      }
      if (secret.nonce.length !== NONCE_BYTES || secret.ciphertext.length < AUTH_TAG_BYTES) {
        throw new SecretDecryptionError()
      }
      const payload = secret.ciphertext.subarray(0, secret.ciphertext.length - AUTH_TAG_BYTES)
      const authTag = secret.ciphertext.subarray(secret.ciphertext.length - AUTH_TAG_BYTES)

      try {
        const decipher = createDecipheriv(ALGORITHM, key, secret.nonce)
        decipher.setAAD(additionalData(userId, secretKey))
        decipher.setAuthTag(authTag)
        const plain = Buffer.concat([decipher.update(payload), decipher.final()])
        return plain.toString('utf8')
      } catch {
        // 不把底层原因外泄，避免成为 padding/AAD 探测的侧信道
        throw new SecretDecryptionError()
      }
    },
  }
}

/** 供测试断言用：两段密文是否逐字节相同 */
export function ciphertextEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}
