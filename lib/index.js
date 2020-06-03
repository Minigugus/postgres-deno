import Connection from './connection.js'
import Queue from './queue.js'
import { errors, PostgresError } from './errors.js'
import { mergeUserTypes, arraySerializer, arrayParser, inferType, toPascal, entries, toCamel, toKebab, escape, types, END } from './types.js'
import { toString, getEnv, readFile } from './util.js'

const notPromise = {
  P: {},
  finally: notTagged,
  then: notTagged,
  catch: notTagged
}

function notTagged() {
  throw errors.generic({ message: 'Query not called as a tagged template literal', code: 'NOT_TAGGED_CALL' })
}

export {
  toPascal,
  toCamel,
  toKebab
}

export const BigInt = {
  to: 20,
  from: [20],
  parse: x => globalThis.BigInt(x), // eslint-disable-line
  serialize: x => x.toString()
};

const originCache = new Map()

export default Postgres

function Postgres(a, b) {
  if (arguments.length && !a)
    throw new Error(a + ' - is not a url or connection object')

  const options = parseOptions(a, b)

  const max = Math.max(1, options.max)
      , connections = Queue()
      , all = []
      , queries = Queue()
      , listeners = {}
      , typeArrayMap = {}
      , files = {}
      , isInsert = /(^|[^)(])\s*insert\s+into\s+[^\s]+\s*$/i
      , isSelect = /(^|[^)(])\s*select\s*$/i

  let ready = false
    , ended = null
    , arrayTypesPromise
    , slots = max
    , listener

  function postgres(xs) {
    return query({}, getConnection(), xs, Array.from(arguments).slice(1))
  }

  Object.assign(postgres, {
    options: Object.assign({}, options, { pass: null }),
    parameters: {},
    listen,
    begin,
    end
  })

  if (postgres.options.ssl)
    throw errors.generic({ code: 'SSL_NOT_SUPPORTED_YET', message: 'SSL is not implemented yet.' })

  addTypes(postgres)

  const onparameter = options.onparameter
  options.onparameter = (k, v) => {
    if (postgres.parameters[k] !== v) {
      postgres.parameters[k] = v
      onparameter && onparameter(k, v)
    }
  }

  return postgres

  function begin(options, fn) {
    if (!fn) {
      fn = options
      options = ''
    }

    return new Promise((resolve, reject) => {
      const connection = getConnection(true)
          , query = { resolve, reject, fn, begin: 'begin ' + options.replace(/[^a-z ]/ig, '') }

      connection
        ? transaction(query, connection)
        : queries.push(query)
    })
  }

  function transaction({
    resolve,
    reject,
    fn,
    begin = '',
    savepoint = ''
  }, connection) {
    begin && (connection.savepoints = 0)
    addTypes(scoped, connection)
    scoped.savepoint = (name, fn) => new Promise((resolve, reject) => {
      transaction({
        savepoint: 'savepoint s' + connection.savepoints++ + '_' + (fn ? name : ''),
        resolve,
        reject,
        fn: fn || name
      }, connection)
    })

    query({ raw: true }, connection, begin || savepoint)
      .then(() => {
        const result = fn(scoped)
        return Array.isArray(result)
          ? Promise.all(result)
          : result
      })
      .then((x) =>
        begin
          ? scoped`commit`.then(() => resolve(x))
          : resolve(x)
      )
      .catch((err) => {
        query({ raw: true }, connection,
          begin
            ? 'rollback'
            : 'rollback to ' + savepoint
        )
        .then(() => reject(err))
      })
      .then(begin && (() => {
        connections.push(connection)
        next()
      }))

    function scoped(xs) {
      return query({}, connection, xs, Array.from(arguments).slice(1))
    }
  }

  function next() {
    let c
      , x

    while (queries.length && (c = getConnection(queries.peek().fn)) && (x = queries.shift())) {
      x.fn
        ? transaction(x, c)
        : send(c, x.query, x.xs, x.args)
    }
  }

  function query(query, connection, xs, args) {
    query.origin = options.debug ? new Error().stack : cachedError(xs)
    if (!query.raw && (!Array.isArray(xs) || !Array.isArray(xs.raw)))
      return nested(xs, args)

    const promise = new Promise((resolve, reject) => {
      query.resolve = resolve
      query.reject = reject
      ended !== null
        ? reject(errors.connection('CONNECTION_ENDED', options))
        : ready
          ? send(connection, query, xs, args)
          : fetchArrayTypes(connection).then(() => send(connection, query, xs, args)).catch(reject)
    })

    addMethods(promise, query)

    return promise
  }

  function cachedError(xs) {
    if (originCache.has(xs))
      return originCache.get(xs)

    const x = Error.stackTraceLimit
    Error.stackTraceLimit = 4
    originCache.set(xs, new Error().stack)
    Error.stackTraceLimit = x
    return originCache.get(xs)
  }

  function nested(first, rest) {
    const o = Object.create(notPromise)
    o.first = first
    o.rest = rest.flat()
    return o
  }

  function send(connection, query, xs, args) {
    connection
      ? setTimeout(connection.send.bind(null, query, query.raw ? parseRaw(query, xs, args) : parse(query, xs, args)), 0)
      : queries.push({ query, xs, args })
  }

  function getConnection(reserve) {
    const connection = slots ? createConnection(options) : connections.shift()
    !reserve && connection && connections.push(connection)
    return connection
  }

  function createConnection(options) {
    slots--
    const connection = Connection(options)
    all.push(connection)
    return connection
  }

  function array(xs) {
    const o = Object.create(notPromise)
    o.array = xs
    return o
  }

  function json(value) {
    return {
      type: types.json.to,
      value
    }
  }

  function fetchArrayTypes(connection) {
    return arrayTypesPromise || (arrayTypesPromise =
      new Promise((resolve, reject) => {
        send(connection, { resolve, reject, raw: true }, `
          select b.oid, b.typarray
          from pg_catalog.pg_type a
          left join pg_catalog.pg_type b on b.oid = a.typelem
          where a.typcategory = 'A' and b.typcategory != 'C'
          group by b.oid, b.typarray
          order by b.oid
        `)
      }).catch(err => {
        arrayTypesPromise = null
        throw err
      }).then(types => {
        types.forEach(({ oid, typarray }) => addArrayType(oid, typarray))
        ready = true
      })
    )
  }

  function addArrayType(oid, typarray) {
    const parser = options.parsers[oid]

    typeArrayMap[oid] = typarray
    options.parsers[typarray] = (xs) => arrayParser(xs, parser)
    options.parsers[typarray].array = true
    options.serializers[typarray] = (xs) => arraySerializer(xs, options.serializers[oid])
  }

  function addTypes(sql, connection) {
    Object.assign(sql, {
      END,
      PostgresError,
      types: {},
      notify,
      unsafe,
      array,
      file,
      json
    })

    function notify(channel, payload) {
      return sql`select pg_notify(${ channel }, ${ '' + payload })`
    }

    function unsafe(xs, args) {
      return query({ raw: true, simple: !args, dynamic: true }, connection || getConnection(), xs, args || [])
    }

    function file(path, args, options = {}) {
      if (!Array.isArray(args)) {
        options = args || {}
        args = null
      }

      if ('cache' in options === false)
        options.cache = true

      const file = files[path]
      const q = { raw: true, simple: !args }

      if (options.cache && typeof file === 'string')
        return query(q, connection || getConnection(), file, args || [])

      const promise = ((options.cache && file) || (files[path] = readFile(path)
      .then(content => {
        const str = toString(content)
        files[path] = str
        return str
      }))).then(str => query(q, connection || getConnection(), str, args || []))

      addMethods(promise, q)

      return promise
    }

    options.types && entries(options.types).forEach(([name, type]) => {
      sql.types[name] = (x) => ({ type: type.to, value: x })
    })
  }

  function addMethods(promise, query) {
    promise.stream = (fn) => (query.stream = fn, promise)
    promise.cursor = (rows, fn) => {
      if (typeof rows === 'function') {
        fn = rows
        rows = 1
      }
      fn.rows = rows
      query.cursor = fn
      return promise
    }
  }

  function listen(channel, fn) {
    if (channel in listeners) {
      listeners[channel].push(fn)
      return Promise.resolve(channel)
    }

    listeners[channel] = [fn]
    return query({ raw: true }, getListener(), 'listen ' + escape(channel))
  }

  function getListener() {
    if (listener)
      return listener

    listener = Connection(Object.assign({
      onnotify: (c, x) => c in listeners && listeners[c].forEach(fn => fn(x)),
      onclose: () => {
        Object.entries(listeners).forEach(([channel, fns]) => {
          delete listeners[channel]
          Promise.allSettled(fns.map(fn => listen(channel, fn)))
        })
      }
    },
      options
    ))
    all.push(listener)
    return listener
  }

  function end({ timeout = null } = {}) {
    if (ended)
      return ended

    let destroy

    return ended = Promise.race([
      Promise.resolve(arrayTypesPromise).then(() => Promise.all(all.map(c => c.end())))
    ].concat(
      timeout === 0 || timeout > 0
        ? new Promise(r => destroy = setTimeout(() => (all.map(c => c.destroy()), r()), timeout * 1000))
        : []
    ))
    .then(() => clearTimeout(destroy))
  }

  function parseRaw(query, str, args = []) {
    const types = []
        , xargs = []

    args.forEach(x => parseValue(x, xargs, types))

    return {
      sig: !query.dynamic && types + str,
      str,
      args: xargs
    }
  }

  function parse(query, xs, args = []) {
    const xargs = []
        , types = []

    let str = xs[0]
    let arg

    for (let i = 1; i < xs.length; i++) {
      arg = args[i - 1]
      str += parseArg(str, arg, xargs, types) + xs[i]
    }

    return {
      sig: !query.dynamic && !xargs.dynamic && types + str,
      str: str.trim(),
      args: xargs
    }
  }

  function parseArg(str, arg, xargs, types) {
    return arg && arg.P === notPromise.P
      ? arg.array
        ? parseArray(arg.array, xargs, types)
        : parseHelper(str, arg, xargs, types)
      : parseValue(arg, xargs, types)
  }

  function parseArray(array, xargs, types) {
    return array.length === 0 ? '\'{}\'' : 'array[' + array.map((x) => Array.isArray(x)
      ? parseArray(x, xargs, types)
      : parseValue(x, xargs, types)
    ).join(',') + ']'
  }

  function parseHelper(str, { first, rest }, xargs, types) {
    xargs.dynamic = true
    if (first !== null && typeof first === 'object' && typeof first[0] !== 'string') {
      if (isInsert.test(str))
        return insertHelper(first, rest, xargs, types)
      else if (isSelect.test(str))
        return selectHelper(first, rest, xargs, types)
      else if (!Array.isArray(first))
        return equalsHelper(first, rest, xargs, types)
    }

    return escapeHelper(Array.isArray(first) ? first : [first].concat(rest))
  }

  function selectHelper(first, columns, xargs, types) {
    return entries(first).reduce((acc, [k, v]) =>
      acc + (!columns.length || columns.indexOf(k) > -1
        ? (acc ? ',' : '') + parseValue(v, xargs, types) + ' as ' + escape(k)
        : ''
      )
    , '')
  }

  function insertHelper(first, columns, xargs, types) {
    first = Array.isArray(first) ? first : [first]
    columns = columns.length ? columns : Object.keys(first[0])
    return '(' + escapeHelper(columns) + ') values ' +
    first.reduce((acc, row) =>
      acc + (acc ? ',' : '') + '(' +
        columns.reduce((acc, k) => acc + (acc ? ',' : '') + parseValue(row[k], xargs, types), '') +
      ')'
    , '')
  }

  function equalsHelper(first, columns, xargs, types) {
    return (columns.length ? columns : Object.keys(first)).reduce((acc, k) =>
      acc + (acc ? ',' : '') + escape(k) + ' = ' + parseValue(first[k], xargs, types)
    , '')
  }

  function escapeHelper(xs) {
    return xs.reduce((acc, x) => acc + (acc ? ',' : '') + escape(x), '')
  }

  function parseValue(x, xargs, types) {
    if (x === undefined)
      throw errors.generic({ code: 'UNDEFINED_VALUE', message: 'Undefined values are not allowed' })

    return Array.isArray(x)
      ? x.reduce((acc, x) => acc + (acc ? ',' : '') + addValue(x, xargs, types), '')
      : x && x.P === notPromise.P
      ? parseArg('', x, xargs, types)
      : addValue(x, xargs, types)
  }

  function addValue(x, xargs, types) {
    const type = getType(x)
        , i = types.push(type.type)

    if (i > 65534)
      throw errors.generic({ message: 'Max number of parameters (65534) exceeded', code: 'MAX_PARAMETERS_EXCEEDED' })

    xargs.push(type)
    return '$' + i
  }

  function getType(x) {
    if (x == null)
      return { type: 0, value: x }

    const value = x.type ? x.value : x
        , type = x.type || inferType(value)

    return {
      type,
      value: (options.serializers[type] || types.string.serialize)(value)
    }
  }
}

