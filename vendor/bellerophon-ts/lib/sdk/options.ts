import { extend } from './util'
import { defaultPort, getResolveFn } from './transport'
import { createInbox, ServerInfo } from './core'
import {
  multiAuthenticator,
  noAuthFn,
  tokenAuthenticator,
  usernamePasswordAuthenticator,
} from './authenticator'
import {
  Authenticator,
  ConnectionOptions,
  DEFAULT_HOST,
  ErrorCode,
  BellerophonError,
} from './core'

export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10
export const DEFAULT_JITTER = 100
export const DEFAULT_JITTER_TLS = 1000
// Ping interval
export const DEFAULT_PING_INTERVAL = 2 * 60 * 1000 // 2 minutes
export const DEFAULT_MAX_PING_OUT = 2

// DISCONNECT Parameters, 2 sec wait, 10 tries
export const DEFAULT_RECONNECT_TIME_WAIT = 2 * 1000

export function defaultOptions(): ConnectionOptions {
  return {
    maxPingOut: DEFAULT_MAX_PING_OUT,
    maxReconnectAttempts: DEFAULT_MAX_RECONNECT_ATTEMPTS,
    noRandomize: false,
    pedantic: false,
    pingInterval: DEFAULT_PING_INTERVAL,
    reconnect: true,
    reconnectJitter: DEFAULT_JITTER,
    reconnectJitterTLS: DEFAULT_JITTER_TLS,
    reconnectTimeWait: DEFAULT_RECONNECT_TIME_WAIT,
    tls: undefined,
    verbose: false,
    waitOnFirstConnect: false,
    ignoreAuthErrorAbort: false,
  } as ConnectionOptions
}

export function buildAuthenticator(opts: ConnectionOptions): Authenticator {
  const buf: Authenticator[] = []
  // jwtAuthenticator is created by the user, since it
  // will require possibly reading files which
  // some of the clients are simply unable to do
  if (typeof opts.authenticator === 'function') {
    buf.push(opts.authenticator)
  }
  if (Array.isArray(opts.authenticator)) {
    buf.push(...opts.authenticator)
  }
  if (opts.token) {
    buf.push(tokenAuthenticator(opts.token))
  }
  if (opts.user) {
    buf.push(usernamePasswordAuthenticator(opts.user, opts.pass))
  }
  return buf.length === 0 ? noAuthFn() : multiAuthenticator(buf)
}

export function parseOptions(opts?: ConnectionOptions): ConnectionOptions {
  const dhp = `${DEFAULT_HOST}:${defaultPort()}`
  opts = opts || { servers: [dhp] }
  opts.servers = opts.servers || []
  if (typeof opts.servers === 'string') {
    opts.servers = [opts.servers]
  }

  if (opts.servers.length > 0 && opts.port) {
    throw new BellerophonError(
      'port and servers options are mutually exclusive',
      ErrorCode.InvalidOption,
    )
  }

  if (opts.servers.length === 0 && opts.port) {
    opts.servers = [`${DEFAULT_HOST}:${opts.port}`]
  }
  if (opts.servers && opts.servers.length === 0) {
    opts.servers = [dhp]
  }
  const options = extend(defaultOptions(), opts)

  options.authenticator = buildAuthenticator(options)

  ;['reconnectDelayHandler', 'authenticator'].forEach(n => {
    if (options[n] && typeof options[n] !== 'function') {
      throw new BellerophonError(
        `${n} option should be a function`,
        ErrorCode.NotFunction,
      )
    }
  })

  if (!options.reconnectDelayHandler) {
    options.reconnectDelayHandler = () => {
      let extra = options.tls
        ? options.reconnectJitterTLS
        : options.reconnectJitter
      if (extra) {
        extra++
        extra = Math.floor(Math.random() * extra)
      }
      return options.reconnectTimeWait + extra
    }
  }

  if (options.inboxPrefix) {
    try {
      createInbox(options.inboxPrefix)
    } catch (err) {
      throw new BellerophonError(err.message, ErrorCode.ApiError)
    }
  }

  if (options.resolve) {
    if (typeof getResolveFn() !== 'function') {
      throw new BellerophonError(
        `'resolve' is not supported on this client`,
        ErrorCode.InvalidOption,
      )
    }
  }

  return options
}

export function checkOptions(info: ServerInfo, options: ConnectionOptions) {
  const { proto, tls_required: tlsRequired, tls_available: tlsAvailable } = info
  if ((proto === undefined || proto < 1) && options.noEcho) {
    throw new BellerophonError('noEcho', ErrorCode.ServerOptionNotAvailable)
  }
  const tls = tlsRequired || tlsAvailable || false
  if (options.tls && !tls) {
    throw new BellerophonError('tls', ErrorCode.ServerOptionNotAvailable)
  }
}

export function checkUnsupportedOption(prop: string, v?: string) {
  if (v) {
    throw new BellerophonError(prop, ErrorCode.InvalidOption)
  }
}
