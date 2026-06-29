import { BaseApiClient } from './bsbaseclient_api'
import {
  ApiPaged,
  ApiPagedRequest,
  ApiResponse,
  ConsumerListResponse,
  StreamListResponse,
} from './bsapi_types'

/**
 * An interface for listing. Returns a promise with typed list.
 */
export interface Lister<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>

  next(): Promise<T[]>
}

export type ListerFieldFilter<T> = (v: unknown) => T[]

export class ListerImpl<T> implements Lister<T>, AsyncIterable<T> {
  err?: Error
  offset: number
  pageInfo: ApiPaged
  subject: string
  bsm: BaseApiClient
  filter: ListerFieldFilter<T>
  payload: unknown

  constructor(
    subject: string,
    filter: ListerFieldFilter<T>,
    bsm: BaseApiClient,
    payload?: unknown,
  ) {
    if (!subject) {
      throw new Error('subject is required')
    }
    this.subject = subject
    this.bsm = bsm
    this.offset = 0
    this.pageInfo = {} as ApiPaged
    this.filter = filter
    this.payload = payload || {}
  }

  async next(): Promise<T[]> {
    if (this.err) {
      return []
    }
    if (this.pageInfo && this.offset >= this.pageInfo.total) {
      return []
    }

    const offset = { offset: this.offset } as ApiPagedRequest
    if (this.payload) {
      Object.assign(offset, this.payload)
    }
    try {
      const r = await this.bsm._request(this.subject, offset, {
        timeout: this.bsm.timeout,
      })
      this.pageInfo = r as ApiPaged
      // offsets are reported in total, so need to count
      // all the entries returned
      const count = this.countResponse(r as ApiResponse)
      if (count === 0) {
        // we are done if we get a null set of infos
        return []
      }
      this.offset += count
      const a = this.filter(r)
      return a
    } catch (err) {
      this.err = err
      throw err
    }
  }

  countResponse(r?: ApiResponse): number {
    switch (r?.type) {
      case 'evari.bellerophon.streaming.api.v1.stream_names_response':
      case 'evari.bellerophon.streaming.api.v1.stream_list_response':
        return (r as StreamListResponse).streams?.length || 0
      case 'evari.bellerophon.streaming.api.v1.consumer_list_response':
        return (r as ConsumerListResponse).consumers?.length || 0
      default:
        console.error(
          `bslister.ts: unknown API response for paged output: ${r?.type}`,
        )
        // has to be a stream...
        return (r as StreamListResponse).streams?.length || 0
    }
    return 0
  }

  async *[Symbol.asyncIterator]() {
    let page = await this.next()
    while (page.length > 0) {
      for (const item of page) {
        yield item
      }
      page = await this.next()
    }
  }
}
