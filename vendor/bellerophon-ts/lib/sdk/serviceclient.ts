import { Empty } from './encoder'
import { JSONCodec } from './codec'
import { QueuedIteratorImpl } from './queued_iterator'
import {
  BConnection,
  RequestManyOptions,
  ServiceIdentity,
  ServiceInfo,
  ServiceStats,
  ServiceVerb,
} from './core'
import { ServiceImpl } from './service'

import { QueuedIterator, RequestStrategy, ServiceClient } from './core'

export class ServiceClientImpl implements ServiceClient {
  nc: BConnection
  prefix: string | undefined
  opts: RequestManyOptions
  constructor(
    nc: BConnection,
    opts: RequestManyOptions = {
      strategy: RequestStrategy.JitterTimer,
      maxWait: 2000,
    },
    prefix?: string,
  ) {
    this.nc = nc
    this.prefix = prefix
    this.opts = opts
  }

  ping(name = '', id = ''): Promise<QueuedIterator<ServiceIdentity>> {
    return this.q<ServiceIdentity>(ServiceVerb.PING, name, id)
  }

  stats(name = '', id = ''): Promise<QueuedIterator<ServiceStats>> {
    return this.q<ServiceStats>(ServiceVerb.STATS, name, id)
  }

  info(name = '', id = ''): Promise<QueuedIterator<ServiceInfo>> {
    return this.q<ServiceInfo>(ServiceVerb.INFO, name, id)
  }

  async q<T>(v: ServiceVerb, name = '', id = ''): Promise<QueuedIterator<T>> {
    const iter = new QueuedIteratorImpl<T>()
    const jc = JSONCodec<T>()
    const subj = ServiceImpl.controlSubject(v, name, id, this.prefix)
    const responses = await this.nc.requestMany(subj, Empty, this.opts)
    ;(async () => {
      for await (const m of responses) {
        try {
          const s = jc.decode(m.data)
          iter.push(s)
        } catch (err) {
          // @ts-ignore: pushing fn
          iter.push(() => {
            iter.stop(err)
          })
        }
      }
      //@ts-ignore: push a fn
      iter.push(() => {
        iter.stop()
      })
    })().catch(err => {
      iter.stop(err)
    })
    return iter
  }
}
