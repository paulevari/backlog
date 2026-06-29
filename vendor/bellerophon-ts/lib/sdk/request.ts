import { Deferred, deferred, Timeout, timeout } from './util'
import { MuxSubscription } from './muxsubscription'
import { buid } from './buid'
import {
  ErrorCode,
  Msg,
  BellerophonError,
  Request,
  RequestManyOptions,
  RequestOptions,
  RequestStrategy,
} from './core'

export class BaseRequest {
  token: string
  received: number
  ctx?: Error
  requestSubject: string
  mux: MuxSubscription

  constructor(
    mux: MuxSubscription,
    requestSubject: string,
    asyncTraces = true,
  ) {
    this.mux = mux
    this.requestSubject = requestSubject
    this.received = 0
    this.token = buid.next()
    if (asyncTraces) {
      this.ctx = new Error()
    }
  }
}

export interface RequestManyOptionsInternal extends RequestManyOptions {
  callback: (err: Error | null, msg: Msg | null) => void
}

/**
 * Request expects multiple message response
 * the request ends when the timer expires,
 * an error arrives or an expected count of messages
 * arrives, end is signaled by a null message
 */
export class RequestMany extends BaseRequest implements Request {
  callback!: (err: Error | null, msg: Msg | null) => void
  done: Deferred<void>
  timer: number
  max: number
  opts: Partial<RequestManyOptionsInternal>
  constructor(
    mux: MuxSubscription,
    requestSubject: string,
    opts: Partial<RequestManyOptions> = { maxWait: 1000 },
  ) {
    super(mux, requestSubject)
    this.opts = opts
    if (typeof this.opts.callback !== 'function') {
      throw new Error('callback is required')
    }
    this.callback = this.opts.callback

    this.max =
      typeof opts.maxMessages === 'number' && opts.maxMessages > 0
        ? opts.maxMessages
        : -1
    this.done = deferred()
    this.done.then(() => {
      this.callback(null, null)
    })
    // @ts-ignore: node is not a number
    this.timer = setTimeout(() => {
      this.cancel()
    }, opts.maxWait)
  }

  cancel(err?: BellerophonError): void {
    if (err) {
      this.callback(err, null)
    }
    clearTimeout(this.timer)
    this.mux.cancel(this)
    this.done.resolve()
  }

  resolver(err: Error | null, msg: Msg): void {
    if (err) {
      if (this.ctx) {
        err.stack += `\n\n${this.ctx.stack}`
      }
      this.cancel(err as BellerophonError)
    } else {
      this.callback(null, msg)
      if (this.opts.strategy === RequestStrategy.Count) {
        this.max--
        if (this.max === 0) {
          this.cancel()
        }
      }

      if (this.opts.strategy === RequestStrategy.JitterTimer) {
        clearTimeout(this.timer)
        // @ts-ignore: node is not a number
        this.timer = setTimeout(() => {
          this.cancel()
        }, this.opts.jitter || 300)
      }

      if (this.opts.strategy === RequestStrategy.SentinelMsg) {
        if (msg && msg.data.length === 0) {
          this.cancel()
        }
      }
    }
  }
}

export class RequestOne extends BaseRequest implements Request {
  deferred: Deferred<Msg>
  timer: Timeout<Msg>

  constructor(
    mux: MuxSubscription,
    requestSubject: string,
    opts: RequestOptions = { timeout: 1000 },
    asyncTraces = true,
  ) {
    super(mux, requestSubject, asyncTraces)
    // extend(this, opts);
    this.deferred = deferred()
    this.timer = timeout<Msg>(opts.timeout, asyncTraces)
  }

  resolver(err: Error | null, msg: Msg): void {
    if (this.timer) {
      this.timer.cancel()
    }
    if (err) {
      if (this.ctx) {
        err.stack += `\n\n${this.ctx.stack}`
      }
      this.deferred.reject(err)
    } else {
      this.deferred.resolve(msg)
    }
    this.cancel()
  }

  cancel(err?: BellerophonError): void {
    if (this.timer) {
      this.timer.cancel()
    }
    this.mux.cancel(this)
    this.deferred.reject(
      err ? err : BellerophonError.errorForCode(ErrorCode.Cancelled),
    )
  }
}
