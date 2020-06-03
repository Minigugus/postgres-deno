/// <reference path="../deno.d.ts" />

/* eslint no-console: 0 */

// docker run -it --rm -p 5432:5432 -e POSTGRES_USER=$USER -v /run/postgresql:/run/postgresql postgres

import { t } from './test.js' // eslint-disable-line

const __dirname = import.meta.url.slice(0, import.meta.url.lastIndexOf('/'))

const execSync = (...cmd) => Deno.run({
  cmd: ['sh', '-c', cmd.join(' ')]
}).status()
const join = (...args) => new URL(args.join('/'), 'file:///').pathname

import postgres, { toPascal, toCamel, toKebab } from '../lib/index.js'

const delay = ms => new Promise(r => setTimeout(r, ms))

const login = {
  user: 'postgres_js_test'
}

const login_clear = {
  user: 'postgres_js_test_clear',
  pass: 'postgres_js_test_clear'
}

const login_md5 = {
  user: 'postgres_js_test_md5',
  pass: 'postgres_js_test_md5'
}

const login_scram = {
  user: 'postgres_js_test_scram',
  pass: 'postgres_js_test_scram'
}

const options = {
  db: 'postgres_js_test',
  user: login.user,
  pass: login.pass,
  idle_timeout: 0.2,
  debug: false,
  max: 1
}

await execSync('dropdb ' + options.db + ';createdb ' + options.db);
await ([login, login_clear, login_md5, login_scram].reduce(async(acc, x) =>
  acc.then(() => execSync('psql -c "create user ' + x.user + (x.pass ? ' password \'' + x.pass + '\'' : '') +';grant all on database ' + options.db + ' to ' + x.user + '"')),
  Promise.resolve()
))

const sql = postgres(options)

t('Connects with no options', async() => {
  const sql = postgres()

  const result = (await sql`select 1 as x`)[0].x
  sql.end()

  return [1, result]
})

t('Uses default database without slash', async() =>
  ['postgres', postgres('postgres://localhost').options.database]
)

t('Uses default database with slash', async() =>
  ['postgres', postgres('postgres://localhost/').options.database]
)

t('Result is array', async() =>
  [true, Array.isArray(await sql`select 1`)]
)

t('Result has count', async() =>
  [1, (await sql`select 1`).count]
)

t('Result has command', async() =>
  ['SELECT', (await sql`select 1`).command]
)

t('Create table', async() =>
  ['CREATE TABLE', (await sql`create table test(int int)`).command, await sql`drop table test`]
)

t('Drop table', async() => {
  await sql`create table test(int int)`
  return ['DROP TABLE', (await sql`drop table test`).command]
})

t('null', async() =>
  [null, (await sql`select ${ null } as x`)[0].x]
)

t('Integer', async() =>
  ['1', (await sql`select ${ 1 } as x`)[0].x]
)

t('String', async() =>
  ['hello', (await sql`select ${ 'hello' } as x`)[0].x]
)

t('Boolean false', async() =>
  [false, (await sql`select ${ false } as x`)[0].x]
)

t('Boolean true', async() =>
  [true, (await sql`select ${ true } as x`)[0].x]
)

t('Date', async() => {
  const now = new Date()
  return [0, now - (await sql`select ${ now } as x`)[0].x]
})

t('Json', async() => {
  const x = (await sql`select ${ sql.json({ a: 1, b: 'hello' }) } as x`)[0].x
  return [true, x.a === 1 && x.b === 'hello']
})

t('Empty array', async() =>
  [true, Array.isArray((await sql`select ${ sql.array([]) }::int[] as x`)[0].x)]
)

t('Array of Integer', async() =>
  ['3', (await sql`select ${ sql.array([1, 2, 3]) } as x`)[0].x[2]]
)

t('Array of String', async() =>
  ['c', (await sql`select ${ sql.array(['a', 'b', 'c']) } as x`)[0].x[2]]
)

