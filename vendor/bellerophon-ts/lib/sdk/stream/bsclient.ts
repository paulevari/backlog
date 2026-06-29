import {
  BConnection,
  BStreamOptions,
  BStreamManagerOptions,
  Payload,
  RequestOptions,
  Msg,
  BellerophonError,
  ErrorCode,
  QueuedIterator,
  createInbox,
  isBellerophonError,
} from '../core'
import { headers } from '../headers'
import { IdleHeartbeatMonitor } from '../idleheartbeat_monitor'
import { Bucket } from '../internal_mod'
import { SubscriptionImpl } from '../protocol'
import {
  QueuedIteratorImpl,
  IngestionFilterFn,
  IngestionFilterFnResult,
} from '../queued_iterator'
import { Feature } from '../semver'
import {
  TypedSubscriptionOptions,
  TypedSubscription,
  MsgAdapter,
} from '../typedsub'
import { Empty } from '../types'
import { Timeout, timeout, delay } from '../util'
import {
  PullOptions,
  AckPolicy,
  ConsumerConfig,
  DeliverPolicy,
  ReplayPolicy,
  CreateConsumerRequest,
  ConsumerInfo,
} from './bsapi_types'
import { BaseApiClient } from './bsbaseclient_api'
import { ConsumerAPI, ConsumerAPIImpl } from './bsmconsumer_api'
import { BsMsg, toBsMsg, BsMsgImpl } from './bsmsg'
import { StreamAPIImpl, ConsumersImpl, StreamsImpl } from './bsmstream_api'
import {
  validateStreamName,
  validateDurableName,
  nanos,
  checkBsError,
  isHeartbeatMsg,
  Bs409Errors,
  isFlowControlMsg,
  millis,
  newBsErrorMsg,
  isTerminal409,
} from './bsutil'
import { ObjectStoreImpl } from './objectstore'
import {
  Views,
  BStreamManager,
  KvOptions,
  KV,
  ObjectStoreOptions,
  ObjectStore,
  BStreamClient,
  Consumers,
  Streams,
  BStreamPublishOptions,
  PubAck,
  ConsumerOptsBuilder,
  ConsumerOpts,
  consumerOpts,
  BStreamPullSubscription,
  BStreamSubscription,
  BStreamSubscriptionInfo,
  isConsumerOptsBuilder,
  BStreamSubscriptionInfoable,
  Destroyable,
  ConsumerInfoable,
  BStreamSubscriptionOptions,
  BsHeaders,
  Pullable,
} from './types'

export enum PubHeaders {
  MsgIdHdr = 'Evari-Msg-Id',
  ExpectedStreamHdr = 'Evari-Expected-Stream',
  ExpectedLastSeqHdr = 'Evari-Expected-Last-Sequence',
  ExpectedLastMsgIdHdr = 'Evari-Expected-Last-Msg-Id',
  ExpectedLastSubjectSequenceHdr = 'Evari-Expected-Last-Subject-Sequence',
}

class ViewsImpl implements Views {
  bs: BStreamClientImpl
  bsm?: BStreamManager
  constructor(bs: BStreamClientImpl) {
    this.bs = bs
  }
  kv(name: string, opts: Partial<KvOptions> = {}): Promise<KV> {
    const bsi = this.bs as BStreamClientImpl
    const { ok, min } = bsi.bc.features.get(Feature.BS_KV)
    if (!ok) {
      return Promise.reject(
        new Error(`kv is only supported on bellerophon ${min} or better`),
      )
    }
    if (opts.bindOnly) {
      return Bucket.bind(this.bs, name)
    }

    return Bucket.create(this.bs, name, opts)
  }
  os(
    name: string,
    opts: Partial<ObjectStoreOptions> = {},
  ): Promise<ObjectStore> {
    if (typeof crypto?.subtle?.digest !== 'function') {
      return Promise.reject(
        new Error(
          'objectstore: unable to calculate hashes - crypto.subtle.digest with sha256 support is required',
        ),
      )
    }
    const bsi = this.bs as BStreamClientImpl
    const { ok, min } = bsi.bc.features.get(Feature.BS_OBJECTSTORE)
    if (!ok) {
      return Promise.reject(
        new Error(
          `objectstore is only supported on bellerophon ${min} or better`,
        ),
      )
    }
    return ObjectStoreImpl.create(this.bs, name, opts)
  }
}

