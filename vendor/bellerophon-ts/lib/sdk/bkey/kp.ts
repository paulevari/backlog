import { Codec } from './codec'
import { KeyPair, BKeysError, BKeysErrorCode, Prefix } from './bkeys'
import { getEd25519Helper } from './helper'

export class KP implements KeyPair {
  seed?: Uint8Array
  constructor(seed: Uint8Array) {
    this.seed = seed
  }

  getRawSeed(): Uint8Array {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    let sd = Codec.decodeSeed(this.seed)
    return sd.buf
  }

  getSeed(): Uint8Array {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    return this.seed
  }

  getPublicKey(): string {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    const sd = Codec.decodeSeed(this.seed)
    const kp = getEd25519Helper().fromSeed(this.getRawSeed())
    const buf = Codec.encode(sd.prefix, kp.publicKey)
    return new TextDecoder().decode(buf)
  }

  getPrivateKey(): Uint8Array {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    const kp = getEd25519Helper().fromSeed(this.getRawSeed())
    return Codec.encode(Prefix.Private, kp.secretKey)
  }

  sign(input: Uint8Array): Uint8Array {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    const kp = getEd25519Helper().fromSeed(this.getRawSeed())
    return getEd25519Helper().sign(input, kp.secretKey)
  }

  verify(input: Uint8Array, sig: Uint8Array): boolean {
    if (!this.seed) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    const kp = getEd25519Helper().fromSeed(this.getRawSeed())
    return getEd25519Helper().verify(input, sig, kp.publicKey)
  }

  clear(): void {
    if (!this.seed) {
      return
    }
    this.seed.fill(0)
    this.seed = undefined
  }

  seal(input: Uint8Array, recipient: string, nonce?: Uint8Array): Uint8Array {
    throw new BKeysError(BKeysErrorCode.InvalidBKeyOperation)
  }

  open(message: Uint8Array, sender: string): Uint8Array | null {
    throw new BKeysError(BKeysErrorCode.InvalidBKeyOperation)
  }
}
