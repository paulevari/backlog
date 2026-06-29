export interface ConnectionOptions {
  servers?: string | string[]
  port?: number
  authenticator?: Authenticator | Authenticator[]
  debug?: boolean
  maxPingOut?: number
  maxReconnectAttempts?: number
  name?: string
  noEcho?: boolean
  noRandomize?: boolean
  pass?: string
  pedantic?: boolean
  pingInterval?: number
  reconnect?: boolean
  reconnectDelayHandler?: () => number
  reconnectJitter?: number
  reconnectJitterTLS?: number
  reconnectTimeWait?: number
  timeout?: number
  tls?: TlsOptions | null
  token?: string
  user?: string
  verbose?: boolean
  waitOnFirstConnect?: boolean
  ignoreClusterUpdates?: boolean
  inboxPrefix?: string
}

export interface TlsOptions {
  certFile?: string
  cert?: string
  caFile?: string
  ca?: string
  keyFile?: string
  key?: string
}

export type Auth = NoAuth | TokenAuth | UserPass | BKeyAuth | JwtAuth
export type NoAuth = void
export interface TokenAuth {
  auth_token: string
}
export interface UserPass {
  user: string
  pass?: string
}
export interface BKeyAuth {
  bkey: string
  sig: string
}
export interface JwtAuth {
  jwt: string
  bkey?: string
  sig?: string
}

export interface Authenticator {
  (nonce?: string): Auth
}

export interface ServerInfo {
  server_id: string
  server_name: string
  version: string
}

export interface Msg {
  subject: string
  data: Uint8Array
  sid: number
  reply?: string
  headers?: MsgHdrs
}

export interface MsgHdrs extends Iterable<[string, string[]]> {
  has(key: string): boolean
  get(key: string): string | undefined
  set(key: string, value: string): void
  append(key: string, value: string): void
  delete(key: string): void
}

export interface Subscription {
  unsubscribe(max?: number): void
  drain(): Promise<void>
  isDraining(): boolean
  isClosed(): boolean
  callback?: (err: Error | null, msg: Msg) => void
  getSubject(): string
  getID(): number
  getMaxMessages(): number
}

export interface BConnection {
  info?: ServerInfo
  closed(): Promise<void | Error>
  close(): Promise<void>
  publish(subject: string, payload?: string | Uint8Array, options?: PublishOptions): void
  subscribe(subject: string, opts?: SubscriptionOptions): Subscription
  request(subject: string, payload?: string | Uint8Array, opts?: RequestOptions): Promise<Msg>
  flush(): Promise<void>
  bstream(opts?: BStreamOptions): BStreamClient
}

export interface PublishOptions {
  reply?: string
  headers?: MsgHdrs
}

export interface SubscriptionOptions {
  queue?: string
  max?: number
  timeout?: number
  callback?: (err: Error | null, msg: Msg) => void
}

export interface RequestOptions {
  timeout?: number
  headers?: MsgHdrs
  noMux?: boolean
  reply?: string
}

// ============================================================================
// BStream Types
// ============================================================================

export type Payload = Uint8Array | string

/**
 * Async iterator that can be stopped.
 */
export interface QueuedIterator<T> extends AsyncIterable<T> {
  stop(err?: Error): void
}

/**
 * An entry in a KV store.
 */
export interface KvEntry {
  bucket: string
  key: string
  value: Uint8Array
  created: Date
  revision: number
  delta?: number
  operation: 'PUT' | 'DEL' | 'PURGE'
  length: number
  json<T>(): T
  string(): string
}

/**
 * Status information for a KV store.
 */
export interface KvStatus {
  bucket: string
  values: number
  history: number
  ttl: number
  streamInfo: unknown
}

/**
 * Options for opening a KV store.
 */
export interface KvOptions {
  history?: number
  replicas?: number
  timeout?: number
  bindOnly?: boolean
  streamName?: string
}

/**
 * Options for watching a KV store.
 */
export interface KvWatchOptions {
  key?: string
  headers_only?: boolean
  ignoreDeletes?: boolean
}

/**
 * A BStream KV store.
 */