export class BStreamClientImpl extends BaseApiClient implements BStreamClient {
  consumers: Consumers
  streams: Streams
  consumerAPI: ConsumerAPI
  streamAPI: StreamAPIImpl
  constructor(nc: BConnection, opts?: BStreamOptions) {
    super(nc, opts)
    this.consumerAPI = new ConsumerAPIImpl(nc, opts)
    this.streamAPI = new StreamAPIImpl(nc, opts)
    this.consumers = new ConsumersImpl(this.consumerAPI)
    this.streams = new StreamsImpl(this.streamAPI)
  }

  bstreamManager(checkAPI?: boolean): Promise<BStreamManager> {
    const opts = Object.assign({ checkAPI }, this.opts) as BStreamManagerOptions
    return this.bc.bstreamManager(opts)
  }

  get apiPrefix(): string {
    return this.prefix
  }

  get views(): Views {
    return new ViewsImpl(this)
  }

  async publish(
    subj: string,
    data: Payload = Empty,
    opts?: Partial<BStreamPublishOptions>,
  ): Promise<PubAck> {
    opts = opts || {}
    opts.expect = opts.expect || {}
    const mh = opts?.headers || headers()
    if (opts) {
      if (opts.msgID) {
        mh.set(PubHeaders.MsgIdHdr, opts.msgID)
      }
      if (opts.expect.lastMsgID) {
        mh.set(PubHeaders.ExpectedLastMsgIdHdr, opts.expect.lastMsgID)
      }
      if (opts.expect.streamName) {
        mh.set(PubHeaders.ExpectedStreamHdr, opts.expect.streamName)
      }
      if (typeof opts.expect.lastSequence === 'number') {
        mh.set(PubHeaders.ExpectedLastSeqHdr, `${opts.expect.lastSequence}`)
      }
      if (typeof opts.expect.lastSubjectSequence === 'number') {
        mh.set(
          PubHeaders.ExpectedLastSubjectSequenceHdr,
          `${opts.expect.lastSubjectSequence}`,
        )
      }
    }

    const to = opts.timeout || this.timeout
    const ro = {} as RequestOptions
    if (to) {
      ro.timeout = to
    }
    if (opts) {
      ro.headers = mh
    }

    let { retries, retry_delay } = opts as {
      retries: number
      retry_delay: number
    }
    retries = retries || 1
    retry_delay = retry_delay || 250

    let r: Msg
    for (let i = 0; i < retries; i++) {
      try {
        r = await this.bc.request(subj, data, ro)
        // if here we succeeded
        break
      } catch (err) {
        const ne = err as BellerophonError
        if (ne.code === '503' && i + 1 < retries) {
          await delay(retry_delay)
        } else {
          throw err
        }
      }
    }
    const pa = this.parseBsResponse(r!) as PubAck
    if (pa.stream === '') {
      throw BellerophonError.errorForCode(ErrorCode.BStreamInvalidAck)
    }
    pa.duplicate = pa.duplicate ? pa.duplicate : false
    return pa
  }

  async pull(stream: string, durable: string, expires = 0): Promise<BsMsg> {
    validateStreamName(stream)
    validateDurableName(durable)

    let timeout = this.timeout
    if (expires > timeout) {
      timeout = expires
    }

    expires = expires < 0 ? 0 : nanos(expires)
    const pullOpts: Partial<PullOptions> = {
      batch: 1,
      no_wait: expires === 0,
      expires,
    }

    const msg = await this.bc.request(
      `${this.prefix}.CONSUMER.MSG.NEXT.${stream}.${durable}`,
      this.jc.encode(pullOpts),
      { noMux: true, timeout },
    )
    const err = checkBsError(msg)
    if (err) {
      throw err
    }
    return toBsMsg(msg)
  }