t('Array of Date', async() => {
  const now = new Date()
  return [now.getTime(), (await sql`select ${ sql.array([now, now, now]) } as x`)[0].x[2].getTime()]
})

t('Nested array n2', async() =>
  ['4', (await sql`select ${ sql.array([[1, 2], [3, 4]]) } as x`)[0].x[1][1]]
)

t('Nested array n3', async() =>
  ['6', (await sql`select ${ sql.array([[[1, 2]], [[3, 4]], [[5, 6]]]) } as x`)[0].x[2][0][1]]
)

t('Escape in arrays', async() =>
  ['Hello "you",c:\\windows', (await sql`select ${ sql.array(['Hello "you"', 'c:\\windows']) } as x`)[0].x.join(',')]
)

t('Escapes', async() => {
  return ['hej"hej', Object.keys((await sql`select 1 as ${ sql('hej"hej') }`)[0])[0]]
})

t('null for int', async() => {
  await sql`create table test (x int)`
  return [1, (await sql`insert into test values(${ null })`).count, await sql`drop table test`]
})

t('Transaction throws', async() => {
  await sql`create table test (a int)`
  return ['22P02', await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql`insert into test values('hej')`
  }).catch(x => x.code), await sql`drop table test`]
})

t('Transaction rolls back', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql`insert into test values('hej')`
  }).catch(() => { /* ignore */ })
  return [0, (await sql`select a from test`).count, await sql`drop table test`]
})

t('Transaction throws on uncaught savepoint', async() => {
  await sql`create table test (a int)`

  return ['fail', (await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('fail')
    })
  }).catch(() => 'fail')), await sql`drop table test`]
})

t('Transaction throws on uncaught named savepoint', async() => {
  await sql`create table test (a int)`

  return ['fail', (await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint('watpoint', async sql => {
      await sql`insert into test values(2)`
      throw new Error('fail')
    })
  }).catch(() => 'fail')), await sql`drop table test`]
})

t('Transaction succeeds on caught savepoint', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('please rollback')
    }).catch(() => { /* ignore */ })
    await sql`insert into test values(3)`
  })

  return ['2', (await sql`select count(1) from test`)[0].count, await sql`drop table test`]
})

t('Savepoint returns Result', async() => {
  let result
  await sql.begin(async sql => {
    result = await sql.savepoint(sql =>
      sql`select 1 as x`
    )
  })

  return [1, result[0].x]
})

t('Parallel transactions', async() => {
  await sql`create table test (a int)`
  return ['11', (await Promise.all([
    sql.begin(sql => sql`select 1`),
    sql.begin(sql => sql`select 1`)
  ])).map(x => x.count).join(''), await sql`drop table test`]
})

t('Transactions array', async() => {
  await sql`create table test (a int)`

  return ['11', (await sql.begin(sql => [
    sql`select 1`.then(x => x),
    sql`select 1`
  ])).map(x => x.count).join(''), await sql`drop table test`]
})

t('Transaction waits', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('please rollback')
    }).catch(() => { /* ignore */ })
    await sql`insert into test values(3)`
  })

  return ['11', (await Promise.all([
    sql.begin(sql => sql`select 1`),
    sql.begin(sql => sql`select 1`)
  ])).map(x => x.count).join(''), await sql`drop table test`]
})

t('Helpers in Transaction', async() => {
  return ['1', (await sql.begin(async sql =>
    await sql`select ${ sql({ x: 1 }) }`
  ))[0].x]
})

t('Undefined values throws', async() => {
  let error

  await sql`
    select ${ undefined } as x
  `.catch(x => error = x.code)

  return ['UNDEFINED_VALUE', error]
})

t('Null sets to null', async() =>
  [null, (await sql`select ${ null } as x`)[0].x]
)

t('Throw syntax error', async() =>
  ['42601', (await sql`wat 1`.catch(x => x)).code]
)

