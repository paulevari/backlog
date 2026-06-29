import { KP } from './kp'
import { PublicKey } from './public'
import { Codec } from './codec'
import { getEd25519Helper } from './helper'
import { curveKeyLen, CurveKP } from './curve'

export function createPair(prefix: Prefix): KeyPair {
  const len = prefix === Prefix.Curve ? curveKeyLen : 32
  const rawSeed = getEd25519Helper().randomBytes(len)
  let str = Codec.encodeSeed(prefix, new Uint8Array(rawSeed))
  return prefix === Prefix.Curve
    ? new CurveKP(new Uint8Array(rawSeed))
    : new KP(str)
}

/**
 * Creates a KeyPair with an operator prefix
 * @returns {KeyPair} Returns the created KeyPair.
 */
export function createOperator(): KeyPair {
  return createPair(Prefix.Operator)
}

/**
 * Creates a KeyPair with an account prefix
 * @returns {KeyPair} Returns the created KeyPair.
 */
export function createAccount(): KeyPair {
  return createPair(Prefix.Account)
}

/**
 * Creates a KeyPair with a user prefix
 * @returns {KeyPair} Returns the created KeyPair.
 */
export function createUser(): KeyPair {
  return createPair(Prefix.User)
}

export function createCluster(): KeyPair {
  return createPair(Prefix.Cluster)
}

export function createServer(): KeyPair {
  return createPair(Prefix.Server)
}

export function createCurve(): KeyPair {
  return createPair(Prefix.Curve)
}

/**
 * Creates a KeyPair from a specified public key
 * @param {string} src of the public key in string format.
 * @returns {KeyPair} Returns the created KeyPair.
 * @see KeyPair#getPublicKey
 */
export function fromPublic(src: string): KeyPair {
  const ba = new TextEncoder().encode(src)
  const raw = Codec._decode(ba)
  const prefix = Prefixes.parsePrefix(raw[0])
  if (Prefixes.isValidPublicPrefix(prefix)) {
    return new PublicKey(ba)
  }
  throw new BKeysError(BKeysErrorCode.InvalidPublicKey)
}

export function fromCurveSeed(src: Uint8Array): KeyPair {
  const sd = Codec.decodeSeed(src)
  if (sd.prefix !== Prefix.Curve) {
    throw new BKeysError(BKeysErrorCode.InvalidCurveSeed)
  }
  if (sd.buf.byteLength !== curveKeyLen) {
    throw new BKeysError(BKeysErrorCode.InvalidSeedLen)
  }
  return new CurveKP(sd.buf)
}

/**
 * Creates a KeyPair from a specified seed.
 * @param {Uint8Array} src of the seed key as Uint8Array
 * @returns {KeyPair} Returns the created KeyPair.
 * @see KeyPair#getSeed
 */
export function fromSeed(src: Uint8Array): KeyPair {
  const sd = Codec.decodeSeed(src)
  // if we are here it decoded properly
  if (sd.prefix === Prefix.Curve) {
    return fromCurveSeed(src)
  }
  return new KP(src)
}

export type KeyPair = {
  /**
   * Returns the public key associated with the KeyPair
   * @returns {string}
   * @throws BKeysError
   */
  getPublicKey(): string

  /**
   * Returns the private key associated with the KeyPair
   * @returns Uint8Array
   * @throws BKeysError
   */
  getPrivateKey(): Uint8Array

  /**
   * Returns the PrivateKey's seed.
   * @returns Uint8Array
   * @throws BKeysError
   */
  getSeed(): Uint8Array

  /**
   * Returns the digital signature of signing the input with the
   * the KeyPair's private key.
   * @param {Uint8Array} input
   * @returns Uint8Array
   * @throws BKeysError
   */
  sign(input: Uint8Array): Uint8Array

  /**
   * Returns true if the signature can be verified with the KeyPair
   * @param {Uint8Array} input
   * @param {Uint8Array} sig
   * @returns {boolean}
   * @throws BKeysError
   */
  verify(input: Uint8Array, sig: Uint8Array): boolean

  /**
   * Clears the secret stored in the keypair. After clearing
   * a keypair cannot be used or recovered.
   */
  clear(): void

  seal(input: Uint8Array, recipient: string, nonce?: Uint8Array): Uint8Array

  open(message: Uint8Array, sender: string): Uint8Array | null
}