  /*
   * Returns available messages upto specified batch count.
   * If expires is set the iterator will wait for the specified
   * amount of millis before closing the subscription.
   * If no_wait is specified, the iterator will return no messages.
   * @param stream
   * @param durable
   * @param opts
   */
  fetch(
    stream: string,
    durable: string,
    opts: Partial<PullOptions> = {},
  ): QueuedIterator<BsMsg> {
    validateStreamName(stream)
    validateDurableName(durable)

    let timer: Timeout<void> | null = null
    const trackBytes = (opts.max_bytes ?? 0) > 0
    let receivedBytes = 0
    const max_bytes = trackBytes ? opts.max_bytes! : 0
    let monitor: IdleHeartbeatMonitor | null = null

    const args: Partial<PullOptions> = {}
    args.batch = opts.batch || 1
    if (max_bytes) {
      const fv = this.bc.features.get(Feature.BS_PULL_MAX_BYTES)
      if (!fv.ok) {
        throw new Error(
          `max_bytes is only supported on bellerophon ${fv.min} or better`,
        )
      }
      args.max_bytes = max_bytes
    }
    args.no_wait = opts.no_wait || false
    if (args.no_wait && args.expires) {
      args.expires = 0
    }
    const expires = opts.expires || 0
    if (expires) {
      args.expires = nanos(expires)
    }
    if (expires === 0 && args.no_wait === false) {
      throw new Error('expires or no_wait is required')
    }
    const hb = opts.idle_heartbeat || 0
    if (hb) {
      args.idle_heartbeat = nanos(hb)
      //@ts-ignore: for testing
      if (opts.delay_heartbeat === true) {
        //@ts-ignore: test option
        args.idle_heartbeat = nanos(hb * 4)
      }
    }

    const qi = new QueuedIteratorImpl<BsMsg>()
    const wants = args.batch
    let received = 0
    qi.protocolFilterFn = (jm, _ingest = false): boolean => {
      const bsmi = jm as BsMsgImpl
      if (isHeartbeatMsg(bsmi.msg)) {
        monitor?.work()
        return false
      }
      return true
    }
    // FIXME: this looks weird, we want to stop the iterator
    //   but doing it from a dispatchedFn...
    qi.dispatchedFn = (m: BsMsg | null) => {
      if (m) {
        if (trackBytes) {
          receivedBytes += m.data.length
        }
        received++
        if (timer && m.info.pending === 0) {
          // the expiration will close it
          return
        }
        // if we have one pending and we got the expected
        // or there are no more stop the iterator
        if (
          (qi.getPending() === 1 && m.info.pending === 0) ||
          wants === received ||
          (max_bytes > 0 && receivedBytes >= max_bytes)
        ) {
          qi.stop()
        }
      }
    }

    const inbox = createInbox(this.bc.options.inboxPrefix)
    const sub = this.bc.subscribe(inbox, {
      max: opts.batch,
      callback: (err: Error | null, msg) => {
        if (err === null) {
          err = checkBsError(msg)
        }
        if (err !== null) {
          if (timer) {
            timer.cancel()
            timer = null
          }
          if (isBellerophonError(err)) {
            qi.stop(hideNonTerminalBsErrors(err) === null ? undefined : err)
          } else {
            qi.stop(err)
          }
        } else {
          // if we are doing heartbeats, message resets
          monitor?.work()
          qi.received++
          qi.push(toBsMsg(msg))
        }
      },
    })

    // timer on the client  the issue is that the request
    // is started on the client, which means that it will expire
    // on the client first
    if (expires) {
      timer = timeout<void>(expires)
      timer.catch(() => {
        if (!sub.isClosed()) {
          sub.drain().catch(() => {})
          timer = null
        }
        if (monitor) {
          monitor.cancel()
        }
      })
    }

    ;(async () => {
      try {
        if (hb) {
          monitor = new IdleHeartbeatMonitor(hb, (v: number): boolean => {
            //@ts-ignore: pushing a fn
            qi.push(() => {
              // this will terminate the iterator
              qi.err = new BellerophonError(
                `${Bs409Errors.IdleHeartbeatMissed}: ${v}`,
                ErrorCode.BStreamIdleHeartBeat,
              )
            })
            return true
          })
        }
      } catch (_err) {
        // ignore it
      }

      // close the iterator if the connection or subscription closes unexpectedly
      await (sub as SubscriptionImpl).closed
      if (timer !== null) {
        timer.cancel()
        timer = null
      }
      if (monitor) {
        monitor.cancel()
      }
      qi.stop()
    })().catch()

    this.bc.publish(
      `${this.prefix}.CONSUMER.MSG.NEXT.${stream}.${durable}`,
      this.jc.encode(args),
      { reply: inbox },
    )
    return qi
  }

