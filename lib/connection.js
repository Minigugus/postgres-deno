import { StartupMessage, Close, Execute, auth, Query, Parse, Bind, Sync } from './frontend.js'
import Backend from './backend.js'
import Queue from './queue.js'
import { END, retryRoutines } from './types.js'
import { errors } from './errors.js'
import { concat, consume, connectUnixSocket, connectTCP, setImmediatePromise, clearImmediatePromise } from './deno.js'

let count = 1

export default function Connection(options = {}) {
  const {
    onparameter,
    transform,
    idle_timeout,
    connect_timeout,
    onnotify,
    onnotice,
    onclose,
    parsers
  } = options
  let buffer = new Uint8Array(0)
  let length = 0
  let messages = []
  let timer
  let statement_id = 1
  let ended
  let open = false
  let ready = false
  let write = false
  let next = false
  let statements = {}
  let connect_timer

  const queries = Queue()
      , id = count++
      , uid = Math.random().toString(36).slice(2)

  const socket = postgresSocket(options, {
    ready,
    data,
    error,
    close,
    cleanup
  })

  const connection = { send, end, destroy, socket }

  const backend = Backend({
    onparse,
    onparameter,
    onsuspended,
    oncomplete,
    onerror,
    transform,
    parsers,
    onnotify,
    onnotice,
    onready,
    onauth,
    oncopy,
    ondata,
    error
  })

  function onsuspended(x, done) {
    return new Promise(r => r(x.length && backend.query.cursor(
      backend.query.cursor.rows === 1 ? x[0] : x
    ))).then(x =>
      x === END || done
        ? socket.write(Close())
        : socket.write(Execute(backend.query.cursor.rows))
    ).catch(err => {
      backend.query.reject(err)
      return socket.write(Close())
    })
  }

  function oncomplete() {
    return backend.query.cursor && onsuspended(backend.query.result, true)
  }

  function onerror(x) {
    if (!backend.query)
      return error(x)

    backend.error = x
    return backend.query.cursor && socket.write(Sync)
  }

  function onparse() {
    if (backend.query && backend.query.statement.sig)
      statements[backend.query.statement.sig] = backend.query.statement
  }

  function onauth(type, x, onerror) {
    return Promise.resolve(
      typeof options.pass === 'function'
        ? options.pass()
        : options.pass
    ).then(pass => auth(type, x, options, pass))
    .then(packet =>
      socket.write(packet)
    ).catch(onerror)
  }

  function end() {
    clearTimeout(timer)
    const promise = new Promise((resolve) => {
      ended = () => resolve(socket.end())
    })

    queueMicrotask(() => (ready || !backend.query) && ended())

    return promise
  }

  function destroy() {
    error(errors.connection('CONNECTION_DESTROYED', options, socket))
    return socket.destroy()
  }

  function error(err) {
    backend.query && backend.query.reject(err)
    let q
    while ((q = queries.shift()))
      q.reject(err)
  }

  async function retry(query) {
    query.retried = true
    delete statements[query.sig]
    ready = true
    backend.query = backend.error = null
    await send(query, { sig: query.sig, str: query.str, args: query.args })
  }

  function send(query, { sig, str, args = [] }) {
    try {
      query.sig = sig
      query.str = str
      query.args = args
      query.result = []
      query.result.count = null
      idle_timeout && clearTimeout(timer)

      typeof options.debug === 'function' && options.debug(id, str, args)
      const buffer = query.simple
        ? simple(str, query)
        : sig in statements
          ? prepared(statements[sig], args, query)
          : prepare(sig, str, args, query)

      ready
        ? (backend.query = query, ready = false)
        : queries.push(query)

      return (
        open
        ? socket.write(buffer)
        : (messages.push(buffer), connect())
      ).catch(err => {
        query.reject(err);
        idle();
      })
    } catch (err) {
      query.reject(err)
      idle()
    }
  }

  function connect() {
    connect_timeout && (
      clearTimeout(connect_timer),
      connect_timer = setTimeout(connectTimedOut, connect_timeout * 1000)
    )
    return socket.connect()
  }

  function connectTimedOut() {
    error(errors.connection('CONNECT_TIMEOUT', options, socket))
    return socket.destroy()
  }

  function simple(str, query) {
    query.statement = {}
    return Query(str)
  }

  function prepared(statement, args, query) {
    query.statement = statement
    return bind(query, args)
  }

  function prepare(sig, str, args, query) {
    query.statement = { name: sig ? 'p' + uid + statement_id++ : '', sig }
    return concat([
      Parse(query.statement.name, str, args),
      bind(query, args)
    ])
  }

  function bind(query, args) {
    return query.cursor
      ? Bind(query.statement.name, args, query.cursor.rows)
      : Bind(query.statement.name, args)
  }

  function idle() {
    if (idle_timeout && !backend.query && queries.length === 0) {
      clearTimeout(timer)
      timer = setTimeout(socket.end, idle_timeout * 1000)
    }
  }

  async function onready(err) {
    clearTimeout(connect_timer)
    if (err) {
      if (backend.query) {
        if (!backend.query.retried && retryRoutines[err.routine])
          return retry(backend.query)

        err.stack += backend.query.origin.replace(/.*\n/, '\n')
        Object.defineProperty(err, 'query', {
          value: backend.query.str,
          enumerable: !!options.debug
        })
        Object.defineProperty(err, 'parameters', {
          value: backend.query.args,
          enumerable: !!options.debug
        })
        backend.query.reject(err)
      } else {
        error(err)
      }
    } else if (backend.query) {
      backend.query.resolve(backend.query.results || backend.query.result)
    }

    backend.query = backend.error = null
    idle()

    if (!open) {
      if (multi())
        return
      const p = Promise.all(messages.map(x => socket.write(x)))
      messages = []
      open = true
      await p
    }

    backend.query = queries.shift()
    ready = !backend.query
    return ready && ended && ended()
  }

  function oncopy() {
    backend.query.writable.push = ({ chunk, error, callback }) => {
      error
          ? socket.write(frontend.CopyFail(error))
          : chunk === null
              ? socket.write(frontend.CopyDone())
              : socket.write(frontend.CopyData(chunk), callback)
    }
    backend.query.writable.forEach(backend.query.writable.push)
  }

  function ondata(x) {
    !backend.query.readable.push(x) && socket.pause()
  }

  function multi() {
    if (next)
      return (next = false, true)

    if (!write && options.target_session_attrs === 'read-write') {
      backend.query = {
        origin: '',
        result: [],
        statement: {},
        resolve: ([{ transaction_read_only }]) => transaction_read_only === 'on'
          ? (next = true, socket.destroy())
          : (write = true, socket.success()),
        reject: error
      }
      socket.write(Query('show transaction_read_only'))
      return true
    }
  }

  async function data(buffer) {
    while (buffer.length > 4) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      length = view.getInt32(1, false)
      if (length >= buffer.length)
        break

      await backend[buffer[0]](buffer.subarray(0, length + 1))
      buffer = buffer.subarray(length + 1)
    }

    return buffer
  }

  function close() {
    clearTimeout(connect_timer)
    error(errors.connection('CONNECTION_CLOSED', options, socket))
    messages = []
    open = ready = false
    return onclose && onclose()
  }

  function cleanup() {
    statements = {}
    open = ready = write = false
  }

  /* c8 ignore next */
  return connection
}

