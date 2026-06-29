import { isRequestError } from './msg'
import { createInbox, ErrorCode, Msg, BellerophonError, Request } from './core'

export class MuxSubscription {
  baseInbox!: string
  reqs: Map<string, Request>

  constructor() {
    this.reqs = new Map<string, Request>()
  }

  size(): number {
    return this.reqs.size
  }

  init(prefix?: string): string {
    this.baseInbox = `${createInbox(prefix)}.`
    return this.baseInbox
  }

  add(r: Request) {
    if (!isNaN(r.received)) {
      r.received = 0
    }
    this.reqs.set(r.token, r)
  }

  get(token: string): Request | undefined {
    return this.reqs.get(token)
  }

  cancel(r: Request): void {
    this.reqs.delete(r.token)
  }

  getToken(m: Msg): string | null {
    const s = m.subject || ''
    if (s.indexOf(this.baseInbox) === 0) {
      return s.substring(this.baseInbox.length)
    }
    return null
  }

  all(): Request[] {
    return Array.from(this.reqs.values())
  }

  handleError(isMuxPermissionError: boolean, err?: BellerophonError): boolean {
    if (err && err.permissionContext) {
      if (isMuxPermissionError) {
        // one or more requests queued but mux cannot process them
        this.all().forEach(r => {
          r.resolver(err, {} as Msg)
        })
        return true
      }
      const ctx = err.permissionContext
      if (ctx.operation === 'publish') {
        const req = this.all().find(s => {
          return s.requestSubject === ctx.subject
        })
        if (req) {
          req.resolver(err, {} as Msg)
          return true
        }
      }
    }
    return false
  }

  dispatcher() {
    return (err: BellerophonError | null, m: Msg) => {
      const token = this.getToken(m)
      if (token) {
        const r = this.get(token)
        if (r) {
          if (err === null && m.headers) {
            err = isRequestError(m)
          }
          r.resolver(err, m)
        }
      }
    }
  }

  close() {
    const err = BellerophonError.errorForCode(ErrorCode.Timeout)
    this.reqs.forEach(req => {
      req.resolver(err, {} as Msg)
    })
  }
}
