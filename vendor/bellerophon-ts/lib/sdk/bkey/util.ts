/**
 * Encode binary data to a base64 string
 * @param {Uint8Array} bytes to encode to base64
 */
export function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Decode a base64 encoded string to a binary Uint8Array
 * @param {string} b64str encoded string
 */
export function decode(b64str: string): Uint8Array {
  const bin = atob(b64str)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return bytes
}

export function dump(buf: Uint8Array, msg?: string): void {
  if (msg) {
    console.log(msg)
  }
  let a: string[] = []
  for (let i = 0; i < buf.byteLength; i++) {
    if (i % 8 === 0) {
      a.push('\n')
    }
    let v = buf[i].toString(16)
    if (v.length === 1) {
      v = '0' + v
    }
    a.push(v)
  }
  console.log(a.join('  '))
}
