export default class LAESUtils {
  constructor(encryptConf: unknown, decryptConf: unknown, isDebug?: boolean)
  createEncryptor(key: string, iv: number[], isBinaryOutput?: boolean): (input: string) => string
}
