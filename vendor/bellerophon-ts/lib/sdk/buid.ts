'use strict'

const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const base = 36
const preLen = 12
const seqLen = 10
const maxSeq = 3656158440062976 // base^seqLen == 36^10
const minInc = 33
const maxInc = 333
const totalLen = preLen + seqLen

function _getRandomValues(a: Uint8Array) {
  for (let i = 0; i < a.length; i++) {
    a[i] = Math.floor(Math.random() * 255)
  }
}

function fillRandom(a: Uint8Array) {
  if (globalThis?.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(a)
  } else {
    _getRandomValues(a)
  }
}

/**
 * Create and initialize a buid.
 *
 * @api private
 */
export class Buid {
  buf: Uint8Array
  seq!: number
  inc!: number
  inited: boolean

  constructor() {
    this.buf = new Uint8Array(totalLen)
    this.inited = false
  }

  /**
   * Initializes a buid with a crypto random prefix,
   * and pseudo-random sequence and increment.
   *
   * @api private
   */
  private init() {
    this.inited = true
    this.setPre()
    this.initSeqAndInc()
    this.fillSeq()
  }

  /**
   * Initializes the pseudo randmon sequence number and the increment range.
   *
   * @api private
   */
  private initSeqAndInc() {
    this.seq = Math.floor(Math.random() * maxSeq)
    this.inc = Math.floor(Math.random() * (maxInc - minInc) + minInc)
  }

  /**
   * Sets the prefix from crypto random bytes. Converts to base36.
   *
   * @api private
   */
  private setPre() {
    const cbuf = new Uint8Array(preLen)
    fillRandom(cbuf)
    for (let i = 0; i < preLen; i++) {
      const di = cbuf[i] % base
      this.buf[i] = digits.charCodeAt(di)
    }
  }

  /**
   * Fills the sequence part of the buid as base36 from this.seq.
   *
   * @api private
   */
  private fillSeq() {
    let n = this.seq
    for (let i = totalLen - 1; i >= preLen; i--) {
      this.buf[i] = digits.charCodeAt(n % base)
      n = Math.floor(n / base)
    }
  }

  /**
   * Returns the next buid.
   *
   * @api private
   */
  next(): string {
    if (!this.inited) {
      this.init()
    }
    this.seq += this.inc
    if (this.seq > maxSeq) {
      this.setPre()
      this.initSeqAndInc()
    }
    this.fillSeq()
    // @ts-ignore - Uint8Arrays can be an argument
    return String.fromCharCode.apply(String, this.buf)
  }

  reset() {
    this.init()
  }
}

export const buid = new Buid()
