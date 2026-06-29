import { bacl } from './bacl'
import { Ed25519Helper, setEd25519Helper } from './lib/sdk/bkey/helper'
export * from './lib/sdk/mod'
export * from './lib/sdk/stream/mod'
if (typeof TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}

if (typeof globalThis.crypto === 'undefined') {
  const c = require('crypto')
  // this will patch to undefined if webcrypto is not available (node 14)
  // views will toss if crypto is not available
  global.crypto = c.webcrypto
}

if (typeof globalThis.ReadableStream === 'undefined') {
  // @ts-ignore: node global
  const chunks = process.versions.node.split('.')
  const v = parseInt(chunks[0])
  if (v >= 16) {
    // this won't mess up fetch
    const streams = require('stream/web')
    // views will toss if ReadableStream is not available
    global.ReadableStream = streams.ReadableStream
  }
}

export const encHelper = {
  fromSeed: bacl.sign.keyPair.fromSeed,
  sign: bacl.sign.detached,
  verify: bacl.sign.detached.verify,
  randomBytes: bacl.randomBytes,
  scalarBaseMultiply: bacl.scalarMult.base,
  seal: bacl.box,
  open: bacl.box.open,
} as Ed25519Helper

setEd25519Helper(encHelper)

export { connect } from './lib/connect'

export const sanitiseSubjectTopic = (subject: string) => {
  let prefix = subject.startsWith("evari.") ? `${subject.split(".").slice(0, 1).join(".")}.` : ''
  subject = subject.replace(prefix, "")
  // Currently, replace wildcards with 'AST' and ">"
  subject = subject.replace(/[*]/g, '_bASTb_')
  subject = subject.replace(/[>]/g, '_bGTRb_')
  subject = subject.replace(/[$]/g, '')
  subject = subject.replace(/[.]/g, '_bDOTb_')
  subject = subject.replace(/[\/]/g, '.')
  return `${prefix}${subject}`
}

export const BalrogBellerophonProviders = () => []
