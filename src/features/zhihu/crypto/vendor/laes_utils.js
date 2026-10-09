// LAESUtils browser ESM adaptation of the MIT zhihulite/zhihu_zse96 Node.js helper.
// 基于自定义 AES 算法的加密/解密工具类
// 作者: huajiqaq
// 日期: 2025-07-29

//
// 注意事项:
// 1. 传入 textToMatrix 的是 BigInt 类型。与 Python 不同，JavaScript 的 Number 有精度限制。
//

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(value)
  return Array.from(binary, (char) => char.charCodeAt(0))
}

function hexToUint8(hex) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

class LAESUtils {
  constructor(encryptConf, decryptConf, isDebug = false) {
    /** 初始化AES加密器 */
    this.encryptConf = encryptConf;
    this.decryptConf = decryptConf;
    this.isDebug = isDebug;
  }

  logDebug(messages) {
    /** 调试日志输出 */
    if (this.isDebug) {
      console.log(messages);
    }
  }

  getEncryptConf() {
    /** 获取加密配置 */
    return this.encryptConf;
  }

  getDecryptConf() {
    /** 获取解密配置 */
    return this.decryptConf;
  }

  static hexToBytes(hexStr) {
    /** 十六进制字符串转字节数组 */
    const bytes = [];
    for (let i = 0; i < hexStr.length; i += 2) {
      bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }
    return bytes;
  }

  static bytesToHex(byteArray) {
    /** 字节数组转十六进制字符串 */
    return byteArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  static padData(data) {
    /** 数据填充 */
    const blockSize = 16;
    const paddingLen = blockSize - (data.length % blockSize);
    const fillBytes = [0xB9, 0xBA, 0xB8, 0xB3, 0xB1, 0xB2, 0xB0, 0xBF, 0xBD, 0xBE, 0xBC, 0xB7, 0xB5, 0xB6, 0xB4, 0x9B];
    const fillByte = fillBytes[paddingLen - 1];
    return [...data, ...Array(paddingLen).fill(fillByte)];
  }

  calculateAdjustedLength(data, length) {
    /** 
     * 根据PKCS#7填充规则计算实际数据长度（移除填充）
     * @param data 解密后的字节数据
     * @param length 加密数据的长度
     * @return 移除填充后的实际长度
     */
    const threshold = 16;  // AES块大小
    const byteIndex = length - 1;  // 最后一个字节的索引

    if (!(0 <= byteIndex && byteIndex < data.length)) {
      throw new Error("Index out of range");
    }

    const lastByteValue = data[byteIndex];

    if (lastByteValue <= threshold) {
      return length - lastByteValue;
    } else if (lastByteValue >= length) {
      return length;
    } else {
      return length - lastByteValue;
    }
  }

  transform(data, lookupTable) {
    /** 使用查找表转换数据 */
    const outputArr = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      if (data[i] < 0) {
        outputArr[i] = lookupTable[data[i] + 256];
      } else {
        outputArr[i] = lookupTable[data[i]];
      }
    }
    return outputArr;
  }

  textToMatrix(text) {
    /** 将大整数转换为4x4矩阵 */
    const matrix = [];
    for (let i = 0; i < 16; i++) {
      const shiftAmount = BigInt(8 * (15 - i));
      const byte = Number((text >> shiftAmount) & 0xFFn);
      if (i % 4 === 0) {
        matrix.push([byte]);
      } else {
        matrix[Math.floor(i / 4)].push(byte);
      }
    }
    return matrix;
  }

  stateToBytes(state) {
    /** 将状态矩阵转换为字节数组 */
    return state.flat();
  }

  stateToHex(state) {
    /** 将状态矩阵转换为十六进制字符串 */
    return LAESUtils.bytesToHex(this.stateToBytes(state));
  }

  xorArrayTemplate(arr1, arr2, lookup) {
    /** 通用的XOR数组模板 */
    const result = [];
    for (let i = 0; i < arr1.length; i++) {
      const p1 = (arr2[i] & 0xF) ^ ((arr1[i] << 4) & 0xFF);
      const v1 = (lookup(p1) >> 4) & 0xFF;
      const p2 = ((arr2[i] >> 4) & 0xF) ^ ((arr1[i] >> 4) << 4);
      const v2 = (lookup(p2) >> 4) & 0xFF;
      result.push(v1 ^ (v2 << 4));
    }
    return result;
  }

