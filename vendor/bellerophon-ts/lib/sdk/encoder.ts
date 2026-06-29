export const Empty = new Uint8Array(0)

export const TE = new TextEncoder()
export const TD = new TextDecoder()

function concat(...bufs: Uint8Array[]): Uint8Array {
  let max = 0
  for (let i = 0; i < bufs.length; i++) {
    max += bufs[i].length
  }
  const out = new Uint8Array(max)
  let index = 0
  for (let i = 0; i < bufs.length; i++) {
    out.set(bufs[i], index)
    index += bufs[i].length
  }
  return out
}

export function encode(...a: string[]): Uint8Array {
  const bufs = []
  for (let i = 0; i < a.length; i++) {
    bufs.push(TE.encode(a[i]))
  }
  if (bufs.length === 0) {
    return Empty
  }
  if (bufs.length === 1) {
    return bufs[0]
  }
  return concat(...bufs)
}

export function decode(a: Uint8Array): string {
  if (!a || a.length === 0) {
    return ''
  }
  return TD.decode(a)
}