  async pullSubscribe(
    subject: string,
    opts: ConsumerOptsBuilder | Partial<ConsumerOpts> = consumerOpts(),
  ): Promise<BStreamPullSubscription> {
    const cso = await this._processOptions(subject, opts)
    if (cso.ordered) {
      throw new Error('pull subscribers cannot be be ordered')
    }
    if (cso.config.deliver_subject) {
      throw new Error(
        'consumer info specifies deliver_subject - pull consumers cannot have deliver_subject set',
      )
    }

    const ackPolicy = cso.config.ack_policy
    if (ackPolicy === AckPolicy.None || ackPolicy === AckPolicy.All) {
      throw new Error('ack policy for pull consumers must be explicit')
    }

    const so = this._buildTypedSubscriptionOpts(cso)
    const sub = new BStreamPullSubscriptionImpl(this, cso.deliver, so)
    sub.info = cso

    try {
      await this._maybeCreateConsumer(cso)
    } catch (err) {
      sub.unsubscribe()
      throw err
    }
    return sub as BStreamPullSubscription
  }

  async subscribe(
    subject: string,
    opts: ConsumerOptsBuilder | Partial<ConsumerOpts> = consumerOpts(),
  ): Promise<BStreamSubscription> {
    const cso = await this._processOptions(subject, opts)
    // this effectively requires deliver subject to be specified
    // as an option otherwise we have a pull consumer
    if (!cso.isBind && !cso.config.deliver_subject) {
      throw new Error('push consumer requires deliver_subject')
    }

    const so = this._buildTypedSubscriptionOpts(cso)
    const sub = new BStreamSubscriptionImpl(this, cso.deliver, so)
    sub.info = cso
    try {
      await this._maybeCreateConsumer(cso)
    } catch (err) {
      sub.unsubscribe()
      throw err
    }

    sub._maybeSetupHbMonitoring()

    return sub
  }

