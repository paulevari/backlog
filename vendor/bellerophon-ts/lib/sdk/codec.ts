import { TD, TE } from './encoder'
import { ErrorCode, BellerophonError } from './core'

export interface Codec<T> {
  /**
   * Encode T to an Uint8Array suitable for including in a message payload.
   * @param d
   */
  encode(d: T): Uint8Array

  /**
   * Decode an Uint8Array from a message payload into a T
   * @param a
   */
  decode(a: Uint8Array): T
}

/**
 * Returns a {@link Codec} for encoding strings to a message payload
 * and decoding message payloads into strings.
 * @constructor
 */
export function StringCodec(): Codec<string> {
  return {
    encode(d: string): Uint8Array {
      return TE.encode(d)
    },
    decode(a: Uint8Array): string {
      return TD.decode(a)
    },
  }
}

/**
 * Returns a {@link Codec}  for encoding JavaScript object to JSON and
 * serialize them to an Uint8Array, and conversely, from an
 * Uint8Array to JSON to a JavaScript Object.
 * @param reviver
 * @constructor
 */
export function JSONCodec<T = unknown>(
  reviver?: (this: unknown, key: string, value: unknown) => unknown,
): Codec<T> {
  return {
    encode(d: T): Uint8Array {
      try {
        if (d === undefined) {
          // @ts-ignore: json will not handle undefined
          d = null
        }
        return TE.encode(JSON.stringify(d))
      } catch (err) {
        throw BellerophonError.errorForCode(ErrorCode.BadJson, err)
      }
    },

    decode(a: Uint8Array): T {
      try {
        return JSON.parse(TD.decode(a), reviver)
      } catch (err) {
        throw BellerophonError.errorForCode(ErrorCode.BadJson, err)
      }
    },
  }
}
