import { Empty } from '../encoder'
import { MsgArg } from '../parser'
import { headers, MsgHdrsImpl } from '../headers'
import { MsgImpl } from '../msg'
import { ErrorCode, Msg, Nanos, BellerophonError, Publisher } from '../core'

export function validateDurableName(name?: string) {
  return minValidation('durable', name)
}

export function validateStreamName(name?: string) {
  return minValidation('stream', name)
}

export function minValidation(context: string, name = '') {
  // minimum validation on streams/consumers matches
  if (name === '') {
    throw Error(`${context} name required`)
  }
  const bad = ['.', '*', '>', '/', '\\', ' ', '\t', '\n', '\r']
  bad.forEach(v => {
    if (name.indexOf(v) !== -1) {
      // make the error have a meaningful character
      switch (v) {
        case '\n':
          v = '\\n'
          break
        case '\r':
          v = '\\r'
          break
        case '\t':
          v = '\\t'
          break
        default:
        // nothing
      }
      throw Error(
        `invalid ${context} name - ${context} name cannot contain '${v}'`,
      )
    }
  })
  return ''
}

export function validateName(context: string, name = '') {
  if (name === '') {
    throw Error(`${context} name required`)
  }
  const m = validName(name)
  if (m.length) {
    throw new Error(`invalid ${context} name - ${context} name ${m}`)
  }
}

export function validName(name = ''): string {
  if (name === '') {
    throw Error(`name required`)
  }
  const RE = /^[-\w]+$/g
  const m = name.match(RE)
  if (m === null) {
    for (const c of name.split('')) {
      const mm = c.match(RE)
      if (mm === null) {
        return `cannot contain '${c}'`
      }
    }
  }
  return ''
}

/**
 * Converts the specified millis into Nanos
 * @param millis
 */
export function nanos(millis: number): Nanos {
  return millis * 1000000
}

/**
 * Convert the specified Nanos into millis
 * @param ns
 */
export function millis(ns: Nanos) {
  return Math.floor(ns / 1000000)
}

/**
 * Returns true if the message is a flow control message
 * @param msg
 */
export function isFlowControlMsg(msg: Msg): boolean {
  if (msg.data.length > 0) {
    return false
  }
  const h = msg.headers
  if (!h) {
    return false
  }
  return h.code >= 100 && h.code < 200
}

/**
 * Returns true if the message is a heart beat message
 * @param msg
 */
export function isHeartbeatMsg(msg: Msg): boolean {
  return isFlowControlMsg(msg) && msg.headers?.description === 'Idle Heartbeat'
}

export function newBsErrorMsg(
  code: number,
  description: string,
  subject: string,
): Msg {
  const h = headers(code, description) as MsgHdrsImpl

  const arg = { hdr: 1, sid: 0, size: 0 } as MsgArg
  const msg = new MsgImpl(arg, Empty, {} as Publisher)
  msg._headers = h
  msg._subject = subject

  return msg
}

export function checkBsError(msg: Msg): BellerophonError | null {
  // JS error only if no payload - otherwise assume it is application data
  if (msg.data.length !== 0) {
    return null
  }
  const h = msg.headers
  if (!h) {
    return null
  }
  return checkBsErrorCode(h.code, h.description)
}

export enum Bs409Errors {
  MaxBatchExceeded = 'exceeded maxrequestbatch of',
  MaxExpiresExceeded = 'exceeded maxrequestexpires of',
  MaxBytesExceeded = 'exceeded maxrequestmaxbytes of',
  MaxMessageSizeExceeded = 'message size exceeds maxbytes',
  PushConsumer = 'consumer is push based',
  MaxWaitingExceeded = 'exceeded maxwaiting', // not terminal
  IdleHeartbeatMissed = 'idle heartbeats missed',
  ConsumerDeleted = 'consumer deleted',
  // FIXME: consumer deleted - instead of no responder (terminal error)
  //   leadership changed -
}

let MAX_WAITING_FAIL = false
export function setMaxWaitingToFail(tf: boolean) {
  MAX_WAITING_FAIL = tf
}

export function isTerminal409(err: BellerophonError): boolean {
  if (err.code !== ErrorCode.BStream409) {
    return false
  }
  const fatal = [
    Bs409Errors.MaxBatchExceeded,
    Bs409Errors.MaxExpiresExceeded,
    Bs409Errors.MaxBytesExceeded,
    Bs409Errors.MaxMessageSizeExceeded,
    Bs409Errors.PushConsumer,
    Bs409Errors.IdleHeartbeatMissed,
    Bs409Errors.ConsumerDeleted,
  ]
  if (MAX_WAITING_FAIL) {
    fatal.push(Bs409Errors.MaxWaitingExceeded)
  }

  return (
    fatal.find(s => {
      return err.message.indexOf(s) !== -1
    }) !== undefined
  )
}

export function checkBsErrorCode(
  code: number,
  description = '',
): BellerophonError | null {
  if (code < 300) {
    return null
  }
  description = description.toLowerCase()
  switch (code) {
    case 404:
      // 404 for streaming will provide different messages ensure we
      // keep whatever the server returned
      return new BellerophonError(description, ErrorCode.BStream404NoMessages)
    case 408:
      return new BellerophonError(
        description,
        ErrorCode.BStream408RequestTimeout,
      )
    case 409: {
      // the description can be exceeded max waiting or max ack pending, which are
      // recoverable, but can also be terminal errors where the request exceeds
      // some value in the consumer configuration
      const ec = description.startsWith(Bs409Errors.IdleHeartbeatMissed)
        ? ErrorCode.BStreamIdleHeartBeat
        : ErrorCode.BStream409
      return new BellerophonError(description, ec)
    }
    case 503:
      return BellerophonError.errorForCode(
        ErrorCode.BStreamNotEnabled,
        new Error(description),
      )
    default:
      if (description === '') {
        description = ErrorCode.Unknown
      }
      return new BellerophonError(description, `${code}`)
  }
}
