// Fork of https://github.com/LinusU/base32-encode
// and https://github.com/LinusU/base32-decode to support returning
// buffers without padding.

const b32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export class base32 {
  static encode(src: Uint8Array): Uint8Array {
    let bits = 0
    let value = 0
    let a = new Uint8Array(src)
    let buf = new Uint8Array(src.byteLength * 2)
    let j = 0
    for (let i = 0; i < a.byteLength; i++) {
      value = (value << 8) | a[i]
      bits += 8
      while (bits >= 5) {
        let index = (value >>> (bits - 5)) & 31
        buf[j++] = b32Alphabet.charAt(index).charCodeAt(0)
        bits -= 5
      }
    }
    if (bits > 0) {
      let index = (value << (5 - bits)) & 31
      buf[j++] = b32Alphabet.charAt(index).charCodeAt(0)
    }
    return buf.slice(0, j)
  }

  static decode(src: Uint8Array): Uint8Array {
    let bits = 0
    let byte = 0
    let j = 0
    let a = new Uint8Array(src)
    let out = new Uint8Array(((a.byteLength * 5) / 8) | 0)
    for (let i = 0; i < a.byteLength; i++) {
      let v = String.fromCharCode(a[i])
      let vv = b32Alphabet.indexOf(v)
      if (vv === -1) {
        throw new Error('Illegal Base32 character: ' + a[i])
      }
      byte = (byte << 5) | vv
      bits += 5
      if (bits >= 8) {
        out[j++] = (byte >>> (bits - 8)) & 255
        bits -= 8
      }
    }
    return out.slice(0, j)
  }
}
