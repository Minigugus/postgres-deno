/* eslint no-console: 0 */

let done = 0
let only = false
let ignored = 0
let promise = Promise.resolve()
const tests = {}

export function not() { return ignored++}
export function t(...rest) { return test(false, ...rest)}
export function ot(...rest) { return (only = true, test(true, ...rest))}

async function test(o, name, fn) {
  const line = new Error().stack.split('\n')[3].split(':')[2]
  await 1

  if (only && !o)
    return

  tests[name] = { fn, line, name }
  promise = promise.then(() => Promise.race([
    new Promise((resolve, reject) => fn.timer = setTimeout(() => reject('Timed out'), 500)),
    fn()
  ]))
    .then((x) => {
      if (!Array.isArray(x))
        throw new Error('Test should return result array')

      const [expected, got] = x
      if (expected !== got)
        throw new Error(expected + ' != ' + Deno.inspect(got))
      tests[name].succeeded = true
      return Deno.stdout.write(new TextEncoder().encode('✅'))
    })
    .catch(err => {
      tests[name].failed = true
      tests[name].error = err instanceof Error ? err : new Error(Deno.inspect(err))
    })
    .then(() => {
      ++done === Object.keys(tests).length && exit()
    })
}

// TODO : Intercept signals

function exit() {
  console.log('')
  let success = true
  Object.values(tests).forEach((x) => {
    if (!x.succeeded) {
      success = false
      x.cleanup
        ? console.error('⛔️', x.name + ' at line', x.line, 'cleanup failed', '\n', Deno.inspect(x.cleanup))
        : console.error('⛔️', x.name + ' at line', x.line, x.failed
          ? 'failed'
          : 'never finished', '\n', Deno.inspect(x.error)
        )
    }
  })

  ignored && console.error('⚠️', ignored, 'ignored test' + (ignored === 1 ? '' : 's', '\n'))
  !only && success && !ignored
    ? console.log('All good')
    : Deno.exit(1) // eslint-disable-line
}
