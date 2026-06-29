import { Codec } from './codec'
import { KeyPair, BKeysError, BKeysErrorCode } from './bkeys'
import { getEd25519Helper } from './helper'

export class PublicKey implements KeyPair {
  publicKey?: Uint8Array

  constructor(publicKey: Uint8Array) {
    this.publicKey = publicKey
  }

  getPublicKey(): string {
    if (!this.publicKey) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    return new TextDecoder().decode(this.publicKey)
  }

  getPrivateKey(): Uint8Array {
    if (!this.publicKey) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    throw new BKeysError(BKeysErrorCode.PublicKeyOnly)
  }

  getSeed(): Uint8Array {
    if (!this.publicKey) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    throw new BKeysError(BKeysErrorCode.PublicKeyOnly)
  }

  sign(_: Uint8Array): Uint8Array {
    if (!this.publicKey) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    throw new BKeysError(BKeysErrorCode.CannotSign)
  }

  verify(input: Uint8Array, sig: Uint8Array): boolean {
    if (!this.publicKey) {
      throw new BKeysError(BKeysErrorCode.ClearedPair)
    }
    let buf = Codec._decode(this.publicKey)
    return getEd25519Helper().verify(input, sig, buf.slice(1))
  }

  clear(): void {
    if (!this.publicKey) {
      return
    }
    this.publicKey.fill(0)
    this.publicKey = undefined
  }

  seal(input: Uint8Array, recipient: string, nonce?: Uint8Array): Uint8Array {
    throw new BKeysError(BKeysErrorCode.InvalidBKeyOperation)
  }

  open(message: Uint8Array, sender: string): Uint8Array | null {
    throw new BKeysError(BKeysErrorCode.InvalidBKeyOperation)
  }
}
