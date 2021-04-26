/* eslint no-console: 0 */

export function t(name, options, fn) {
  typeof options !== 'object' && (fn = options, options = {})
  return testDeno(false, options, name, fn)
}
export function ot(name, options, fn) {
  typeof options !== 'object' && (fn = options, options = {})
  return testDeno(true, options, name, fn)
}
export function not(name, fn) { return testDeno(false, { ignore: true }, name, fn) }

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function testDeno(only, { ignore = false, timeout = 500 }, name, fn) {
  const sanitize = false; // testNo++ !== 0;
  Deno.test({
    only,
    ignore: typeof ignore === 'function' ? ignore() : ignore,
    name,
    fn: () => Promise.race([
      fn().then(x => {
        if (!Array.isArray(x))
          throw new Error('Test should return result array')
  
        const [expected, got] = x
        if (expected !== got)
          throw new Error(Deno.inspect(expected) + ' != ' + Deno.inspect(got))
      }),
      delay(timeout).then(() => Promise.reject(new Error('Timeout')))
    ]),
    sanitizeOps: sanitize,
    sanitizeResources: sanitize
  })
}
