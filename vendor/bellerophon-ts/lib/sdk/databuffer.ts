import { TD, TE } from './encoder'

export class DataBuffer {
  buffers: Uint8Array[]
  byteLength: number

  constructor() {
    this.buffers = []
    this.byteLength = 0
  }

  static concat(...bufs: Uint8Array[]): Uint8Array {
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

  static fromAscii(m: string): Uint8Array {
    if (!m) {
      m = ''
    }
    return TE.encode(m)
  }

  static toAscii(a: Uint8Array): string {
    return TD.decode(a)
  }

  reset(): void {
    this.buffers.length = 0
    this.byteLength = 0
  }

  pack(): void {
    if (this.buffers.length > 1) {
      const v = new Uint8Array(this.byteLength)
      let index = 0
      for (let i = 0; i < this.buffers.length; i++) {
        v.set(this.buffers[i], index)
        index += this.buffers[i].length
      }
      this.buffers.length = 0
      this.buffers.push(v)
    }
  }

  shift(): Uint8Array {
    if (this.buffers.length) {
      const a = this.buffers.shift()
      if (a) {
        this.byteLength -= a.length
        return a
      }
    }
    return new Uint8Array(0)
  }

  drain(n?: number): Uint8Array {
    if (this.buffers.length) {
      this.pack()
      const v = this.buffers.pop()
      if (v) {
        const max = this.byteLength
        if (n === undefined || n > max) {
          n = max
        }
        const d = v.subarray(0, n)
        if (max > n) {
          this.buffers.push(v.subarray(n))
        }
        this.byteLength = max - n
        return d
      }
    }
    return new Uint8Array(0)
  }

  fill(a: Uint8Array, ...bufs: Uint8Array[]): void {
    if (a) {
      this.buffers.push(a)
      this.byteLength += a.length
    }
    for (let i = 0; i < bufs.length; i++) {
      if (bufs[i] && bufs[i].length) {
        this.buffers.push(bufs[i])
        this.byteLength += bufs[i].length
      }
    }
  }

  peek(): Uint8Array {
    if (this.buffers.length) {
      this.pack()
      return this.buffers[0]
    }
    return new Uint8Array(0)
  }

  size(): number {
    return this.byteLength
  }

  length(): number {
    return this.buffers.length
  }
}