function parseOptions(a, b) {
  const env = getEnv() // eslint-disable-line
      , url = typeof a === 'string'
        ? new URL(a.replace(/^postgres:\/\/|^ssl:\/\//, a.startsWith('ssl://') ? 'https://' : 'http://'))
        : (a instanceof URL ? a : { protocol: false, hostname: '', port: 0, query: {}, pathname: '' })
      , o = (typeof a === 'string' ? b : a) || {}
      , auth = 'username' in url ? [url.username, url.password] : []
      , host = o.hostname || o.host || url.hostname || env.get('PGHOST') || 'localhost'
      , port = o.port || url.port || env.get('PGPORT') || 5432

  return Object.assign({
    host,
    port,
    path            : o.path || host.indexOf('/') > -1 && host + '/.s.PGSQL.' + port,
    database        : o.database || o.db || (url.pathname || '').slice(1) || env.get('PGDATABASE') || 'postgres',
    user            : o.user || o.username || auth[0] || env.get('PGUSERNAME') || env.get('PGUSER') || osUsername(env),
    pass            : o.pass || o.password || auth[1] || env.get('PGPASSWORD') || '',
    max             : o.max || ('searchParams' in url && parseInt(url.searchParams.get('max'), 10)) || 10,
    types           : o.types || {},
    ssl             : o.ssl || (url.protocol === 'https:') || false, // TODO improve URL parsing
    idle_timeout    : o.idle_timeout || ('searchParams' in url && parseInt(url.searchParams.get('idle_timeout'), 10)) || env.get('PGIDLE_TIMEOUT') || warn(o.timeout, 'The timeout option is deprecated, use idle_timeout instead'),
    connect_timeout : o.connect_timeout || ('searchParams' in url && parseInt(url.searchParams.get('connect_timeout'), 10)) || env.get('PGCONNECT_TIMEOUT') || 30,
    onnotice        : o.onnotice,
    onparameter     : o.onparameter,
    transform       : Object.assign({}, o.transform),
    connection  : Object.assign({ application_name: 'postgres.js' }, o.connection),
    debug           : o.debug
  },
    mergeUserTypes(o.types)
  )
}

function warn(x, message) {
  typeof x !== 'undefined' && console.log(message)
  return x
}

function osUsername(env) {
  try {
    return env.get('USER') || env.get('USERNAME') || env.get('LOGNAME')
  } catch (_) {
    return
  }
}