  addRoundKeys(state, roundKey, lookup) {
    /** 添加轮密钥 */
    return state.map((row, i) => this.xorArrayTemplate(row, roundKey[i], lookup));
  }

  subBytes(sBox, state1, state2) {
    /** 字节替换 */
    return state1.map((row, i) => 
      row.map((val, j) => 
        (sBox[state2[i][j] & 0xF ^ ((state1[i][j] << 4) & 0xFF)] >> 4 & 0xFF) ^ 
        ((sBox[(state2[i][j] >> 4 & 0xF) ^ ((state1[i][j] >> 4) << 4)] >> 4 & 0xFF) << 4)
      )
    );
  }

  shiftRows(sBox, state, state3) {
    /** 行移位 */
    return state.map((row, i) => 
      row.map((val, j) => 
        (sBox[state3[i][j] & 0xF ^ ((state[i][j] << 4) & 0xFF)] >> 4 & 0xFF) ^ 
        ((sBox[(state3[i][j] >> 4 & 0xF) ^ ((state[i][j] >> 4) << 4)] >> 4 & 0xFF) << 4)
      )
    );
  }

  mixColumns(sBox, state, state4) {
    /** 列混淆 */
    return state.map((row, i) => 
      row.map((val, j) => 
        (sBox[state4[i][j] & 0xF ^ ((state[i][j] << 4) & 0xFF)] >> 4 & 0xFF) ^ 
        ((sBox[(state4[i][j] >> 4 & 0xF) ^ ((state[i][j] >> 4) << 4)] >> 4 & 0xFF) << 4)
      )
    );
  }

  buildKey(template, indices, source) {
    /** 构建密钥 */
    let result = '';
    for (const i of indices) {
      const byte = parseInt(source.substr(i, 2), 16);
      result += template[byte * 4];
    }
    return result;
  }

  encrypt(inputNum, mkeySchedule) {
    /** 加密核心函数 */
    const encryptConf = this.getEncryptConf();
    const keySchedule = encryptConf.key_schedule;
    const sBox = encryptConf.s_box;
    const dict1 = encryptConf.dict1;
    const dict2 = encryptConf.dict2;
    const dict3 = encryptConf.dict3;
    const dict4 = encryptConf.dict4;
    const dict5 = encryptConf.dict5;
    const roundConstants = encryptConf.round_constants;

    let state = this.addRoundKeys(
      this.textToMatrix(inputNum), 
      mkeySchedule.slice(0, 4), 
      i => keySchedule[i]
    );
    
    const keyTemplates = [
      {template: dict1, indices: [0, 8, 16, 24]},
      {template: dict2, indices: [10, 18, 26, 2]},
      {template: dict3, indices: [20, 28, 4, 12]},
      {template: dict4, indices: [30, 6, 14, 22]},
    ];
    
    let states = [];
    for (const t of keyTemplates) {
      const newKey = this.buildKey(t.template, t.indices, this.stateToHex(state));
      states.push(this.textToMatrix(BigInt('0x' + newKey)));
    }

    for (let i = 1; i < 10; i++) {
      state = this.subBytes(sBox, states[0], states[1]);
      state = this.shiftRows(sBox, state, states[2]);
      state = this.mixColumns(sBox, state, states[3]);
      state = this.addRoundKeys(state, mkeySchedule.slice(4*i, 4*(i+1)), i => sBox[i]);
      if (i !== 9) {
        states = [];
        for (const t of keyTemplates) {
          const newKey = this.buildKey(t.template, t.indices, this.stateToHex(state));
          states.push(this.textToMatrix(BigInt('0x' + newKey)));
        }
      }
    }
    
    const finalIndices = [0, 10, 20, 30, 8, 18, 28, 6, 16, 26, 4, 14, 24, 2, 12, 22];
    let newKey = '';
    for (const i of finalIndices) {
      const byte = parseInt(this.stateToHex(state).substr(i, 2), 16);
      newKey += dict5[byte];
    }
    
    state = this.textToMatrix(BigInt('0x' + newKey));
    state = this.addRoundKeys(state, mkeySchedule.slice(40, 44), i => roundConstants[i]);
    return state;
  }

  generateRoundKeys(keyString) {
    /** 根据输入的十六进制密钥字符串生成轮密钥 */
    // 将十六进制字符串转换为字节数组
    const bytesData = LAESUtils.hexToBytes(keyString);
    // 对字节数组进行异或运算生成密钥字节
    const keyBytes = bytesData.slice(4).map((byte, idx) => byte ^ bytesData[(idx + 4) % 3]);
    // 将密钥字节转换回十六进制字符串
    const keyHex = LAESUtils.bytesToHex(keyBytes);
    // 按32字符长度分割成轮密钥
    const roundKeys = [];
    for (let i = 0; i < keyHex.length; i += 32) {
      roundKeys.push(keyHex.substr(i, 32));
    }
    return roundKeys;
  }
  
