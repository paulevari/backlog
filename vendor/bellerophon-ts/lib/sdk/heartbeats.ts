import { Deferred, deferred } from './util'

import { DebugEvents, Status } from './core'

export interface PH {
  flush(p?: Deferred<void>): Promise<void>
  disconnect(): void
  dispatchStatus(status: Status): void
}

export class Heartbeat {
  ph: PH
  interval: number
  maxOut: number
  timer?: number
  pendings: Promise<void>[]

  constructor(ph: PH, interval: number, maxOut: number) {
    this.ph = ph
    this.interval = interval
    this.maxOut = maxOut
    this.pendings = []
  }

  // api to start the heartbeats, since this can be
  // spuriously called from dial, ensure we don't
  // leak timers
  start() {
    this.cancel()
    this._schedule()
  }

  // api for canceling the heartbeats, if stale is
  // true it will initiate a client disconnect
  cancel(stale?: boolean) {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this._reset()
    if (stale) {
      this.ph.disconnect()
    }
  }

  _schedule() {
    // @ts-ignore: node is not a number - we treat this opaquely
    this.timer = setTimeout(() => {
      this.ph.dispatchStatus({
        type: DebugEvents.PingTimer,
        data: `${this.pendings.length + 1}`,
      })
      if (this.pendings.length === this.maxOut) {
        this.cancel(true)
        return
      }
      const ping = deferred<void>()
      this.ph
        .flush(ping)
        .then(() => {
          this._reset()
        })
        .catch(() => {
          // we disconnected - pongs were rejected
          this.cancel()
        })
      this.pendings.push(ping)
      this._schedule()
    }, this.interval)
  }

  _reset() {
    // clear pendings after resolving them
    this.pendings = this.pendings.filter(p => {
      const d = p as Deferred<void>
      d.resolve()
      return false
    })
  }
}
