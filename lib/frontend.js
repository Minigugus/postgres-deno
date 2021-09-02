import bytes from './bytes.js'
import { entries } from './types.js'
import { errors } from './errors.js'
import { decodeBase64, concat, toString, md5, fromString, encodeBase64, randomBase64, hasCryptoSupport } from './deno.js'

const N = String.fromCharCode(0)
const empty = new Uint8Array(0)
const Sync = bytes.S().end()
const execute = concat([
  bytes.D().str('P').str(N).end(),
  bytes.E().str(N).i32(0).end(),
  bytes.H().end(),
  bytes.S().end()
])

const SSLRequest = bytes.i32(8).i32(80877103).end(8)

const authNames = {
  2 : 'KerberosV5',
  3 : 'CleartextPassword',
  5 : 'MD5Password',
  6 : 'SCMCredential',
  7 : 'GSS',
  8 : 'GSSContinue',
  9 : 'SSPI',
  10: 'SASL',
  11: 'SASLContinue',
  12: 'SASLFinal'
}

const auths = {
  3 : AuthenticationCleartextPassword,
  5 : AuthenticationMD5Password,
  10: SASL,
  11: SASLContinue,
  12: SASLFinal
}


export {
  StartupMessage,
  SSLRequest,
  auth,
  Bind,
  Sync,
  Parse,
  Query,
  Close,
  Execute,
  CopyData,
  CopyDone,
  CopyFail
}

function StartupMessage({ user, database, connection }) {
  return bytes
      .inc(4)
      .i16(3)
      .z(2)
      .str(entries(Object.assign({
            user,
            database,
            client_encoding: '\'utf-8\''
          },
          connection
      )).filter(([, v]) => v).map(([k, v]) => k + N + v).join(N))
      .z(2)
      .end(0)
}

function auth(type, x, options, pass) {
  if (type in auths)
    return auths[type](type, x, options, pass)
  /* c8 ignore next */
  throw errors.generic({
    message: 'Auth type ' + (authNames[type] || type) + ' not implemented',
    type: authNames[type] || type,
    code: 'AUTH_TYPE_NOT_IMPLEMENTED'
  })
}

function AuthenticationCleartextPassword(type, x, options, pass) {
  return bytes
      .p()
      .str(pass)
      .z(1)
      .end()
}

async function AuthenticationMD5Password(type, x, options, pass) {
  return bytes
      .p()
      .str('md5' + await md5(toString(concat([fromString(await md5(pass + options.user)), x.slice(9)]))))
      .z(1)
      .end()
}

function SASL(type, x, options) {
  bytes
      .p()
      .str('SCRAM-SHA-256' + N)

  const i = bytes.i

  options.nonce = randomBase64(crypto.getRandomValues(new Uint8Array(18)))

  return bytes
      .inc(4)
      .str('n,,n=*,r=' + options.nonce)
      .i32(bytes.i - i - 4, i)
      .end()
}

async function SASLContinue(type, x, options, pass) {
  if (!hasCryptoSupport)
    throw errors.generic({
      message: 'Auth type ' + (authNames[type] || type) + ' require a working Crypto API',
      type: authNames[type] || type,
      code: 'AUTH_TYPE_NOT_IMPLEMENTED'
    })
  const res = toString(x, 9).split(',').reduce((acc, x) => (acc[x[0]] = x.slice(2), acc), {})

  const saltedPassword = await crypto.subtle.generateKey(
      {
        name: 'PBKDF2',
        salt: encodeBase64(res.s),
        iterations: parseInt(res.i, 10),
        length: 32,
        hash: {
          name: 'SHA-256'
        }
      },
      false,
      ['deriveKey', 'deriveBits']
  )

  const clientKey = await crypto.subtle.importKey(
      'raw',
      fromString('Client Key'),
      {
        name: 'HMAC',
        hash: { name: 'SHA-256' }
      },
      true,
      ["sign", "verify"]
  )
  const exportedClientKey = await crypto.subtle.exportKey(
      'raw',
      clientKey
  )

  const auth = 'n=*,r=' + options.nonce + ','
      + 'r=' + res.r + ',s=' + res.s + ',i=' + res.i
      + ',c=biws,r=' + res.r

  const serverKey = await crypto.subtle.importKey(
      'raw',
      await hmacSign(saltedPassword, fromString('Server Key')),
      {
        name: 'HMAC',
        hash: { name: 'SHA-256' }
      },
      false,
      ["sign", "verify"]
  )

  options.serverSignature = decodeBase64(
      await hmacSign(
          serverKey,
          auth
      )
  )

  return bytes.p()
      .str('c=biws,r=' + res.r + ',p=' + toString(xor(exportedClientKey, await hmacSign(clientKey, auth))))
      .end()
}

function SASLFinal(type, x, options) {
  if (toString(x, 9).split(N, 1)[0].slice(2) === options.serverSignature)
    return empty
  /* c8 ignore next 4 */
  throw errors.generic({
    message: 'The server did not return the correct signature',
    code: 'SASL_SIGNATURE_MISMATCH'
  })
}

function Query(x) {
  return bytes
      .Q()
      .str(x + N)
      .end()
}

function CopyData(x) {
  return bytes
      .d()
      .raw(x)
      .end()
}

function CopyDone() {
  return bytes
      .c()
      .end()
}

function CopyFail(err) {
  return bytes
      .f()
      .str(String(err) + N)
      .end()
}

function Bind(name, args, rows = 0) {
  let prev

  bytes
      .B()
      .str(N)
      .str(name + N)
      .i16(0)
      .i16(args.length)

  args.forEach(x => {
    if (x.value == null)
      return bytes.i32(0xFFFFFFFF)

    prev = bytes.i
    bytes
        .inc(4)
        .str(x.value)
        .i32(bytes.i - prev - 4, prev)
  })

  bytes.i16(0)

  return concat([
    bytes.end(),
    ...(
        rows
            ? [
              bytes.D().str('P').str(N).end(),
              bytes.E().str(N).i32(rows).end(),
              bytes.H().end()
            ]
            : [execute]
    )
  ])
}

function Parse(name, str, args) {
  bytes
      .P()
      .str(name + N)
      .str(str + N)
      .i16(args.length)

  args.forEach(x => bytes.i32(x.type))

  return bytes.end()
}

function Execute(rows) {
  return concat([
    bytes.E().str(N).i32(rows).end(),
    bytes.H().end()
  ])
}

function Close() {
  return concat([
    bytes.C().str('P').str(N).end(),
    bytes.S().end()
  ])
}

function hmacSign(key, x) {
  return crypto.subtle.sign({ name: 'HMAC', hash: { name: 'SHA-256' } }, key, typeof x === 'string' ? fromString(x) : x)
      .then(buffer => new Uint8Array(buffer))
}

function xor(a, b) {
  const length = Math.max(a.length, b.length)
  const buffer = new Uint8Array(length)
  for (let i = 0; i < length; i++)
    buffer[i] = a[i] ^ b[i]
  return buffer
}
