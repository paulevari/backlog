import { Deferred, deferred } from './util'
import type {
  DispatchedFn,
  IngestionFilterFn,
  ProtocolFilterFn,
} from './queued_iterator'
import { QueuedIteratorImpl } from './queued_iterator'
import {
  ErrorCode,
  Msg,
  BConnection,
  BellerophonError,
  Sub,
  SubOpts,
  Subscription,
  SubscriptionOptions,
} from './core'
import { SubscriptionImpl } from './protocol'

/**
 * Converts a bellerophon message into some other type. Implementers are expected to:
 * return [err, null] if the message callback is invoked with an error.
 * return [err, null] if converting the message yielded an error, note that
 * iterators will stop on the error, but callbacks will be presented with
 * the error.
 * return [null, T] if the conversion worked correctly
 */
export type MsgAdapter<T> = (
  err: BellerophonError | null,
  msg: Msg,
) => [BellerophonError | null, T | null]

/**
 * Callback presented to the user with the converted type
 */
export type TypedCallback<T> = (
  err: BellerophonError | null,
  msg: T | null,
) => void

export interface TypedSubscriptionOptions<T> extends SubOpts<T> {
  adapter: MsgAdapter<T>
  callback?: TypedCallback<T>
  ingestionFilterFn?: IngestionFilterFn<T>
  protocolFilterFn?: ProtocolFilterFn<T>
  dispatchedFn?: DispatchedFn<T>
  cleanupFn?: (sub: Subscription, info?: unknown) => void
}

export function checkFn(fn: unknown, name: string, required = false) {
  if (required === true && !fn) {
    throw BellerophonError.errorForCode(
      ErrorCode.ApiError,
      new Error(`${name} is not a function`),
    )
  }
  if (fn && typeof fn !== 'function') {
    throw BellerophonError.errorForCode(
      ErrorCode.ApiError,
      new Error(`${name} is not a function`),
    )
  }
}

/**
 * TypedSubscription wraps a subscription to provide payload specific
 * subscription semantics. That is messages are a transport
 * for user data, and the data is presented as application specific
 * data to the client.
 */
export class TypedSubscription<T>
  extends QueuedIteratorImpl<T>
  implements Sub<T>
{
  sub: SubscriptionImpl
  adapter: MsgAdapter<T>
  subIterDone: Deferred<void>

  constructor(
    nc: BConnection,
    subject: string,
    opts: TypedSubscriptionOptions<T>,
  ) {
    super()

    checkFn(opts.adapter, 'adapter', true)
    this.adapter = opts.adapter

    if (opts.callback) {
      checkFn(opts.callback, 'callback')
    }
    this.noIterator = typeof opts.callback === 'function'

    if (opts.ingestionFilterFn) {
      checkFn(opts.ingestionFilterFn, 'ingestionFilterFn')
      this.ingestionFilterFn = opts.ingestionFilterFn
    }
    if (opts.protocolFilterFn) {
      checkFn(opts.protocolFilterFn, 'protocolFilterFn')
      this.protocolFilterFn = opts.protocolFilterFn
    }
    if (opts.dispatchedFn) {
      checkFn(opts.dispatchedFn, 'dispatchedFn')
      this.dispatchedFn = opts.dispatchedFn
    }
    if (opts.cleanupFn) {
      checkFn(opts.cleanupFn, 'cleanupFn')
    }

    let callback = (err: BellerophonError | null, msg: Msg) => {
      this.callback(err, msg)
    }
    if (opts.callback) {
      const uh = opts.callback
      callback = (err: BellerophonError | null, msg: Msg) => {
        const [jer, tm] = this.adapter(err, msg)
        if (jer) {
          uh(jer, null)
          return
        }
        const { ingest } = this.ingestionFilterFn
          ? this.ingestionFilterFn(tm, this)
          : { ingest: true }
        if (ingest) {
          const ok = this.protocolFilterFn ? this.protocolFilterFn(tm) : true
          if (ok) {
            uh(jer, tm)
            if (this.dispatchedFn && tm) {
              this.dispatchedFn(tm)
            }
          }
        }
      }
    }
    const { max, queue, timeout } = opts
    const sopts = { queue, timeout, callback } as SubscriptionOptions
    if (max && max > 0) {
      sopts.max = max
    }
    this.sub = nc.subscribe(subject, sopts) as SubscriptionImpl
    if (opts.cleanupFn) {
      this.sub.cleanupFn = opts.cleanupFn
    }

    if (!this.noIterator) {
      this.iterClosed.then(() => {
        this.unsubscribe()
      })
    }

    this.subIterDone = deferred<void>()
    Promise.all([this.sub.closed, this.iterClosed])
      .then(() => {
        this.subIterDone.resolve()
      })
      .catch(() => {
        this.subIterDone.resolve()
      })
    ;(async s => {
      await s.closed
      this.stop()
    })(this.sub)
      .then()
      .catch()
  }

  unsubscribe(max?: number): void {
    this.sub.unsubscribe(max)
  }

  drain(): Promise<void> {
    return this.sub.drain()
  }

  isDraining(): boolean {
    return this.sub.isDraining()
  }

  isClosed(): boolean {
    return this.sub.isClosed()
  }

  callback(e: BellerophonError | null, msg: Msg): void {
    this.sub.cancelTimeout()
    const [err, tm] = this.adapter(e, msg)
    if (err) {
      this.stop(err)
    }
    if (tm) {
      this.push(tm)
    }
  }

  getSubject(): string {
    return this.sub.getSubject()
  }

  getReceived(): number {
    return this.sub.getReceived()
  }

  getProcessed(): number {
    return this.sub.getProcessed()
  }

  getPending(): number {
    return this.sub.getPending()
  }

  getID(): number {
    return this.sub.getID()
  }

  getMax(): number | undefined {
    return this.sub.getMax()
  }

  get closed(): Promise<void> {
    return this.sub.closed
  }
}
