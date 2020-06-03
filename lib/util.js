/// <reference path="../deno.d.ts" />

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
 * @param {(buffer: Uint8Array) => void | Promise<void>} data
 * @param {() => void | Promise<void>} close
 * @param {(err: any) => void | Promise<void>} error
 */
export const consume = async (conn, ready, data, close, error) => {
  try {
    await ready();
    for await (const buffer of Deno.iter(conn)) {
      await data(buffer);
    }
    await close();
  } catch (err) {
    if (err instanceof Deno.errors.BadResource)
      await close();
    else
      await error(err);
  }
}

// USER INFO ACCESS

/**
 * @returns {{ get(key: string): string | undefined }}
 */
export const getEnv = () => {
  try { // TODO : Detect environment access permission `Deno.permissions`
    return Deno.env
  } catch (_) {
    return {
      get(_) {
        return undefined
      }
    }
  }
}

/**
 * @param {string} path
 */
export const readFile = path => Deno.readFile(path)

// BUFFERS AND STRINGS UTILS

const encoder = new TextEncoder()
const decoder = new TextDecoder()

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
  for (const n of buffer)
    str += n.toString(16)
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
 */
export async function md5(str) {
  // Lazy loading for users not using MD5
  // @ts-ignore
  const { md5 } = await import('https://deno.land/x/md5/mod.ts')
  return md5(str);
}
