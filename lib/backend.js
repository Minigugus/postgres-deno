import { errors } from './errors.js'
import { errorFields, entries } from './types.js'
import {decode, toString} from './deno.js'

const char = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc)
  , N = '\u0000'

export default Backend

function Backend({
  onparse,
  onparameter,
  onsuspended,
  oncomplete,
  onerror,
  parsers,
  onauth,
  onready,
  oncopy,
  ondata,
  transform,
  onnotice,
  onnotify
}) {
  let rows = 0

  const backend = entries({
    1: ParseComplete,
    2: BindComplete,
    3: CloseComplete,
    A: NotificationResponse,
    C: CommandComplete,
    c: CopyDone,
    D: DataRow,
    d: CopyData,
    E: ErrorResponse,
    G: CopyInResponse,
    H: CopyOutResponse,
    I: EmptyQueryResponse,
    K: BackendKeyData,
    N: NoticeResponse,
    n: NoData,
    R: Authentication,
    S: ParameterStatus,
    s: PortalSuspended,
    T: RowDescription,
    t: ParameterDescription,
    V: FunctionCallResponse,
    v: NegotiateProtocolVersion,
    W: CopyBothResponse,
    Z: ReadyForQuery
  }).reduce(char, {})

  const state = backend.state = {
    status: 'I',
    pid: null,
    secret: null
  }

  function ParseComplete() {
    onparse()
  }

  /* c8 ignore next 2 */
  function BindComplete() { /* No handling needed */ }
  function CloseComplete() { /* No handling needed */ }

  function NotificationResponse(x) {
    if (!onnotify)
      return

    let index = 9
    while (x[index++] !== 0);
    return onnotify(
      toString(x, 9, index - 1),
      toString(x, index, x.length - 1)
    )
  }

  function CommandComplete(x) {
    if (!backend.query)
      return

    for (let i = x.length - 1; i > 0; i--) {
      if (x[i] === 32 && x[i + 1] < 58 && backend.query.result.count === null)
        backend.query.result.count = +toString(x, i + 1, x.length - 1)
      if (x[i - 1] >= 65) {
        backend.query.result.command = toString(x, 5, i)
        backend.query.result.state = state
        break
      }
    }

    return oncomplete()
  }

  /* c8 ignore next 3 */
  function CopyDone() {
    return backend.query.readable.push(null)
  }

  function DataRow(x) {
    if (!backend.query)
      return

    let index = 7
    let length
    let column
    let value

    const view = new DataView(x.buffer, x.byteOffset, x.byteLength)
    const row = backend.query.raw ? new Array(backend.query.statement.columns.length) : {}
    for (let i = 0; i < backend.query.statement.columns.length; i++) {
      column = backend.query.statement.columns[i]
      length = view.getInt32(index, false)
      index += 4

      value = length === -1
        ? null
        : backend.query.raw
            ? x.slice(index, index += length)
            : column.parser === undefined
                ? decode(x.slice(index, index += length))
                : column.parser.array === true
                    ? column.parser(decode(x.slice(index + 1, index += length)))
                    : column.parser(decode(x.slice(index, index += length)))

      backend.query.raw
        ? (row[i] = value)
        : (row[column.name] = transform.value.from ? transform.value.from(value) : value)
    }

    backend.query.stream
      ? backend.query.stream(transform.row.from ? transform.row.from(row) : row, backend.query.result)
      : (backend.query.result[rows++] = transform.row.from ? transform.row.from(row) : row)
  }

  /* c8 ignore next 3 */
  function CopyData() {
    return ondata(x.slice(5))
  }

  function ErrorResponse(x) {
    return onerror(errors.postgres(parseError(x)))
  }

  /* c8 ignore next 3 */
  function CopyInResponse() {
    oncopy()
  }

  /* c8 ignore next 3 */
  function CopyOutResponse() { /* No handling needed */ }

  /* c8 ignore next 3 */
  function EmptyQueryResponse() { /* No handling needed */ }

  function BackendKeyData(x) {
    const view = new DataView(x.buffer, x.byteOffset, x.byteLength)
    state.pid = view.getInt32(5, false)
    state.secret = view.getInt32(9, false)
  }

  function NoticeResponse(x) {
    return onnotice
      ? onnotice(parseError(x))
      : console.log(parseError(x)) // eslint-disable-line
  }

  function NoData() { /* No handling needed */ }

  function Authentication(x) {
    const view = new DataView(x.buffer, x.byteOffset, x.byteLength)
    const type = view.getInt32(5, false)
    return type !== 0 && onauth(type, x, onerror)
  }

  function ParameterStatus(x) {
    const [k, v] = toString(x, 5, x.length - 1).split(N)
    return onparameter(k, v)
  }

  function PortalSuspended() {
    const promise = onsuspended(backend.query.result)
    backend.query.result = []
    rows = 0
    return promise
  }

  /* c8 ignore next 3 */
  function ParameterDescription() {
    backend.error = errors.notSupported('ParameterDescription')
  }

  function RowDescription(x) {
    if (!backend.query)
      return;
    if (backend.query.result.command) {
      backend.query.results = backend.query.results || [backend.query.result]
      backend.query.results.push(backend.query.result = [])
      backend.query.result.count = null
      backend.query.statement.columns = null
    }

    rows = 0

    if (backend.query.statement.columns)
      return backend.query.result.columns = backend.query.statement.columns

    const view = new DataView(x.buffer, x.byteOffset, x.byteLength)

    const length = view.getInt16(5, false)
    let index = 7
    let start

    backend.query.statement.columns = Array(length)

    for (let i = 0; i < length; ++i) {
      start = index
      while (x[index++] !== 0);
      const type = view.getInt32(index + 6, false)
      backend.query.statement.columns[i] = {
        name: transform.column.from
          ? transform.column.from(toString(x, start, index - 1))
          : toString(x, start, index - 1),
        parser: parsers[type],
        type
      }
      index += 18
    }
    backend.query.result.columns = backend.query.statement.columns
  }

  /* c8 ignore next 3 */
  function FunctionCallResponse() {
    backend.error = errors.notSupported('FunctionCallResponse')
  }

  /* c8 ignore next 3 */
  function NegotiateProtocolVersion() {
    backend.error = errors.notSupported('NegotiateProtocolVersion')
  }

  /* c8 ignore next 3 */
  function CopyBothResponse() {
    oncopy()
  }

  function ReadyForQuery() {
    return onready(backend.error)
  }

  return backend
}

function parseError(x) {
  const error = {}
  let start = 5
  for (let i = 5; i < x.length - 1; i++) {
    if (x[i] === 0) {
      error[errorFields[x[start]]] = toString(x, start + 1, i)
      start = i + 1
    }
  }
  return error
}
