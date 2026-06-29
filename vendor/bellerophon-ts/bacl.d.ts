export const bacl: {
  sign: {
    keyPair: {
      fromSeed: (seed: Uint8Array) => { publicKey: Uint8Array; secretKey: Uint8Array }
    }
    detached: {
      (message: Uint8Array, secretKey: Uint8Array): Uint8Array
      verify: (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) => boolean
    }
  }
  randomBytes: (n: number) => Uint8Array
  scalarMult: {
    base: (scalar: Uint8Array) => Uint8Array
  }
  box: {
    (message: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array
    open: (boxed: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array) => Uint8Array | null
  }
}
