import { KeyPair, BKeysError, BKeysErrorCode } from './bkeys'
import { getEd25519Helper } from './helper'
import { Codec } from './codec'
import { Prefix } from './mod'
import { base32 } from './base32'
import { crc16 } from './crc16'

export const curveKeyLen = 32
const curveDecodeLen = 35
export const curveNonceLen = 24
// "xkv1" in bytes
const XKeyVersionV1 = [120, 107, 118, 49]

export class CurveKP implements KeyPair {
  seed?: Uint8Array

  constructor(seed: Uint8Array) {
    this.seed = seed
  }

  clear(): void {
    if (!this.seed) {
      return
    }
    this.seed.fill(0)
    this.seed = undefined
  }

  getPrivateKey(): Uint8Array {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    return Codec.encode(Prefix.Private, this.seed)
  }

  getPublicKey(): string {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    const pub = getEd25519Helper().scalarBaseMultiply(this.seed)
    const buf = Codec.encode(Prefix.Curve, pub)
    return new TextDecoder().decode(buf)
  }

  getSeed(): Uint8Array {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    return Codec.encodeSeed(Prefix.Curve, this.seed)
  }

  sign(): Uint8Array {
    throw new BKeysError(BKeysErrorCode.InvalidCurveOperation)
  }

  verify(): boolean {
    throw new BKeysError(BKeysErrorCode.InvalidCurveOperation)
  }

  decodePubCurveKey(src: string): Uint8Array {
    try {
      const raw = base32.decode(new TextEncoder().encode(src))
      if (raw.byteLength !== curveDecodeLen) {
        throw new BKeysError(BKeysErrorCode.InvalidCurveKey)
      }
      if (raw[0] !== Prefix.Curve) {
        throw new BKeysError(BKeysErrorCode.InvalidPublicKey)
      }

      const checkOffset = raw.byteLength - 2
      const dv = new DataView(raw.buffer)
      const checksum = dv.getUint16(checkOffset, true)
      const payload = raw.slice(0, checkOffset)
      if (!crc16.validate(payload, checksum)) {
        throw new BKeysError(BKeysErrorCode.InvalidChecksum)
      }
      // remove the prefix byte
      return payload.slice(1)
    } catch (ex) {
      throw new BKeysError(BKeysErrorCode.InvalidRecipient, ex)
    }
  }

  seal(message: Uint8Array, recipient: string, nonce?: Uint8Array): Uint8Array {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    if (!nonce) {
      nonce = getEd25519Helper().randomBytes(curveNonceLen)
    }
    let pub = this.decodePubCurveKey(recipient)

    // prefix a header to the nonce
    const out = new Uint8Array(XKeyVersionV1.length + curveNonceLen)
    out.set(XKeyVersionV1, 0)
    out.set(nonce, XKeyVersionV1.length)

    // this is only the encoded payload
    const encrypted = getEd25519Helper().seal(message, nonce, pub, this.seed)
    // the full message is the header+nonce+encrypted
    const fullMessage = new Uint8Array(out.length + encrypted.length)
    fullMessage.set(out)
    fullMessage.set(encrypted, out.length)
    return fullMessage
  }

  open(message: Uint8Array, sender: string): Uint8Array | null {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    if (message.length <= curveNonceLen + XKeyVersionV1.length) {
      throw new BKeysError(BKeysErrorCode.InvalidEncrypted)
    }
    for (let i = 0; i < XKeyVersionV1.length; i++) {
      if (message[i] !== XKeyVersionV1[i]) {
        throw new BKeysError(BKeysErrorCode.InvalidEncrypted)
      }
    }

    const pub = this.decodePubCurveKey(sender)

    // strip off the header
    message = message.slice(XKeyVersionV1.length)
    // extract the nonce
    const nonce = message.slice(0, curveNonceLen)
    // stripe the nonce
    message = message.slice(curveNonceLen)

    return getEd25519Helper().open(message, nonce, pub, this.seed)
  }
}
