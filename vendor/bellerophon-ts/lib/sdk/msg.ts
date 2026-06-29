import { MsgHdrsImpl } from './headers'
import type { MsgArg } from './parser'
import { Empty, TD } from './encoder'
import { Codec, JSONCodec } from './codec'
import {
  ErrorCode,
  Msg,
  MsgHdrs,
  BellerophonError,
  Publisher,
  ReviverFn,
} from './core'

export function isRequestError(msg: Msg): BellerophonError | null {
  // bellerophon core only considers errors 503s on messages that have no payload
  // everything else simply forwarded as part of the message and is considered
  // application level information
  if (msg && msg.data.length === 0 && msg.headers?.code === 503) {
    return BellerophonError.errorForCode(ErrorCode.NoResponders)
  }
  return null
}

export class MsgImpl implements Msg {
  _headers?: MsgHdrs
  _msg: MsgArg
  _rdata: Uint8Array
  _reply!: string
  _subject!: string
  publisher: Publisher
  static jc: Codec<unknown>

  constructor(msg: MsgArg, data: Uint8Array, publisher: Publisher) {
    this._msg = msg
    this._rdata = data
    this.publisher = publisher
  }

  get subject(): string {
    if (this._subject) {
      return this._subject
    }
    this._subject = TD.decode(this._msg.subject)
    return this._subject
  }

  get reply(): string {
    if (this._reply) {
      return this._reply
    }
    this._reply = TD.decode(this._msg.reply)
    return this._reply
  }

  get sid(): number {
    return this._msg.sid
  }

  get headers(): MsgHdrs | undefined {
    if (this._msg.hdr > -1 && !this._headers) {
      const buf = this._rdata.subarray(0, this._msg.hdr)
      this._headers = MsgHdrsImpl.decode(buf)
    }
    return this._headers
  }

  get data(): Uint8Array {
    if (!this._rdata) {
      return new Uint8Array(0)
    }
    return this._msg.hdr > -1
      ? this._rdata.subarray(this._msg.hdr)
      : this._rdata
  }

  // eslint-ignore-next-line @typescript-eslint/no-explicit-any
  respond(
    data: Uint8Array = Empty,
    opts?: { headers?: MsgHdrs; reply?: string },
  ): boolean {
    if (this.reply) {
      this.publisher.publish(this.reply, data, opts)
      return true
    }
    return false
  }

  size(): number {
    const subj = this._msg.subject.length
    const reply = this._msg.reply?.length || 0
    const payloadAndHeaders = this._msg.size === -1 ? 0 : this._msg.size
    return subj + reply + payloadAndHeaders
  }

  json<T = unknown>(reviver?: ReviverFn): T {
    return JSONCodec<T>(reviver).decode(this.data)
  }

  string(): string {
    return TD.decode(this.data)
  }
}
