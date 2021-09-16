import * as hashWasm from 'https://cdn.skypack.dev/hash-wasm?dts';
import { b64EncodeToStr, b64DecodeFromStr } from 'https://deno.land/x/encoding_wasm@v0.1.0/mod.ts';
export { Readable, Duplex } from 'https://deno.land/std@0.106.0/node/stream.ts';
// @ts-check

// NETWORK

/**
 * @param {string} hostname
 * @param {number} port
 */
export const connectTCP = (hostname, port) => Deno.connect({ transport: 'tcp', hostname, port })

/**
 * @param {string} path
 */
export const connectUnixSocket = path => Deno.connect({ transport: 'unix', path })

/**
 * @param {Deno.Conn} conn
 * @param {() => void | Promise<void>} ready
 * @param {(buffer: Uint8Array) => Uint8Array | Promise<Uint8Array>} data
 * @param {(err?: any) => void | Promise<void>} close
 */
export const consume = async (conn, ready, data, close) => {
  try {
    let buffer = new Uint8Array(4096), left = buffer.subarray(0, 0);
    /** @type {number | null} */
    let read = 0;
    await ready();
    while (read = await conn.read(buffer.subarray(left.byteLength))) {
      left = await data(buffer.subarray(0, left.byteLength + read));
      if (left.byteOffset)
        buffer.set(left, 0)
      else if (left.byteLength === buffer.byteLength)
        buffer = concat([buffer, new Uint8Array(buffer.byteLength)], 2 * buffer.byteLength)
    }
    await close();
  } catch (err) {
    if (!(err instanceof Deno.errors.BadResource)) {
      console.log(Deno.inspect(err));
      await close(err);
    } else
      await close();
  } finally {
    conn.close()
  }
}

// USER INFO ACCESS

/**
 * @returns {(key: string) => string | undefined}
 */
export const getEnv = () => {
  /** @type {{ get(key: string): string | undefined }} */
  let env;
  try { // TODO : Detect environment access permission `Deno.permissions`
    env = Deno.env
  } catch (_) {
    env = {
      get(_) {
        return undefined
      }
    }
  }
  return function get(name) {
    try {
      return env.get(name);
    } catch (err) { }
  }
}

/**
 * @param {string} path
 */
export const readFile = path => Deno.readFile(path)

// POLYFILLS

/**
 * @param {(...args: any[]) => void} cb
 */
export const setImmediatePromise = (cb) => {
  /** @type {number} */
  let id = -1; // Avoid TS errors
  return Object.assign(new Promise((resolve, reject) => {
    id = setTimeout(() => {
      try {
        resolve(cb());
      } catch (err) {
        reject(err);
      }
    }, 0);
  }), { id });
};

/**
 * @param {ReturnType<typeof setImmediatePromise>} immediate
 */
export const clearImmediatePromise = (immediate) => clearTimeout(immediate.id);

/**
 * @param {(...args: any[]) => void} cb
 */
export const queueMicrotaskPromise = (cb) => new Promise((resolve, reject) => queueMicrotask(() => {
  try {
    resolve(cb());
  } catch (err) {
    reject(err);
  }
}));

// BUFFERS AND STRINGS UTILS

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * @param {Uint8Array} array
 * @returns {string}
 */
export const decode = array => decoder.decode(array)

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export const encode = str => encoder.encode(str)

/**
 * @param {Uint8Array} array
 * @returns {string}
 */
export const decodeBase64 = array => atob(decoder.decode(array))

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export const encodeBase64 = str => encoder.encode(btoa(str))

/**
 * @param {Uint8Array} array
 */
export const randomBase64 = array => btoa(decode(array.map(x => x % 128)));

/**
 * @param {Uint8Array[]} list
 * @param {number} totalLength
 */
export const concat = (list, totalLength = list.reduce((sum, buffer) => sum + buffer.byteLength, 0)) => {
  const result = new Uint8Array(totalLength);
  let i = 0;
  for (const buffer of list) {
    result.set(buffer, i);
    i += buffer.byteLength;
  }
  return result;
};

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export const fromString = str => encoder.encode(str);

/**
 * @param {Uint8Array} buffer
 * @param {number=} start
 * @param {number=} end
 * @returns {string}
 */
export const toString = (buffer, start, end) => decoder.decode(buffer.subarray(start, end));

/**
 * @param {Uint8Array} buffer
 * @returns {string}
 */
export const toHex = (buffer) => {
  let str = ''
  for (let i = 0; i < buffer.length; i++)
    str += buffer[i].toString(16)
  return str
}

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export const fromHex = (str) => {
  if (str.length % 2)
    str = '0' + str;
  const { length } = str;
  const buffer = new Uint8Array(length / 2);
  for (let i = 0, j = 0; j < length; i++, j += 2)
    buffer[i] = parseInt(str.charAt(j) + str.charAt(j + 1), 16)
  return buffer
}

/**
 * @param {string} str
 * @returns {string}
 */
export const hexToBase64 = (str) => {
  return btoa(
      String.fromCharCode(
          ...str
              .match(/.{2}/g)
              .map(c => parseInt(c, 16))
      )
  )
}

/**
 * @param {string} str
 * @returns {Promise<string>}
 */
export async function md5(str) {
  return await hashWasm.md5(str);
}

/**
 * @param {Uint8Array} buffer
 * @returns {Promise<string>}
 */
export function base64Encode(buffer) {
  return b64EncodeToStr(buffer);
}

/**
 * @param {string} str
 * @returns {Promise<Uint8Array>}
 */
export function base64Decode(str) {
  return b64DecodeFromStr(str);
}

/**
 * @param {string | Uint8Array | ArrayBuffer} key
 * @param {string | Uint8Array | ArrayBuffer} msg
 * @param {'binary' | 'hex'} outputType
 * @returns {Promise<Uint8Array | string>}
 */
export async function hmacSign(key, msg, outputType = 'binary') {
  const hashFunc = hashWasm.createSHA256();
  const hmac = await hashWasm.createHMAC(hashFunc, key);
  hmac.init();
  hmac.update(encode(msg));
  return hmac.digest(outputType);
}

/**
 * @param {Uint8Array} password
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @param {number} keyLen
 * @returns {Promise<Uint8Array>}
 */
export async function pbkdf2Derive(password, salt, iterations, keyLen) {
  return await hashWasm.pbkdf2({hashFunction: hashWasm.createSHA256(), password, salt, iterations, hashLength: keyLen, outputType: 'binary'});
}
