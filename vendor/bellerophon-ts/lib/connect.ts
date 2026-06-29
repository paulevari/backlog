import { ConnectionOptions, BConnection } from './sdk/core'
import {
  BConnectionImpl,
  Transport,
  TransportFactory,
  setTransportFactory,
} from './sdk/internal_mod'
import { nodeResolveHost, NodeTransport } from './transport'

export function connect(opts: ConnectionOptions = {}): Promise<BConnection> {
  setTransportFactory({
    factory: (): Transport => {
      return new NodeTransport()
    },
    dnsResolveFn: nodeResolveHost,
  } as TransportFactory)
  return BConnectionImpl.connect(opts)
}