  async _processOptions(
    subject: string,
    opts: ConsumerOptsBuilder | Partial<ConsumerOpts> = consumerOpts(),
  ): Promise<BStreamSubscriptionInfo> {
    const bsi = (
      isConsumerOptsBuilder(opts) ? opts.getOpts() : opts
    ) as BStreamSubscriptionInfo
    bsi.isBind = isConsumerOptsBuilder(opts) ? opts.isBind : false
    bsi.flow_control = {
      heartbeat_count: 0,
      fc_count: 0,
      consumer_restarts: 0,
    }
    if (bsi.ordered) {
      bsi.ordered_consumer_sequence = { stream_seq: 0, delivery_seq: 0 }
      if (
        bsi.config.ack_policy !== AckPolicy.NotSet &&
        bsi.config.ack_policy !== AckPolicy.None
      ) {
        throw new BellerophonError(
          "ordered consumer: ack_policy can only be set to 'none'",
          ErrorCode.ApiError,
        )
      }
      if (bsi.config.durable_name && bsi.config.durable_name.length > 0) {
        throw new BellerophonError(
          'ordered consumer: durable_name cannot be set',
          ErrorCode.ApiError,
        )
      }
      if (bsi.config.deliver_subject && bsi.config.deliver_subject.length > 0) {
        throw new BellerophonError(
          'ordered consumer: deliver_subject cannot be set',
          ErrorCode.ApiError,
        )
      }
      if (bsi.config.max_deliver !== undefined && bsi.config.max_deliver > 1) {
        throw new BellerophonError(
          'ordered consumer: max_deliver cannot be set',
          ErrorCode.ApiError,
        )
      }
      if (bsi.config.deliver_group && bsi.config.deliver_group.length > 0) {
        throw new BellerophonError(
          'ordered consumer: deliver_group cannot be set',
          ErrorCode.ApiError,
        )
      }
      bsi.config.deliver_subject = createInbox(this.bc.options.inboxPrefix)
      bsi.config.ack_policy = AckPolicy.None
      bsi.config.max_deliver = 1
      bsi.config.flow_control = true
      bsi.config.idle_heartbeat = bsi.config.idle_heartbeat || nanos(5000)
      bsi.config.ack_wait = nanos(22 * 60 * 60 * 1000)
      bsi.config.mem_storage = true
      bsi.config.num_replicas = 1
    }

    if (bsi.config.ack_policy === AckPolicy.NotSet) {
      bsi.config.ack_policy = AckPolicy.All
    }

    bsi.api = this
    bsi.config = bsi.config || ({} as ConsumerConfig)
    bsi.stream = bsi.stream ? bsi.stream : await this.findStream(subject)

    bsi.attached = false
    if (bsi.config.durable_name) {
      try {
        const info = await this.consumerAPI.info(
          bsi.stream,
          bsi.config.durable_name,
        )
        if (info) {
          if (
            info.config.filter_subject &&
            info.config.filter_subject !== subject
          ) {
            throw new Error('subject does not match consumer')
          }
          // check if server returned push_bound, but there's no qn
          const qn = bsi.config.deliver_group ?? ''
          if (qn === '' && info.push_bound === true) {
            throw new Error(`duplicate subscription`)
          }

          const rqn = info.config.deliver_group ?? ''
          if (qn !== rqn) {
            if (rqn === '') {
              throw new Error(`durable requires no queue group`)
            } else {
              throw new Error(`durable requires queue group '${rqn}'`)
            }
          }
          bsi.last = info
          bsi.config = info.config
          bsi.attached = true
          // if not a durable capture the name of the ephemeral so
          // that consumerInfo from the sub will work
          if (!bsi.config.durable_name) {
            bsi.name = info.name
          }
        }
      } catch (err) {
        //consumer doesn't exist
        if (err.code !== '404') {
          throw err
        }
      }
    }

    if (
      !bsi.attached &&
      bsi.config.filter_subject === undefined &&
      bsi.config.filter_subjects === undefined
    ) {
      // if no filter specified, we set the subject as the filter
      bsi.config.filter_subject = subject
    }

    bsi.deliver =
      bsi.config.deliver_subject || createInbox(this.bc.options.inboxPrefix)

    return bsi
  }

  _buildTypedSubscriptionOpts(
    bsi: BStreamSubscriptionInfo,
  ): TypedSubscriptionOptions<BsMsg> {
    const so = {} as TypedSubscriptionOptions<BsMsg>
    so.adapter = msgAdapter(bsi.callbackFn === undefined)
    so.ingestionFilterFn = BStreamClientImpl.ingestionFn(bsi.ordered)
    so.protocolFilterFn = (bm, ingest = false): boolean => {
      const bsmi = bm as BsMsgImpl
      if (isFlowControlMsg(bsmi.msg)) {
        if (!ingest) {
          bsmi.msg.respond()
        }
        return false
      }
      return true
    }
    if (!bsi.mack && bsi.config.ack_policy !== AckPolicy.None) {
      so.dispatchedFn = autoAckBsMsg
    }
    if (bsi.callbackFn) {
      so.callback = bsi.callbackFn
    }

    so.max = bsi.max || 0
    so.queue = bsi.queue
    return so
  }