export enum Prefix {
  Unknown = -1,

  //Seed is the version byte used for encoded bellerophon Seeds
  Seed = 18 << 3, // Base32-encodes to 'S...'

  //PrefixBytePrivate is the version byte used for encoded bellerophon Private keys
  Private = 15 << 3, // Base32-encodes to 'P...'

  //PrefixByteOperator is the version byte used for encoded bellerophon Operators
  Operator = 14 << 3, // Base32-encodes to 'O...'

  //PrefixByteServer is the version byte used for encoded bellerophon Servers
  Server = 13 << 3, // Base32-encodes to 'N...'

  //PrefixByteCluster is the version byte used for encoded bellerophon Clusters
  Cluster = 2 << 3, // Base32-encodes to 'C...'

  //PrefixByteAccount is the version byte used for encoded bellerophon Accounts
  Account = 0, // Base32-encodes to 'A...'

  //PrefixByteUser is the version byte used for encoded bellerophon Users
  User = 20 << 3, // Base32-encodes to 'U...'

  Curve = 23 << 3, // Base32-encodes to 'X...'
}

/**
 * @private
 */
export class Prefixes {
  static isValidPublicPrefix(prefix: Prefix): boolean {
    return (
      prefix == Prefix.Server ||
      prefix == Prefix.Operator ||
      prefix == Prefix.Cluster ||
      prefix == Prefix.Account ||
      prefix == Prefix.User ||
      prefix == Prefix.Curve
    )
  }

  static startsWithValidPrefix(s: string) {
    let c = s[0]
    return (
      c == 'S' ||
      c == 'P' ||
      c == 'O' ||
      c == 'N' ||
      c == 'C' ||
      c == 'A' ||
      c == 'U' ||
      c == 'X'
    )
  }

  static isValidPrefix(prefix: Prefix): boolean {
    let v = this.parsePrefix(prefix)
    return v !== Prefix.Unknown
  }

  static parsePrefix(v: number): Prefix {
    switch (v) {
      case Prefix.Seed:
        return Prefix.Seed
      case Prefix.Private:
        return Prefix.Private
      case Prefix.Operator:
        return Prefix.Operator
      case Prefix.Server:
        return Prefix.Server
      case Prefix.Cluster:
        return Prefix.Cluster
      case Prefix.Account:
        return Prefix.Account
      case Prefix.User:
        return Prefix.User
      case Prefix.Curve:
        return Prefix.Curve
      default:
        return Prefix.Unknown
    }
  }
}

/**
 * Possible error codes on exceptions thrown by the sdk.
 * @note as with most of the balrog sdk, this is a direct port from bclient GO client
 */
export enum BKeysErrorCode {
  InvalidPrefixByte = 'bkey: invalid prefix byte',
  InvalidKey = 'bkey: invalid key',
  InvalidPublicKey = 'bkey: invalid public key',
  InvalidSeedLen = 'bkey: invalid seed length',
  InvalidSeed = 'bkey: invalid seed',
  InvalidCurveSeed = 'bkey: invalid curve seed',
  InvalidCurveKey = 'bkey: not a valid curve key',
  InvalidCurveOperation = 'bkey: curve key is not valid for sign/verify',
  InvalidBKeyOperation = 'keys: only curve key can seal/open',
  InvalidEncoding = 'bkey: invalid encoded key',
  InvalidRecipient = 'bkey: not a valid recipient public curve key',
  InvalidEncrypted = 'bkey: encrypted input is not valid',
  CannotSign = 'bkey: cannot sign, no private key available',
  PublicKeyOnly = 'bkey: no seed or private key available',
  InvalidChecksum = 'bkey: invalid checksum',
  SerializationError = 'bkey: serialization error',
  ApiError = 'bkey: api error',
  ClearedPair = 'bkey: pair is cleared',
}

export class BKeysError extends Error {
  name: string
  code: string
  chainedError?: Error

  /**
   * @param {BKeysErrorCode} code
   * @param {Error} [chainedError]
   * @constructor
   *
   * @api private
   */
  constructor(code: BKeysErrorCode, chainedError?: Error) {
    super(code)
    this.name = 'BKeysError'
    this.code = code
    this.chainedError = chainedError
  }
}
