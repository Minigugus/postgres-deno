await exec('psql -c "create user postgres_js_test"')
await exec('psql -c "alter system set password_encryption=md5"')
await exec('psql -c "select pg_reload_conf()"')
await exec('psql -c "create user postgres_js_test_md5 with password \'postgres_js_test_md5\'"')
await exec('psql -c "alter system set password_encryption=\'scram-sha-256\'"')
await exec('psql -c "select pg_reload_conf()"')
await exec('psql -c "create user postgres_js_test_scram with password \'postgres_js_test_scram\'"')

await exec('dropdb postgres_js_test;createdb postgres_js_test')
await ['postgres_js_test', 'postgres_js_test', 'postgres_js_test', 'postgres_js_test'].reduce((p, x) =>
  p.then(() => exec('psql -c "grant all on database postgres_js_test to ' + x + '"')),
  Promise.resolve()
)

export async function exec(cmd) {
  const process = Deno.run({
    cmd: ['sh', '-c', cmd],
    stderr: 'piped'
  })
  const { success, code } = await process.status();
  const out = new TextDecoder().decode((await Deno.readAll(process.stderr)));
  if (!success && !out.includes('already exists'))
    throw new Error(`Command ${Deno.inspect(cmd)} failed: exit code ${code}: ${out}`);
  process.close();
}