t('Connect using uri', async() =>
  [true, await new Promise((resolve, reject) => {
    const sql = postgres('postgres://' + login.user + ':' + (login.pass || '') + '@localhost:5432/' + options.db, {
      idle_timeout: options.idle_timeout
    })
    sql`select 1`.then(() => resolve(true), reject)
  })]
)

t('Fail with proper error on no host', async() =>
  ['ConnectionRefused', (await new Promise((resolve, reject) => {
    const sql = postgres('postgres://localhost:33333/' + options.db, {
      idle_timeout: options.idle_timeout
    })
    sql`select 1`.then(reject, resolve)
  })).name]
)

t('Connect using SSL', async() => // TODO : SSL support
  [true, (await new Promise((resolve, reject) => {
    postgres({
      ssl: { rejectUnauthorized: false },
      idle_timeout: options.idle_timeout
    })`select 1`.then(() => resolve(true), reject)
  }))]
)

t('Login without password', async() => {
  return [true, (await postgres({ ...options, ...login })`select true as x`)[0].x]
})

t('Login using cleartext', async() => {
  return [true, (await postgres({ ...options, ...login_clear })`select true as x`)[0].x]
})

t('Login using MD5', async() => {
  return [true, (await postgres({ ...options, ...login_md5 })`select true as x`)[0].x]
})

t('Login using scram-sha-256', async() => {
  return [true, (await postgres({ ...options, ...login_scram })`select true as x`)[0].x]
})

t('Support dynamic password function', async() => {
  return [true, (await postgres({
    ...options,
    ...login_scram,
    pass: () => 'postgres_js_test_scram'
  })`select true as x`)[0].x]
})

t('Support dynamic async password function', async() => {
  return [true, (await postgres({
    ...options,
    ...login_scram,
    pass: () => Promise.resolve('postgres_js_test_scram')
  })`select true as x`)[0].x]
})

t('Point type', async() => {
  const sql = postgres({
    ...options,
    types: {
      point: {
        to: 600,
        from: [600],
        serialize: ([x, y]) => '(' + x + ',' + y + ')',
        parse: (x) => x.slice(1, -1).split(',').map(x => +x)
      }
    }
  })

  await sql`create table test (x point)`
  await sql`insert into test (x) values (${ sql.types.point([10, 20]) })`
  return [20, (await sql`select x from test`)[0].x[1], await sql`drop table test`]
})

t('Point type array', async() => {
  const sql = postgres({
    ...options,
    types: {
      point: {
        to: 600,
        from: [600],
        serialize: ([x, y]) => '(' + x + ',' + y + ')',
        parse: (x) => x.slice(1, -1).split(',').map(x => +x)
      }
    }
  })

  await sql`create table test (x point[])`
  await sql`insert into test (x) values (${ sql.array([sql.types.point([10, 20]), sql.types.point([20, 30])]) })`
  return [30, (await sql`select x from test`)[0].x[1][1], await sql`drop table test`]
})

t('sql file', async() =>
  [1, (await sql.file(join(__dirname, 'select.sql')))[0].x]
)

t('sql file can stream', async() => {
  let result
  await sql
    .file(join(__dirname, 'select.sql'), { cache: false })
    .stream(({ x }) => result = x)

  return [1, result]
})

t('sql file throws', async() =>
  ['NotFound', (await sql.file('./selectomondo.sql').catch(x => x.name))]
)

t('sql file cached', async() => {
  await sql.file(join(__dirname, 'select.sql'))
  await delay(20)

  return [1, (await sql.file(join(__dirname, 'select.sql')))[0].x]
})

t('Parameters in file', async() => {
  const result = await sql.file(
    join(__dirname, 'select-param.sql'),
    ['hello']
  )
  return ['hello', result[0].x]
})

t('Connection ended promise', async() => {
  const sql = postgres(options)

  await sql.end()

  return [undefined, await sql.end()]
})

