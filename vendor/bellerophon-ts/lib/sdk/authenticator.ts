import { bkey } from './bkeys'
import { TD, TE } from './encoder'
import {
  Auth,
  Authenticator,
  ErrorCode,
  JwtAuth,
  BellerophonError,
  BKeyAuth,
  NoAuth,
  TokenAuth,
  UserPass,
} from './core'

export function multiAuthenticator(authenticators: Authenticator[]) {
  return (nonce?: string): Auth => {
    let auth: Partial<NoAuth & TokenAuth & UserPass & BKeyAuth & JwtAuth> = {}
    authenticators.forEach(a => {
      const args = a(nonce) || {}
      auth = Object.assign(auth, args)
    })
    return auth as Auth
  }
}

export function noAuthFn(): Authenticator {
  return (): NoAuth => {
    return
  }
}

/**
 * Returns a user/pass authenticator for the specified user and optional password
 * @param { string | () => string } user
 * @param {string | () => string } pass
 * @return {UserPass}
 */
export function usernamePasswordAuthenticator(
  user: string | (() => string),
  pass?: string | (() => string),
): Authenticator {
  return (): UserPass => {
    const u = typeof user === 'function' ? user() : user
    const p = typeof pass === 'function' ? pass() : pass
    return { user: u, pass: p }
  }
}

/**
 * Returns a token authenticator for the specified token
 * @param { string | () => string } token
 * @return {TokenAuth}
 */
export function tokenAuthenticator(
  token: string | (() => string),
): Authenticator {
  return (): TokenAuth => {
    const auth_token = typeof token === 'function' ? token() : token
    return { auth_token }
  }
}

/**
 * Returns an Authenticator that returns a BKeyAuth based that uses the
 * specified seed or function returning a seed.
 * @param {Uint8Array | (() => Uint8Array)} seed - the bkey seed
 * @return {BKeyAuth}
 */
export function bkeyAuthenticator(
  seed?: Uint8Array | (() => Uint8Array),
): Authenticator {
  return (nonce?: string): BKeyAuth => {
    const s = typeof seed === 'function' ? seed() : seed
    const kp = s ? bkey.fromSeed(s) : undefined
    const bkeys = kp ? kp.getPublicKey() : ''
    const challenge = TE.encode(nonce || '')
    const sigBytes = kp !== undefined && nonce ? kp.sign(challenge) : undefined
    const sig = sigBytes ? bkey.encode(sigBytes) : ''
    return { bkey: bkeys, sig }
  }
}

/**
 * Returns an Authenticator function that returns a JwtAuth.
 * If a seed is provided, the public key, and signature are
 * calculated.
 *
 * @param {string | ()=>string} ajwt - the jwt
 * @param {Uint8Array | ()=> Uint8Array } seed - the optional bkey seed
 * @return {Authenticator}
 */
export function jwtAuthenticator(
  ajwt: string | (() => string),
  seed?: Uint8Array | (() => Uint8Array),
): Authenticator {
  return (nonce?: string): JwtAuth => {
    const jwt = typeof ajwt === 'function' ? ajwt() : ajwt
    const fn = bkeyAuthenticator(seed)
    const { bkey, sig } = fn(nonce) as BKeyAuth
    return { jwt, bkey, sig }
  }
}

/**
 * Returns an Authenticator function that returns a JwtAuth.
 * This is a convenience Authenticator that parses the
 * specified creds and delegates to the jwtAuthenticator.
 * @param {Uint8Array | () => Uint8Array } creds - the contents of a creds file or a function that returns the creds
 * @returns {JwtAuth}
 */
export function credsAuthenticator(
  creds: Uint8Array | (() => Uint8Array),
): Authenticator {
  const fn = typeof creds !== 'function' ? () => creds : creds
  const parse = () => {
    const CREDS =
      /\s*(?:(?:[-]{3,}[^\n]*[-]{3,}\n)(.+)(?:\n\s*[-]{3,}[^\n]*[-]{3,}\n))/gi
    const s = TD.decode(fn())
    // get the JWT
    let m = CREDS.exec(s)
    if (!m) {
      throw BellerophonError.errorForCode(ErrorCode.BadCreds)
    }
    const jwt = m[1].trim()
    // get the bkey
    m = CREDS.exec(s)
    if (!m) {
      throw BellerophonError.errorForCode(ErrorCode.BadCreds)
    }
    if (!m) {
      throw BellerophonError.errorForCode(ErrorCode.BadCreds)
    }
    const seed = TE.encode(m[1].trim())

    return { jwt, seed }
  }

  const jwtFn = () => {
    const { jwt } = parse()
    return jwt
  }
  const bkeyFn = () => {
    const { seed } = parse()
    return seed
  }

  return jwtAuthenticator(jwtFn, bkeyFn)
}