  async _maybeCreateConsumer(bsi: BStreamSubscriptionInfo): Promise<void> {
    if (bsi.attached) {
      return
    }
    if (bsi.isBind) {
      throw new Error(
        `unable to bind - durable consumer ${bsi.config.durable_name} doesn't exist in ${bsi.stream}`,
      )
    }
    bsi.config = Object.assign(
      {
        deliver_policy: DeliverPolicy.All,
        ack_policy: AckPolicy.Explicit,
        ack_wait: nanos(30 * 1000),
        replay_policy: ReplayPolicy.Instant,
      },
      bsi.config,
    )

    const ci = await this.consumerAPI.add(bsi.stream, bsi.config)
    if (
      Array.isArray(
        bsi.config.filter_subjects && !Array.isArray(ci.config.filter_subjects),
      )
    ) {
      // server didn't honor `filter_subjects` (lightweight leaf nodes)
      throw new Error(
        `Bellerophon server doesn't support consumers with multiple filter subjects`,
      )
    }
    bsi.name = ci.name
    bsi.config = ci.config
    bsi.last = ci
  }

  static ingestionFn(ordered: boolean): IngestionFilterFn<BsMsg> {
    return (bm: BsMsg | null, ctx?: unknown): IngestionFilterFnResult => {
      // ctx is expected to be the iterator (the BStreamSubscriptionImpl)
      const bsub = ctx as BStreamSubscriptionImpl

      // this shouldn't happen
      if (!bm) return { ingest: false, protocol: false }

      const bmi = bm as BsMsgImpl
      if (!checkBsError(bmi.msg)) {
        bsub.monitor?.work()
      }
      if (isHeartbeatMsg(bmi.msg)) {
        const ingest = ordered ? bsub._checkHbOrderConsumer(bmi.msg) : true
        if (!ordered) {
          bsub!.info!.flow_control.heartbeat_count++
        }
        return { ingest, protocol: true }
      } else if (isFlowControlMsg(bmi.msg)) {
        bsub!.info!.flow_control.fc_count++
        return { ingest: true, protocol: true }
      }
      const ingest = ordered ? bsub._checkOrderedConsumer(bm) : true
      return { ingest, protocol: false }
    }
  }
}

