import { BaseApiClient } from './bsbaseclient_api'
import { StreamAPIImpl } from './bsmstream_api'
import { ConsumerAPI, ConsumerAPIImpl } from './bsmconsumer_api'
import { QueuedIteratorImpl } from '../queued_iterator'
import {
  Advisory,
  AdvisoryKind,
  DirectMsg,
  DirectMsgHeaders,
  DirectStreamAPI,
  BStreamClient,
  BStreamManager,
  StoredMsg,
  StreamAPI,
} from './types'
import {
  BStreamOptions,
  Msg,
  MsgHdrs,
  BConnection,
  QueuedIterator,
  RequestStrategy,
  ReviverFn,
} from '..//core'
import {
  AccountInfoResponse,
  ApiResponse,
  DirectBatchOptions,
  DirectMsgRequest,
  BStreamAccountStats,
  LastForMsgRequest,
} from './bsapi_types'
import { checkBsError, validateStreamName } from './bsutil'
import { Empty, TD } from '../encoder'
import { Codec, JSONCodec } from '..//codec'

export class DirectStreamAPIImpl
  extends BaseApiClient
  implements DirectStreamAPI
{
  constructor(nc: BConnection, opts?: BStreamOptions) {
    super(nc, opts)
  }

  async getMessage(
    stream: string,
    query: DirectMsgRequest,
  ): Promise<StoredMsg> {
    validateStreamName(stream)
    // if doing a last_by_subj request, we append the subject
    // this allows last_by_subj to be subject to permissions (KV)
    let qq: DirectMsgRequest | null = query
    const { last_by_subj } = qq as LastForMsgRequest
    if (last_by_subj) {
      qq = null
    }

    const payload = qq ? this.jc.encode(qq) : Empty
    const pre = this.opts.apiPrefix || '$BS.API'
    const subj = last_by_subj
      ? `${pre}.DIRECT.GET.${stream}.${last_by_subj}`
      : `${pre}.DIRECT.GET.${stream}`

    const r = await this.bc.request(subj, payload)

    // response is not a BS.API response
    const err = checkBsError(r)
    if (err) {
      return Promise.reject(err)
    }
    const dm = new DirectMsgImpl(r)
    return Promise.resolve(dm)
  }

  async getBatch(
    stream: string,
    opts: DirectBatchOptions,
  ): Promise<QueuedIterator<StoredMsg>> {
    validateStreamName(stream)
    const pre = this.opts.apiPrefix || '$BS.API'
    const subj = `${pre}.DIRECT.GET.${stream}`
    opts = opts || {}
    if (!Array.isArray(opts.multi_last) || opts.multi_last.length === 0) {
      return Promise.reject('multi_last is required')
    }
    const payload = JSON.stringify(opts, (key, value) => {
      if (key === 'up_to_time' && value instanceof Date) {
        return value.toISOString()
      }
      return value
    })

    const iter = new QueuedIteratorImpl<StoredMsg>()

    const raw = await this.bc.requestMany(subj, payload, {
      strategy: RequestStrategy.SentinelMsg,
    })

    ;(async () => {
      let gotFirst = false
      let badServer = false
      let badRequest: string | undefined
      for await (const m of raw) {
        if (!gotFirst) {
          gotFirst = true
          const code = m.headers?.code || 0
          if ((code !== 0 && code < 200) || code > 299) {
            badRequest = m.headers?.description.toLowerCase()
            break
          }
          // inspect the message and make sure that we have a supported server
          const v = m.headers?.get('Evari-Num-Pending')
          if (v === '') {
            badServer = true
            break
          }
        }
        if (m.data.length === 0) {
          break
        }
        iter.push(new DirectMsgImpl(m))
      }
      //@ts-ignore: term function
      iter.push((): void => {
        if (badServer) {
          throw new Error('batch direct get not supported by the server')
        }
        if (badRequest) {
          throw new Error(`bad request: ${badRequest}`)
        }
        iter.stop()
      })
    })()

    return Promise.resolve(iter)
  }
}

export class DirectMsgImpl implements DirectMsg {
  data: Uint8Array
  header: MsgHdrs
  static jc?: Codec<unknown>

  constructor(m: Msg) {
    if (!m.headers) {
      throw new Error('headers expected')
    }
    this.data = m.data
    this.header = m.headers
  }

  get subject(): string {
    return this.header.last(DirectMsgHeaders.Subject)
  }

  get seq(): number {
    const v = this.header.last(DirectMsgHeaders.Sequence)
    return typeof v === 'string' ? parseInt(v) : 0
  }

  get time(): Date {
    return new Date(Date.parse(this.timestamp))
  }

  get timestamp(): string {
    return this.header.last(DirectMsgHeaders.TimeStamp)
  }

  get stream(): string {
    return this.header.last(DirectMsgHeaders.Stream)
  }

  json<T = unknown>(reviver?: ReviverFn): T {
    return JSONCodec<T>(reviver).decode(this.data)
  }

  string(): string {
    return TD.decode(this.data)
  }
}

export class BStreamManagerImpl
  extends BaseApiClient
  implements BStreamManager
{
  streams: StreamAPI
  consumers: ConsumerAPI
  direct: DirectStreamAPI
  constructor(nc: BConnection, opts?: BStreamOptions) {
    super(nc, opts)
    this.streams = new StreamAPIImpl(nc, opts)
    this.consumers = new ConsumerAPIImpl(nc, opts)
    this.direct = new DirectStreamAPIImpl(nc, opts)
  }

  async getAccountInfo(): Promise<BStreamAccountStats> {
    const r = await this._request(`${this.prefix}.INFO`)
    return r as AccountInfoResponse
  }

  bstream(): BStreamClient {
    return this.bc.bstream(this.getOptions())
  }

  advisories(): AsyncIterable<Advisory> {
    const iter = new QueuedIteratorImpl<Advisory>()
    this.bc.subscribe(`$BS.EVENT.ADVISORY.>`, {
      callback: (err, msg) => {
        if (err) {
          throw err
        }
        try {
          const d = this.parseBsResponse(msg) as ApiResponse
          const chunks = d.type.split('.')
          const kind = chunks[chunks.length - 1]
          iter.push({ kind: kind as AdvisoryKind, data: d })
        } catch (err) {
          iter.stop(err)
        }
      },
    })

    return iter
  }
}
