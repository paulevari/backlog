export type SemVer = { major: number; minor: number; micro: number }
export function parseSemVer(s = ''): SemVer {
  const m = s.match(/(\d+).(\d+).(\d+)/)
  if (m) {
    return {
      major: parseInt(m[1]),
      minor: parseInt(m[2]),
      micro: parseInt(m[3]),
    }
  }
  throw new Error(`'${s}' is not a semver value`)
}
export function compare(a: SemVer, b: SemVer): number {
  if (a.major < b.major) return -1
  if (a.major > b.major) return 1
  if (a.minor < b.minor) return -1
  if (a.minor > b.minor) return 1
  if (a.micro < b.micro) return -1
  if (a.micro > b.micro) return 1
  return 0
}

export enum Feature {
  BS_KV = 'bs_kv',
  BS_OBJECTSTORE = 'bs_objectstore',
  BS_PULL_MAX_BYTES = 'bs_pull_max_bytes',
  BS_NEW_CONSUMER_CREATE_API = 'bs_new_consumer_create',
  BS_ALLOW_DIRECT = 'bs_allow_direct',
  BS_MULTIPLE_CONSUMER_FILTER = 'bs_multiple_consumer_filter',
  BS_SIMPLIFICATION = 'bs_simplification',
  BS_STREAM_CONSUMER_METADATA = 'bs_stream_consumer_metadata',
  BS_CONSUMER_FILTER_SUBJECTS = 'bs_consumer_filter_subjects',
  BS_STREAM_FIRST_SEQ = 'bs_stream_first_seq',
  BS_STREAM_SUBJECT_TRANSFORM = 'bs_stream_subject_transform',
  BS_STREAM_SOURCE_SUBJECT_TRANSFORM = 'bs_stream_source_subject_transform',
  BS_STREAM_COMPRESSION = 'bs_stream_compression',
  BS_DEFAULT_CONSUMER_LIMITS = 'bs_default_consumer_limits',
  BS_BATCH_DIRECT_GET = 'bs_batch_direct_get',
}

type FeatureVersion = {
  ok: boolean
  min: string
}

export class Features {
  server!: SemVer
  features: Map<Feature, FeatureVersion>
  disabled: Feature[]
  constructor(v: SemVer) {
    this.features = new Map<Feature, FeatureVersion>()
    this.disabled = []
    this.update(v)
  }

  /**
   * Removes all disabled entries
   */
  resetDisabled() {
    this.disabled.length = 0
    this.update(this.server)
  }

  /**
   * Disables a particular feature.
   * @param f
   */
  disable(f: Feature) {
    this.disabled.push(f)
    this.update(this.server)
  }

  isDisabled(f: Feature) {
    return this.disabled.indexOf(f) !== -1
  }

  update(v: SemVer | string) {
    if (typeof v === 'string') {
      v = parseSemVer(v)
    }
    this.server = v

    // NOTE ON FEATURE SET: 
    // Bellerophon features are all WIP/BETA. Currently all features in test
    // are set to 1.0.0. Others are set to 1.1.0 until we think they are ready
    // for testing.
    this.set(Feature.BS_KV, '1.0.0')
    this.set(Feature.BS_OBJECTSTORE, '1.0.0')
    this.set(Feature.BS_PULL_MAX_BYTES, '1.0.0')
    this.set(Feature.BS_NEW_CONSUMER_CREATE_API, '1.0.0')
    this.set(Feature.BS_ALLOW_DIRECT, '1.0.0')
    this.set(Feature.BS_MULTIPLE_CONSUMER_FILTER, '1.0.0')
    this.set(Feature.BS_SIMPLIFICATION, '1.0.0')
    this.set(Feature.BS_STREAM_CONSUMER_METADATA, '1.0.0')
    this.set(Feature.BS_CONSUMER_FILTER_SUBJECTS, '1.0.0')
    this.set(Feature.BS_STREAM_FIRST_SEQ, '1.0.0')
    this.set(Feature.BS_STREAM_SUBJECT_TRANSFORM, '1.0.0')
    this.set(Feature.BS_STREAM_SOURCE_SUBJECT_TRANSFORM, '1.0.0')
    this.set(Feature.BS_STREAM_COMPRESSION, '1.0.0')
    this.set(Feature.BS_DEFAULT_CONSUMER_LIMITS, '1.0.0')
    this.set(Feature.BS_BATCH_DIRECT_GET, '1.0.0')

    this.disabled.forEach(f => {
      this.features.delete(f)
    })
  }

  /**
   * Register a feature that requires a particular server version.
   * @param f
   * @param requires
   */
  set(f: Feature, requires: string) {
    this.features.set(f, {
      min: requires,
      ok: compare(this.server, parseSemVer(requires)) >= 0,
    })
  }

  /**
   * Returns whether the feature is available and the min server
   * version that supports it.
   * @param f
   */
  get(f: Feature): FeatureVersion {
    return this.features.get(f) || { min: 'unknown', ok: false }
  }

  /**
   * Returns true if the feature is supported
   * @param f
   */
  supports(f: Feature): boolean {
    return this.get(f)?.ok || false
  }

  /**
   * Returns true if the server is at least the specified version
   * @param v
   */
  require(v: SemVer | string): boolean {
    if (typeof v === 'string') {
      v = parseSemVer(v)
    }
    return compare(this.server, v) >= 0
  }
}