export class BStreamSubscriptionImpl
  extends TypedSubscription<BsMsg>
  implements BStreamSubscriptionInfoable, Destroyable, ConsumerInfoable
{
  bs: BaseApiClient
  monitor: IdleHeartbeatMonitor | null

  constructor(
    bs: BaseApiClient,
    subject: string,
    opts: BStreamSubscriptionOptions,
  ) {
    super(bs.bc, subject, opts)
    this.bs = bs
    this.monitor = null

    this.sub.closed.then(() => {
      if (this.monitor) {
        this.monitor.cancel()
      }
    })
  }

  set info(info: BStreamSubscriptionInfo | null) {
    ;(this.sub as SubscriptionImpl).info = info
  }

  get info(): BStreamSubscriptionInfo | null {
    return this.sub.info as BStreamSubscriptionInfo
  }

  _resetOrderedConsumer(sseq: number): void {
    if (this.info === null || this.sub.isClosed()) {
      return
    }
    const newDeliver = createInbox(this.bs.bc.options.inboxPrefix)
    const nci = this.bs.bc
    nci._resub(this.sub, newDeliver)
    const info = this.info
    info.ordered_consumer_sequence.delivery_seq = 0
    info.flow_control.heartbeat_count = 0
    info.flow_control.fc_count = 0
    info.flow_control.consumer_restarts++
    info.deliver = newDeliver
    info.config.deliver_subject = newDeliver
    info.config.deliver_policy = DeliverPolicy.StartSequence
    info.config.opt_start_seq = sseq
    // put the stream name
    const req = {} as CreateConsumerRequest
    req.stream_name = this.info.stream
    req.config = info.config

    const subj = `${info.api.prefix}.CONSUMER.CREATE.${info.stream}`

    this.bs
      ._request(subj, req)
      .then(v => {
        const ci = v as ConsumerInfo
        this.info!.config = ci.config
        this.info!.name = ci.name
      })
      .catch(err => {
        // to inform the subscription we inject an error this will
        // be at after the last message if using an iterator.
        const nerr = new BellerophonError(
          `unable to recreate ordered consumer ${info.stream} at seq ${sseq}`,
          ErrorCode.RequestError,
          err,
        )
        this.sub.callback(nerr, {} as Msg)
      })
  }

  // this is called by push subscriptions, to initialize the monitoring
  // if configured on the consumer
  _maybeSetupHbMonitoring() {
    const ns = this.info?.config?.idle_heartbeat || 0
    if (ns) {
      this._setupHbMonitoring(millis(ns))
    }
  }

  _setupHbMonitoring(millis: number, cancelAfter = 0) {
    const opts = { cancelAfter: 0, maxOut: 2 }
    if (cancelAfter) {
      opts.cancelAfter = cancelAfter
    }
    const sub = this.sub as SubscriptionImpl
    const handler = (v: number): boolean => {
      const msg = newBsErrorMsg(
        409,
        `${Bs409Errors.IdleHeartbeatMissed}: ${v}`,
        this.sub.subject,
      )
      const ordered = this.info?.ordered
      // non-ordered consumers are always notified of the condition
      // as they need to try and recover
      if (!ordered) {
        this.sub.callback(null, msg)
      } else {
        if (!this.bs.bc.protocol.connected) {
          // we are not connected don't do anything
          return false
        }
        // reset the consumer
        const seq = this.info?.ordered_consumer_sequence?.stream_seq || 0
        this._resetOrderedConsumer(seq + 1)
        // if we are ordered, we will reset the consumer and keep
        // feeding the iterator or callback - we are not stopping
        return false
      }
      // let the hb monitor know if we are stopping for callbacks
      // we don't as we deliver the errors via the cb.
      return !sub.noIterator
    }
    // this only applies for push subscriptions
    this.monitor = new IdleHeartbeatMonitor(millis, handler, opts)
  }

  _checkHbOrderConsumer(msg: Msg): boolean {
    const rm = msg.headers!.get(BsHeaders.ConsumerStalledHdr)
    if (rm !== '') {
      const nci = this.bs.bc
      nci.publish(rm)
    }
    const lastDelivered = parseInt(
      msg.headers!.get(BsHeaders.LastConsumerSeqHdr),
      10,
    )
    const ordered = this.info!.ordered_consumer_sequence
    this.info!.flow_control.heartbeat_count++
    if (lastDelivered !== ordered.delivery_seq) {
      this._resetOrderedConsumer(ordered.stream_seq + 1)
    }
    return false
  }

  _checkOrderedConsumer(jm: BsMsg): boolean {
    const ordered = this.info!.ordered_consumer_sequence
    const sseq = jm.info.streamSequence
    const dseq = jm.info.deliverySequence
    if (dseq != ordered.delivery_seq + 1) {
      this._resetOrderedConsumer(ordered.stream_seq + 1)
      return false
    }
    ordered.delivery_seq = dseq
    ordered.stream_seq = sseq
    return true
  }

  async destroy(): Promise<void> {
    if (!this.isClosed()) {
      await this.drain()
    }
    const binfo = this.sub.info as BStreamSubscriptionInfo
    const name = binfo.config.durable_name || binfo.name
    const subj = `${binfo.api.prefix}.CONSUMER.DELETE.${binfo.stream}.${name}`
    await binfo.api._request(subj)
  }

  async consumerInfo(): Promise<ConsumerInfo> {
    const binfo = this.sub.info as BStreamSubscriptionInfo
    const name = binfo.config.durable_name || binfo.name
    const subj = `${binfo.api.prefix}.CONSUMER.INFO.${binfo.stream}.${name}`
    const ci = (await binfo.api._request(subj)) as ConsumerInfo
    binfo.last = ci
    return ci
  }
}

