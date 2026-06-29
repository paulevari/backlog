import { crc16 } from './crc16'
import { BKeysError, BKeysErrorCode, Prefix, Prefixes } from './bkeys'
import { base32 } from './base32'

export interface SeedDecode {
  prefix: Prefix
  buf: Uint8Array
}

export class Codec {
  static encode(prefix: Prefix, src: Uint8Array): Uint8Array {
    if (!src || !(src instanceof Uint8Array)) {
      throw new BKeysError(BKeysErrorCode.SerializationError)
    }

    if (!Prefixes.isValidPrefix(prefix)) {
      throw new BKeysError(BKeysErrorCode.InvalidPrefixByte)
    }

    return Codec._encode(false, prefix, src)
  }

  static encodeSeed(role: Prefix, src: Uint8Array): Uint8Array {
    if (!src) {
      throw new BKeysError(BKeysErrorCode.ApiError)
    }

    if (!Prefixes.isValidPublicPrefix(role)) {
      throw new BKeysError(BKeysErrorCode.InvalidPrefixByte)
    }

    if (src.byteLength !== 32) {
      throw new BKeysError(BKeysErrorCode.InvalidSeedLen)
    }
    return Codec._encode(true, role, src)
  }

  static decode(expected: Prefix, src: Uint8Array): Uint8Array {
    if (!Prefixes.isValidPrefix(expected)) {
      throw new BKeysError(BKeysErrorCode.InvalidPrefixByte)
    }
    const raw = Codec._decode(src)
    if (raw[0] !== expected) {
      throw new BKeysError(BKeysErrorCode.InvalidPrefixByte)
    }
    return raw.slice(1)
  }

  static decodeSeed(src: Uint8Array): SeedDecode {
    const raw = Codec._decode(src)
    const prefix = Codec._decodePrefix(raw)
    if (prefix[0] != Prefix.Seed) {
      throw new BKeysError(BKeysErrorCode.InvalidSeed)
    }
    if (!Prefixes.isValidPublicPrefix(prefix[1])) {
      throw new BKeysError(BKeysErrorCode.InvalidPrefixByte)
    }
    return { buf: raw.slice(2), prefix: prefix[1] }
  }

  // unsafe encode no prefix/role validation
  static _encode(seed: boolean, role: Prefix, payload: Uint8Array): Uint8Array {
    // offsets for this token
    const payloadOffset = seed ? 2 : 1
    const payloadLen = payload.byteLength
    const checkLen = 2
    const cap = payloadOffset + payloadLen + checkLen
    const checkOffset = payloadOffset + payloadLen

    const raw = new Uint8Array(cap)
    // make the prefixes human readable when encoded
    if (seed) {
      const encodedPrefix = Codec._encodePrefix(Prefix.Seed, role)
      raw.set(encodedPrefix)
    } else {
      raw[0] = role
    }
    raw.set(payload, payloadOffset)

    //calculate the checksum write it LE
    const checksum = crc16.checksum(raw.slice(0, checkOffset))
    const dv = new DataView(raw.buffer)
    dv.setUint16(checkOffset, checksum, true)

    return base32.encode(raw)
  }

  // unsafe decode - no prefix/role validation
  static _decode(src: Uint8Array): Uint8Array {
    if (src.byteLength < 4) {
      throw new BKeysError(BKeysErrorCode.InvalidEncoding)
    }
    let raw: Uint8Array
    try {
      raw = base32.decode(src)
    } catch (ex) {
      throw new BKeysError(BKeysErrorCode.InvalidEncoding, ex)
    }

    const checkOffset = raw.byteLength - 2
    const dv = new DataView(raw.buffer)
    const checksum = dv.getUint16(checkOffset, true)

    const payload = raw.slice(0, checkOffset)
    if (!crc16.validate(payload, checksum)) {
      throw new BKeysError(BKeysErrorCode.InvalidChecksum)
    }
    return payload
  }

  static _encodePrefix(kind: Prefix, role: Prefix): Uint8Array {
    // In order to make this human printable for both bytes, we need to do a little
    // bit manipulation to setup for base32 encoding which takes 5 bits at a time.
    const b1 = kind | (role >> 5)
    const b2 = (role & 31) << 3 // 31 = 00011111
    return new Uint8Array([b1, b2])
  }

  static _decodePrefix(raw: Uint8Array): Uint8Array {
    // Need to do the reverse from the printable representation to
    // get back to internal representation.
    const b1 = raw[0] & 248 // 248 = 11111000
    const b2 = ((raw[0] & 7) << 5) | ((raw[1] & 248) >> 3) // 7 = 00000111
    return new Uint8Array([b1, b2])
  }
}