function postgresSocket(options, {
  error,
  close,
  cleanup,
  data
}) {
  /** @type {Deno.Conn | null} */
  let socket = null
  let ended = false
  let closed = true
  let succeeded = false
  let consumer = null
  /** @type {ReturnType<typeof setImmediatePromise> | null} */
  let next = null
  let buffer
  let i = 0

  async function onclose(err) {
    await oncleanup()
    const p = !ended && !succeeded && i < options.host.length
      ? connect()
      : err instanceof Error
        ? error(err)
        : close()
    i >= options.host.length && (i = 0)
    return p
  }

  function oncleanup() {
    closed = true
    return cleanup()
  }

  async function connect() {
    if (!closed)
      return

    closed = succeeded = false

    const socket = options.path
      ? connectUnixSocket(String(options.path))
      : connectTCP(String(x.host = options.host[i]), Number(x.port = options.port[i++]))

    // TODO : SSL support
    if (options.ssl === 'require')
      throw errors.generic({ code: 'SSL_NOT_SUPPORTED_YET', message: 'SSL is not implemented yet.' })

    await (consumer = attach(socket))
  }

  function ssl(x) {
    return x === 'require' || x === 'allow' || x === 'prefer'
      ? { rejectUnauthorized: false }
      : x
  }

  function attach(x) {
    return x.then(conn => {
      socket = conn
      return consume(conn, ready, data, onclose)
    }).catch(onclose)
  }

  async function ready() {
    try {
      return socket.write(StartupMessage(options))
    } catch (e) {
      await error(e)
      socket.close()
      socket = null
    }
  }

  const x = {
    success: () => {
      succeeded = true
      i >= options.host.length && (i = 0)
    },
    pause: () => socket.pause(),
    resume: () => socket.resume(),
    isPaused: () => socket.isPaused(),
    write: async (x, callback) => {
      buffer = buffer ? concat([buffer, x]) : x
      if (buffer.length >= 1024)
        await write(callback)
      next === null && (next = setImmediatePromise(write)).catch(error)
      callback && callback()
    },
    destroy: () => {
      socket && socket.close()
      socket = null
      return Promise.resolve()
    },
    end: () => {
      ended = true
      if (socket && !closed)
        return Promise.resolve()
      return write().finally(() => socket && socket.close())
    },
    connect
  }

  function write(callback) {
    const promise = buffer === null || socket === null ? Promise.resolve() : socket.write(buffer, callback)
    next !== null && clearImmediatePromise(next)
    buffer = next = null
    return promise
  }

  /* c8 ignore next */
  return x
}
