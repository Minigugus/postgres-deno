import {concat, fromString} from './deno.js';

const size = 256
// let buffer = Buffer.allocUnsafe(size)
let buffer = new Uint8Array(size)
let bufferView = new DataView(buffer.buffer)

const b = new class MessageBuilder {
  constructor() {
    this.B = this.header('B')
    this.C = this.header('C')
    this.Q = this.header('Q')
    this.P = this.header('P')
    this.F = this.header('F')
    this.p = this.header('p')
    this.D = this.header('D')
    this.E = this.header('E')
    this.H = this.header('H')
    this.S = this.header('S')
    this.d = this.header('d')
    this.c = this.header('c')
    this.f = this.header('f')

    this.i = 0
  }

  /**
   * @param {string} x
   */
  header(x) {
    const v = x.charCodeAt(0)
    return () => {
      buffer[0] = v
      this.i = 5
      return this
    }
  }

  inc(x) {
    this.i += x
    return this
  }
  str(x) {
    const encoded = fromString(x)
    fit(this, encoded.length)
    buffer.set(encoded, this.i)
    this.i += encoded.length;
    return this
  }
  i16(x) {
    fit(this, 2)
    bufferView.setUint16(this.i, x, false)
    this.i += 2
    return this
  }
  i32(x, i) {
    if (i || i === 0) {
      bufferView.setUint32(i, x, false)
      return this
    }
    fit(this, 4)
    bufferView.setUint32(this.i, x, false)
    this.i += 4
    return this
  }
  z(x) {
    fit(this, x)
    buffer.fill(0, this.i, this.i + x)
    this.i += x
    return this
  }
  raw(x) {
    buffer = concat([buffer.slice(0, this.i),x])
    this.i = buffer.byteLength
    return this
  }
  end(at = 1) {
    bufferView.setUint32(at, this.i - at)
    const out = buffer.slice(0, this.i)
    this.i = 0
    buffer = new Uint8Array(size)
    bufferView = new DataView(buffer.buffer)
    return out
  }
}

export default b

function fit(obj, x) {
  if (buffer.byteLength - obj.i < x) {
    const prev = buffer
        , length = prev.length

    buffer = new Uint8Array(length + (length >> 1) + x)
    bufferView = new DataView(buffer.buffer)
    buffer.set(prev)
  }
}
