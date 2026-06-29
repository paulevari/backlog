import { Codec, JSONCodec } from '../codec'
import { BStreamOptions, BConnection, RequestOptions, Msg } from '../core'
import { BConnectionImpl } from '../bclient'
import { Empty } from '../types'
import { extend } from '../util'
import { ApiResponse } from './bsapi_types'
import { checkBsErrorCode } from './bsutil'

const defaultPrefix = '$BS.API'
const defaultTimeout = 5000

export function defaultBsOptions(opts?: BStreamOptions): BStreamOptions {
  opts = opts || ({} as BStreamOptions)
  if (opts.domain) {
    opts.apiPrefix = `$BS.${opts.domain}.API`
    delete opts.domain
  }
  return extend({ apiPrefix: defaultPrefix, timeout: defaultTimeout }, opts)
}

export interface StreamNames {
  streams: string[]
}

export interface StreamNameBySubject {
  subject: string
}

export class BaseApiClient {
  bc: BConnectionImpl
  opts: BStreamOptions
  prefix: string
  timeout: number
  jc: Codec<unknown>

  constructor(bc: BConnection, opts?: BStreamOptions) {
    this.bc = bc as BConnectionImpl
    this.opts = defaultBsOptions(opts)
    this._parseOpts()
    this.prefix = this.opts.apiPrefix!
    this.timeout = this.opts.timeout!
    this.jc = JSONCodec()
  }

  getOptions(): BStreamOptions {
    return Object.assign({}, this.opts)
  }

  _parseOpts() {
    let prefix = this.opts.apiPrefix
    if (!prefix || prefix.length === 0) {
      throw new Error('invalid empty prefix')
    }
    const c = prefix[prefix.length - 1]
    if (c === '.') {
      prefix = prefix.substr(0, prefix.length - 1)
    }
    this.opts.apiPrefix = prefix
  }

  async _request(
    subj: string,
    data: unknown = null,
    opts?: RequestOptions,
  ): Promise<unknown> {
    opts = opts || ({} as RequestOptions)
    opts.timeout = this.timeout

    let a: Uint8Array = Empty
    if (data) {
      a = this.jc.encode(data)
    }

    const m = await this.bc.request(subj, a, opts)
    return this.parseBsResponse(m)
  }

  async findStream(subject: string): Promise<string> {
    const q = { subject } as StreamNameBySubject
    const r = await this._request(`${this.prefix}.STREAM.NAMES`, q)
    const names = r as StreamNames
    if (!names.streams || names.streams.length !== 1) {
      throw new Error('no stream matches subject')
    }
    return names.streams[0]
  }

  getConnection(): BConnection {
    return this.bc
  }

  parseBsResponse(m: Msg): unknown {
    const v = this.jc.decode(m.data)
    const r = v as ApiResponse
    if (r.error) {
      const err = checkBsErrorCode(r.error.code, r.error.description)
      if (err !== null) {
        err.api_error = r.error
        throw err
      }
    }
    return v
  }
}