export interface KV {
  get(k: string, opts?: { revision: number }): Promise<KvEntry | null>
  create(k: string, data: Payload): Promise<number>
  update(k: string, data: Payload, version: number): Promise<number>
  put(k: string, data: Payload): Promise<number>
  delete(k: string): Promise<void>
  purge(k: string): Promise<void>
  keys(filter?: string): Promise<QueuedIterator<string>>
  watch(opts?: KvWatchOptions): Promise<QueuedIterator<KvEntry>>
  history(opts?: { key?: string }): Promise<QueuedIterator<KvEntry>>
  status(): Promise<KvStatus>
  destroy(): Promise<boolean>
}

/**
 * Materialized views onto BStream data.
 */
export interface Views {
  kv(name: string, opts?: Partial<KvOptions>): Promise<KV>
  os(name: string, opts?: Partial<KvOptions>): Promise<any>
}

/**
 * Options for creating a BStream client.
 */
export interface BStreamOptions {
  apiPrefix?: string
  timeout?: number
  domain?: string
}

/**
 * PubAck response from publishing to a stream.
 */
export interface PubAck {
  stream: string
  domain?: string
  seq: number
  duplicate: boolean
}

/**
 * Stream management API.
 */
export interface StreamAPI {
  info(stream: string): Promise<unknown>
  add(cfg: unknown): Promise<unknown>
  update(name: string, cfg: unknown): Promise<unknown>
  delete(stream: string): Promise<boolean>
  list(): unknown
  get(name: string): Promise<unknown>
}

/**
 * Consumer management API.
 */
export interface ConsumerAPI {
  add(cfg: unknown): Promise<unknown>
  info(name: string): Promise<unknown>
  delete(name: string): Promise<boolean>
  list(): unknown
}

/**
 * BStream manager for streams and consumers.
 */
export interface BStreamManager {
  streams: StreamAPI
  consumers: ConsumerAPI
  getAccountInfo(): Promise<unknown>
  bstream(): BStreamClient
}

/**
 * Stream object.
 */
export interface Stream {
  name: string
  info(): Promise<unknown>
  getConsumer(name?: string): Promise<unknown>
}

/**
 * Consumer object.
 */
export interface Consumer {
  info(): Promise<unknown>
}

/**
 * BStream client for publishing and consuming.
 */
export interface BStreamClient {
  publish(subj: string, payload?: Payload, options?: unknown): Promise<PubAck>
  views: Views
  consumers: { get(stream: string, name?: string): Promise<Consumer> }
  streams: { get(name: string): Promise<Stream> }
  bstreamManager(): Promise<BStreamManager>
}

// ============================================================================
// Consumer Configuration Types
// ============================================================================

/**
 * Nanosecond time value.
 */
export type Nanos = number

/**
 * Convert milliseconds to nanoseconds.
 */
export function nanos(millis: number): Nanos

/**
 * Consumer acknowledgement policy.
 */
export enum AckPolicy {
  None = 'none',
  All = 'all',
  Explicit = 'explicit',
  NotSet = '',
}

/**
 * Consumer message delivery policy.
 */
export enum DeliverPolicy {
  All = 'all',
  Last = 'last',
  New = 'new',
  StartSequence = 'by_start_sequence',
  StartTime = 'by_start_time',
  LastPerSubject = 'last_per_subject',
}

// ============================================================================

export function connect(opts?: ConnectionOptions): Promise<BConnection>
export function credsAuthenticator(creds: Uint8Array | (() => Uint8Array)): Authenticator
export function jwtAuthenticator(ajwt: string | (() => string), seed: string | Uint8Array): Authenticator
export function bkeyAuthenticator(seed: string | Uint8Array): Authenticator

// Re-exports from lib/sdk/mod via index.ts (added to fix stale d.ts).
export const ServiceErrorHeader: string
export const ServiceErrorCodeHeader: string
export enum RequestStrategy {
  Timer = 'timer',
  SentinelMsg = 'sentinel-msg',
}
export class ServiceError extends Error {
  static isServiceError(msg: Msg): boolean
  static toServiceError(msg: Msg): ServiceError | null
}