t('Connection ended timeout', async() => {
  const sql = postgres(options)

  await sql.end({ timeout: 10 })

  return [undefined, await sql.end()]
})

t('Connection ended error', async() => {
  const sql = postgres(options)
  sql.end()
  return ['CONNECTION_ENDED', (await sql``.catch(x => x.code))]
})

t('Connection end does not cancel query', async() => {
  const sql = postgres(options)

  const promise = sql`select 1 as x`
  sql.end()

  return [1, (await promise)[0].x]
})

t('Connection destroyed', async() => {
  const sql = postgres(options)
  setTimeout(() => sql.end({ timeout: 0 }), 0)
  return ['CONNECTION_DESTROYED', await sql``.catch(x => x.code)]
})

t('Connection destroyed with query before', async() => {
  const sql = postgres(options)
  let error = sql`select pg_sleep(0.2)`.catch(err => err.code)
  sql.end({ timeout: 0 })
  return ['CONNECTION_DESTROYED', await error]
})

t('Message not supported', async() => {
  await sql`create table test (x int)`
  return ['MESSAGE_NOT_SUPPORTED', await sql`copy test to stdout`.catch(x => x.code), await sql`drop table test`]
})

t('transform column', async() => {
  const sql = postgres({
    ...options,
    transform: { column: x => x.split('').reverse().join('') }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['dlrow_olleh', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('column toPascal', async() => {
  const sql = postgres({
    ...options,
    transform: { column: toPascal }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['HelloWorld', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('column toCamel', async() => {
  const sql = postgres({
    ...options,
    transform: { column: toCamel }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['helloWorld', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('column toKebab', async() => {
  const sql = postgres({
    ...options,
    transform: { column: toKebab }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['hello-world', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('unsafe', async() => {
  await sql`create table test (x int)`
  return [1, (await sql.unsafe('insert into test values ($1) returning *', [1]))[0].x, await sql`drop table test`]
})

t('unsafe simple', async() => {
  return [1, (await sql.unsafe('select 1 as x'))[0].x]
})

t('listen and notify', async() => {
  const sql = postgres(options)
      , channel = 'hello'

  return ['world', await new Promise((resolve, reject) =>
    sql.listen(channel, resolve)
    .then(() => sql.notify(channel, 'world'))
    .catch(reject)
    .then(sql.end)
  )]
})

t('double listen', async() => {
  const sql = postgres(options)
      , channel = 'hello'

  let count = 0

  await new Promise((resolve, reject) =>
    sql.listen(channel, resolve)
    .then(() => sql.notify(channel, 'world'))
    .catch(reject)
  ).then(() => count++)

  await new Promise((resolve, reject) =>
    sql.listen(channel, resolve)
    .then(() => sql.notify(channel, 'world'))
    .catch(reject)
  ).then(() => count++)

  // for coverage
  sql.listen('weee', () => { /* noop */ }).then(sql.end)

  return [2, count]
})

t('listen and notify with weird name', async() => {
  const sql = postgres(options)
      , channel = 'wat-;ø§'

  return ['world', await new Promise((resolve, reject) =>
    sql.listen(channel, resolve)
    .then(() => sql.notify(channel, 'world'))
    .catch(reject)
    .then(sql.end)
  )]
})

t('listen reconnects', async() => {
  const listener = postgres(options)
      , xs = []

  const { state: { pid } } = await listener.listen('test', x => xs.push(x))
  await sql.notify('test', 'a')
  await sql`select pg_terminate_backend(${ pid }::int)`
  await delay(50)
  await sql.notify('test', 'b')
  await delay(50)
  listener.end()

  return ['ab', xs.join('')]
})

t('responds with server parameters (application_name)', async() =>
  ['postgres.js', await new Promise((resolve, reject) => postgres({
    ...options,
    onparameter: (k, v) => k === 'application_name' && resolve(v)
  })`select 1`.catch(reject))]
)

t('has server parameters', async() => {
  return ['postgres.js', (await sql`select 1`.then(() => sql.parameters.application_name))]
})

t('big query body', async() => {
  await sql`create table test (x int)`
  return [1000, (await sql`insert into test ${
    sql([...Array(1000).keys()].map(x => ({ x })))
  }`).count, await sql`drop table test`]
})

t('Throws if more than 65534 parameters', async() => {
  await sql`create table test (x int)`
  return ['MAX_PARAMETERS_EXCEEDED', (await sql`insert into test ${
    sql([...Array(65535).keys()].map(x => ({ x })))
  }`.catch(e => e.code)), await sql`drop table test`]
})

t('let postgres do implicit cast of unknown types', async() => {
  await sql`create table test (x timestamp with time zone)`
  const [{ x }] = await sql`insert into test values (${ new Date().toISOString() }) returning *`
  return [true, x instanceof Date, await sql`drop table test`]
})

t('only allows one statement', async() =>
  ['42601', await sql`select 1; select 2`.catch(e => e.code)]
)

t('await sql() throws not tagged error', async() => {
  let error
  try {
    await sql('select 1')
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().then throws not tagged error', async() => {
  let error
  try {
    sql('select 1').then(() => { /* noop */ })
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().catch throws not tagged error', async() => {
  let error
  try {
    await sql('select 1')
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().finally throws not tagged error', async() => {
  let error
  try {
    sql('select 1').finally(() => { /* noop */ })
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('dynamic column name', async() => {
  return ['!not_valid', Object.keys((await sql`select 1 as ${ sql('!not_valid') }`)[0])[0]]
})

t('dynamic select as', async() => {
  return ['2', (await sql`select ${ sql({ a: 1, b: 2 }) }`)[0].b]
})

t('dynamic select as pluck', async() => {
  return [undefined, (await sql`select ${ sql({ a: 1, b: 2 }, 'a') }`)[0].b]
})

t('dynamic insert', async() => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return ['the answer', (await sql`insert into test ${ sql(x) } returning *`)[0].b, await sql`drop table test`]
})

t('dynamic insert pluck', async() => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return [null, (await sql`insert into test ${ sql(x, 'a') } returning *`)[0].b, await sql`drop table test`]
})

t('array insert', async() => {
  await sql`create table test (a int, b int)`
  return [2, (await sql`insert into test (a, b) values (${ [1, 2] }) returning *`)[0].b, await sql`drop table test`]
})

t('parameters in()', async() => {
  return [2, (await sql`
    with rows as (
      select * from (values (1), (2), (3), (4)) as x(a)
    )
    select * from rows where a in (${ [3, 4] })
  `).count]
})

t('dynamic multi row insert', async() => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return ['the answer', (await sql`insert into test ${ sql([x, x]) } returning *`)[1].b, await sql`drop table test`]
})

t('dynamic update', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (17, 'wrong')`

  return ['the answer', (await sql`update test set ${ sql({ a: 42, b: 'the answer' }) } returning *`)[0].b, await sql`drop table test`]
})

t('dynamic update pluck', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (17, 'wrong')`

  return ['wrong', (await sql`update test set ${ sql({ a: 42, b: 'the answer' }, 'a') } returning *`)[0].b, await sql`drop table test`]
})

t('dynamic select array', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (42, 'yay')`
  return ['yay', (await sql`select ${ sql(['a', 'b']) } from test`)[0].b, await sql`drop table test`]
})

t('dynamic select args', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (42, 'yay')`
  return ['yay', (await sql`select ${ sql('a', 'b') } from test`)[0].b, await sql`drop table test`]
})

t('connection parameters', async() => {
  const sql = postgres({
    ...options,
    connection: {
      'some.var': 'yay'
    }
  })

  return ['yay', (await sql`select current_setting('some.var') as x`)[0].x]
})

t('Multiple queries', async() => {
  const sql = postgres(options)

  return [4, (await Promise.all([
    sql`select 1`,
    sql`select 2`,
    sql`select 3`,
    sql`select 4`
  ])).length]
})

t('Multiple statements', async() =>
  [2, await sql.unsafe(`
    select 1 as x;
    select 2 as a;
  `).then(([, [x]]) => x.a)]
)

t('throws correct error when authentication fails', async() => {
  const sql = postgres({
    ...options,
    ...login_md5,
    pass: 'wrong'
  })
  return ['28P01', await sql`select 1`.catch(e => e.code)] // FIXME : Password ignored ?
})

t('notice works', async() => {
  let notice
  const log = console.log
  console.log = function(x) {
    notice = x
  }

  const sql = postgres(options)

  await sql`create table if not exists users()`
  await sql`create table if not exists users()`

  console.log = log

  return ['NOTICE', notice.severity]
})

t('notice hook works', async() => {
  let notice
  const sql = postgres({
    ...options,
    onnotice: x => notice = x
  })

  await sql`create table if not exists users()`
  await sql`create table if not exists users()`

  return ['NOTICE', notice.severity]
})

t('bytea serializes and parses', async() => {
  const buf = new TextEncoder().encode('wat')

  await sql`create table test (x bytea)`
  await sql`insert into test values (${ buf })`

  return [true, (await sql`select x from test`)[0].x.every((v, i) => buf[i] === v)]
})

t('Stream works', async() => {
  let result
  await sql`select 1 as x`.stream(({ x }) => result = x)
  return [1, result]
})

t('Stream returns empty array', async() => {
  return [0, (await sql`select 1 as x`.stream(() => { /* noop */ })).length]
})

t('Cursor works', async() => {
  const order = []
  await sql`select 1 as x union select 2 as x`.cursor(async(x) => {
    order.push(x.x + 'a')
    await delay(100)
    order.push(x.x + 'b')
  })
  return ['1a1b2a2b', order.join('')]
})

t('Cursor custom n works', async() => {
  const order = []
  await sql`select * from generate_series(1,20)`.cursor(10, async(x) => {
    order.push(x.length)
  })
  return ['10,10', order.join(',')]
})

t('Cursor cancel works', async() => {
  let result
  await sql`select * from generate_series(1,10) as x`.cursor(async({ x }) => {
    result = x
    return sql.END
  })
  return [1, result]
})

t('Cursor throw works', async() => {
  const order = []
  await sql`select 1 as x union select 2 as x`.cursor(async(x) => {
    order.push(x.x + 'a')
    await delay(100)
    throw new Error('watty')
  }).catch(() => order.push('err'))
  return ['1aerr', order.join('')]
})

t('Transform row', async() => {
  const sql = postgres({
    ...options,
    transform: { row: () => 1 }
  })

  return [1, (await sql`select 'wat'`)[0]]
})

t('Transform row stream', async() => {
  let result
  const sql = postgres({
    ...options,
    transform: { row: () => 1 }
  })

  await sql`select 1`.stream(x => result = x)

  return [1, result]
})

t('Transform value', async() => {
  const sql = postgres({
    ...options,
    transform: { value: () => 1 }
  })

  return [1, (await sql`select 'wat' as x`)[0].x]
})

t('Unix socket', async() => {
  const sql = postgres({
    ...options,
    host: '/run/postgresql'
  })

  return [1, (await sql`select 1 as x`)[0].x]
})

t('Big result', async() => {
  return [100000, (await sql`select * from generate_series(1, 100000)`).count]
})

t('Debug works', async() => {
  let result
  const sql = postgres({
    ...options,
    debug: (connection_id, str) => result = str
  })

  await sql`select 1`

  return ['select 1', result]
})

t('bigint is returned as String', async() => [
  'string',
  typeof (await sql`select 9223372036854777 as x`)[0].x
])

t('int is returned as Number', async() => [
  'number',
  typeof (await sql`select 123 as x`)[0].x
])

t('numeric is returned as string', async() => [
  'string',
  typeof (await sql`select 1.2 as x`)[0].x
])

t('Async stack trace', async() => {
  const sql = postgres({ ...options, debug: false })
  return [
    parseInt(new Error().stack.split('\n')[1].split(':')[2]) + 1,
    parseInt(await sql`select.sql`.catch(x => x.stack.split('\n').pop().split(':')[2]))
  ]
})

t('Debug has long async stack trace', async() => {
  const sql = postgres({ ...options, debug: true })

  return [
    'watyo',
    await yo().catch(x => x.stack.match(/wat|yo/g).join(''))
  ]

  function yo() {
    return wat()
  }

  function wat() {
    return sql`selec 1`
  }
})

t('Error contains query string', async() => [
  'selec 1',
  (await sql`selec 1`.catch(err => err.query))
])

t('Error contains query parameters', async() => [
  '1',
  (await sql`selec ${ 1 }`.catch(err => err.parameters[0].value))
])

t('Query string is not enumerable', async() => {
  const sql = postgres({ ...options, debug: false })
  return [
  -1,
  (await sql`selec 1`.catch(err => Object.keys(err).indexOf('query')))
  ]
})

t('Query and parameters are not enumerable if debug is not set', async() => {
  const sql = postgres({ ...options, debug: false })

  return [
    false,
    (await sql`selec ${ 1 }`.catch(err => err.propertyIsEnumerable('parameters') || err.propertyIsEnumerable('query')))
  ]
})

t('Query and parameters are enumerable if debug is set', async() => {
  const sql = postgres({ ...options, debug: true })

  return [
    true,
    (await sql`selec ${ 1 }`.catch(err => err.propertyIsEnumerable('parameters') && err.propertyIsEnumerable('query')))
  ]
})

t('connect_timeout throws proper error', async() => [
  'CONNECT_TIMEOUT',
  await postgres({
    ...options,
    ...login_scram,
    connect_timeout: 0.001
  })`select 1`.catch(e => e.code) // FIXME : Race condition because of missing "setImmediate"
])

t('requests works after single connect_timeout', async() => {
  let first = true

  const sql = postgres({
    ...options,
    ...login_scram,
    connect_timeout: { valueOf() { return first ? (first = false, 0.001) : 1 } }
  })

  return [
    'CONNECT_TIMEOUT,,1',
    [
      await sql`select 1 as x`.then(() => 'DONE').catch(x => x.code), // FIXME : Race condition because of missing "setImmediate"
      await new Promise(r => setTimeout(r, 10)),
      (await sql`select 1 as x`)[0].x
    ].join(',')
  ]
})

t('Postgres errors are of type PostgresError', async() =>
  [true, (await sql`bad keyword`.catch(e => e)) instanceof sql.PostgresError]
)

t('Result has columns spec', async() =>
  ['x', (await sql`select 1 as x`).columns[0].name]
)

t('Stream has result as second argument', async() => {
  let x
  await sql`select 1 as x`.stream((_, result) => x = result)
  return ['x', x.columns[0].name]
})

t('Result as arrays', async() => {
  const sql = postgres({
    ...options,
    transform: {
      row: x => Object.values(x)
    }
  })

  return ['1,2', (await sql`select 1 as a, 2 as b`)[0].join(',')]
})

t('Insert empty array', async() => {
  await sql`create table tester (ints int[])`
  return [
    Array.isArray((await sql`insert into tester (ints) values (${ sql.array([]) }) returning *`)[0].ints),
    true,
    await sql`drop table tester`
  ]
})

t('Insert array in sql()', async() => {
  await sql`create table tester (ints int[])`
  return [
    Array.isArray((await sql`insert into tester ${ sql({ ints: sql.array([]) })} returning *`)[0].ints),
    true,
    await sql`drop table tester`
  ]
})