  transformIv(data, arr) {
    /** IV转换 */
    let byteData;
    if (typeof data === 'string') {
      byteData = new TextEncoder().encode(data);
    } else {
      byteData = new Uint8Array(data);
    }
    
    return this.transform(Array.from(byteData), arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  aesEncrypt(roundKeys, inputHex, ivHex) {
    /** AES加密函数 */
    const inputNum = BigInt('0x' + inputHex);
    const ivNum = BigInt('0x' + ivHex);
    const inputWithIv = inputNum ^ ivNum;
    const mkeySchedule = [];
    for (const roundKey of roundKeys) {
      const bytesData = LAESUtils.hexToBytes(roundKey);
      for (let i = 0; i < bytesData.length; i += 4) {
        mkeySchedule.push(bytesData.slice(i, i + 4));
      }
    }
    
    const cipherState = this.encrypt(inputWithIv, mkeySchedule);
    const cipherText = this.stateToHex(cipherState);
    this.logDebug(`Encrypted: ${cipherText}`);
    return cipherText;
  }

  processInput(data) {
    /** 处理输入数据 */
    const decryptConf = this.getDecryptConf();
    const inputArray = decryptConf.input_arr;
    const dataLength = data.length;
    const dataS = new Array(dataLength + 256).fill(0);
    
    for (let i = 0; i < dataLength; i++) {
      const b = data[i];
      dataS[i] = inputArray[b];
    }
    
    // 填充 0x00
    for (let j = 0; j < 256; j++) {
      dataS[dataLength + j] = 0x00;
    }
    
    return {data: dataS, length: dataLength};
  }

  processOut(data, dataLength) {
    /** 处理输出数据 */
    const decryptConf = this.getDecryptConf();
    const outArray = decryptConf.out_arr;
    const dataS = new Array(dataLength);
    
    for (let i = 0; i < dataS.length; i++) {
      const b = data[i];
      dataS[i] = b < 0 ? outArray[b + 256] : outArray[b];
    }
    
    let index = dataS[dataS.length - 1];
    if (index < 0) {
      index += 256;
    }
    
    const nOut = dataS.length > index ? dataS.length - index : dataS.length;
    return dataS.slice(0, nOut);
  }

  decrypt(inputNum, mkeySchedule) {
    /** 解密核心函数 */
    const decryptConf = this.getDecryptConf();
    const keySchedule = decryptConf.key_schedule;
    const sBox = decryptConf.s_box;
    const dict1 = decryptConf.dict1;
    const dict2 = decryptConf.dict2;
    const dict3 = decryptConf.dict3;
    const dict4 = decryptConf.dict4;
    const dict5 = decryptConf.dict5;
    const roundConstants = decryptConf.round_constants;

    let state = this.addRoundKeys(
      this.textToMatrix(inputNum), 
      mkeySchedule.slice(0, 4), 
      i => keySchedule[i]
    );
    
    const keyTemplates = [
      {template: dict1, indices: [0, 8, 16, 24]},
      {template: dict2, indices: [26, 2, 10, 18]},
      {template: dict3, indices: [20, 28, 4, 12]},
      {template: dict4, indices: [14, 22, 30, 6]},
    ];
    
    let states = [];
    for (const t of keyTemplates) {
      const newKey = this.buildKey(t.template, t.indices, this.stateToHex(state));
      states.push(this.textToMatrix(BigInt('0x' + newKey)));
    }
    
    for (let i = 1; i < 10; i++) {
      state = this.subBytes(sBox, states[0], states[1]);
      state = this.shiftRows(sBox, state, states[2]);
      state = this.mixColumns(sBox, state, states[3]);
      state = this.addRoundKeys(state, mkeySchedule.slice(4*i, 4*(i+1)), i => sBox[i]);
      
      if (i !== 9) {
        states = [];
        for (const t of keyTemplates) {
          const newKey = this.buildKey(t.template, t.indices, this.stateToHex(state));
          states.push(this.textToMatrix(BigInt('0x' + newKey)));
        }
      }
    }
    
    const finalIndices = [0, 26, 20, 14, 8, 2, 28, 22, 16, 10, 4, 30, 24, 18, 12, 6];
    let newKey = '';
    for (const i of finalIndices) {
      const byte = parseInt(this.stateToHex(state).substr(i, 2), 16);
      newKey += dict5[byte];
    }
    
    state = this.textToMatrix(BigInt('0x' + newKey));
    state = this.addRoundKeys(state, mkeySchedule.slice(40, 44), i => roundConstants[i]);
    return state;
  }

  aesDecrypt(roundKeys, inputHex, ivHex) {
    /** AES解密函数 */
    const inputBytes = BigInt('0x' + inputHex);
    const mkeySchedule = [];
    
    for (const roundKey of roundKeys) {
      const bytesData = LAESUtils.hexToBytes(roundKey);
      for (let i = 0; i < bytesData.length; i += 4) {
        mkeySchedule.push(bytesData.slice(i, i + 4));
      }
    }
    
    const plainState = this.decrypt(inputBytes, mkeySchedule);
    const plainText = this.stateToHex(plainState);

    const decryptedBlockInt = BigInt('0x' + plainText);
    const prevBlockInt = BigInt('0x' + ivHex);
    const plainBlockInt = decryptedBlockInt ^ prevBlockInt;
    const plainBlockHex = plainBlockInt.toString(16).padStart(32, '0');
    this.logDebug(`Decrypted: ${plainBlockHex}`);
    return plainBlockHex;
  }

  createEncryptor(key, iv, isBinaryOutput = false) {
    /** 创建预绑定的LAESEncrypt函数 */
    const encryptConf = this.getEncryptConf();
    
    // 预先计算并转换IV
    const ivHex = this.transformIv(iv, encryptConf.iv_arr);
    
    // 预先生成轮密钥
    const roundKeys = this.generateRoundKeys(key);
    
    // 返回只需要input_data的函数
    return (inputData) => {
      const bytesData = LAESUtils.padData(
        this.transform(
          Array.from(new TextEncoder().encode(inputData)), 
          encryptConf.input_arr
        )
      );
      
      const inputHex = LAESUtils.bytesToHex(bytesData);
      
      const blocks = [];
      for (let i = 0; i < inputHex.length; i += 32) {
        blocks.push(inputHex.substr(i, 32));
      }
      
      const signatures = [];
      let currentIv = ivHex;
      for (const block of blocks) {
        const signature = this.aesEncrypt(roundKeys, block, currentIv);
        signatures.push(signature);
        currentIv = signature;
      }
      
      const finalBytes = LAESUtils.hexToBytes(signatures.join(''));
      const transformed = this.transform(finalBytes, encryptConf.out_arr);

      // 根据 isBinaryOutput 参数决定返回格式
      if (isBinaryOutput) {
        return String.fromCharCode(...transformed)
      } else {
        return bytesToBase64(transformed);
      }
    };
  }

  createDecryptor(key, iv, isBinaryInput = false) {
    /** 创建预绑定的LAESDeCrypt函数 */
    const decryptConf = this.getDecryptConf();
    
    // 预先计算并转换IV
    const ivHex = this.transformIv(iv, decryptConf.iv_arr);
    
    // 预先生成轮密钥
    const roundKeys = this.generateRoundKeys(key);
    
    // 返回只需要input_data的函数
    return (inputData) => {
      // 根据 isBinaryInput 参数决定是否先 Base64 解码输入
      if (isBinaryInput) {
        inputData = Array.from(inputData, (char) => char.charCodeAt(0));
      } else {
        inputData = base64ToBytes(inputData);
      }
      const {data: bytesData, length: dataLen} = this.processInput(inputData);
      const inputHex = LAESUtils.bytesToHex(bytesData);
      
      const blocks = [];
      for (let i = 0; i < inputHex.length; i += 32) {
        blocks.push(inputHex.substr(i, 32));
      }
      
      const signatures = [];
      let currentIv = ivHex;
      
      for (const block of blocks) {
        const signature = this.aesDecrypt(roundKeys, block, currentIv);
        signatures.push(signature);
        currentIv = block;
      }
      
      const finalPlaintextHex = signatures.join('');
      const plaintextBytes = hexToUint8(finalPlaintextHex);
      const adjustedLength = this.calculateAdjustedLength(plaintextBytes, bytesData.length);
      const transformed = this.processOut(plaintextBytes.slice(0, adjustedLength), dataLen);
      return new TextDecoder().decode(Uint8Array.from(transformed));
    };
  }
}

export default LAESUtils;