class BStreamPullSubscriptionImpl
  extends BStreamSubscriptionImpl
  implements Pullable
{
  constructor(
    bs: BaseApiClient,
    subject: string,
    opts: TypedSubscriptionOptions<BsMsg>,
  ) {
    super(bs, subject, opts)
  }
  pull(opts: Partial<PullOptions> = { batch: 1 }): void {
    const { stream, config, name } = this.sub.info as BStreamSubscriptionInfo
    const consumer = config.durable_name ?? name
    const args: Partial<PullOptions> = {}
    args.batch = opts.batch || 1
    args.no_wait = opts.no_wait || false
    if ((opts.max_bytes ?? 0) > 0) {
      const fv = this.bs.bc.features.get(Feature.BS_PULL_MAX_BYTES)
      if (!fv.ok) {
        throw new Error(
          `max_bytes is only supported on bellerophon ${fv.min} or better`,
        )
      }
      args.max_bytes = opts.max_bytes!
    }

    let expires = 0
    if (opts.expires && opts.expires > 0) {
      expires = opts.expires
      args.expires = nanos(expires)
    }

    let hb = 0
    if (opts.idle_heartbeat && opts.idle_heartbeat > 0) {
      hb = opts.idle_heartbeat
      args.idle_heartbeat = nanos(hb)
    }

    if (hb && expires === 0) {
      throw new Error('idle_heartbeat requires expires')
    }
    if (hb > expires) {
      throw new Error('expires must be greater than idle_heartbeat')
    }

    if (this.info) {
      if (this.monitor) {
        this.monitor.cancel()
      }
      if (expires && hb) {
        if (!this.monitor) {
          this._setupHbMonitoring(hb, expires)
        } else {
          this.monitor._change(hb, expires)
        }
      }

      const api = this.info.api as BaseApiClient
      const subj = `${api.prefix}.CONSUMER.MSG.NEXT.${stream}.${consumer}`
      const reply = this.sub.subject

      api.bc.publish(subj, api.jc.encode(args), { reply: reply })
    }
  }
}

function msgAdapter(iterator: boolean): MsgAdapter<BsMsg> {
  if (iterator) {
    return iterMsgAdapter
  } else {
    return cbMsgAdapter
  }
}

function cbMsgAdapter(
  err: BellerophonError | null,
  msg: Msg,
): [BellerophonError | null, BsMsg | null] {
  if (err) {
    return [err, null]
  }
  err = checkBsError(msg)
  if (err) {
    return [err, null]
  }
  // assuming that the protocolFilterFn is set!
  return [null, toBsMsg(msg)]
}

function iterMsgAdapter(
  err: BellerophonError | null,
  msg: Msg,
): [BellerophonError | null, BsMsg | null] {
  if (err) {
    return [err, null]
  }
  // iterator will close if we have an error
  // check for errors that shouldn't close it
  const ne = checkBsError(msg)
  if (ne !== null) {
    return [hideNonTerminalBsErrors(ne), null]
  }
  // assuming that the protocolFilterFn is set
  return [null, toBsMsg(msg)]
}

function hideNonTerminalBsErrors(
  ne: BellerophonError,
): BellerophonError | null {
  if (ne !== null) {
    switch (ne.code) {
      case ErrorCode.BStream404NoMessages:
      case ErrorCode.BStream408RequestTimeout:
        return null
      case ErrorCode.BStream409:
        if (isTerminal409(ne)) {
          return ne
        }
        return null
      default:
        return ne
    }
  }
  return null
}

function autoAckBsMsg(data: BsMsg | null) {
  if (data) {
    data.ack()
  }
}
