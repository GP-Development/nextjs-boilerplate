// npm run test:docker [-- runner options]
// Builds the Docker image, runs it hardened (read-only filesystem, no capabilities, non-root),
// runs the compat suite against the container, and always removes the container.
//   --target runner (default) | runner-cache-components   (add --variant cache-components too)
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { makeRedactor } from './compat/lib.ts'
import { freePort, makeRunSecrets, waitUntilReady } from './compat/local.ts'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const variantIndex = args.indexOf('--variant')
const variant = variantIndex >= 0 ? args[variantIndex + 1] : 'main'
const target = variant === 'cache-components' ? 'runner-cache-components' : 'runner'
const cachePath =
  variant === 'cache-components' ? '/app/variants/cache-components/.next/cache' : '/app/.next/cache'

const { label, ...secrets } = makeRunSecrets()
const redact = makeRedactor(secrets)
// Optional extra `docker build` flags, e.g. DOCKER_BUILD_ARGS="--network host --secret id=extra_ca,src=ca.pem"
const extraBuildArgs = (process.env.DOCKER_BUILD_ARGS ?? '').split(/\s+/).filter(Boolean)
const image = `nextjs-compat-test:${variant}`
const name = `compat-${randomBytes(4).toString('hex')}`

function docker(dockerArgs: string[], opts: { inherit?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync('docker', dockerArgs, {
    cwd: root,
    stdio: opts.inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
    env: opts.env ?? process.env,
  })
}

async function main(): Promise<number> {
  console.log(`[test:docker] building image (target: ${target})…`)
  const build = docker(
    [
      'build',
      '--target',
      target,
      '--build-arg',
      `NEXT_PUBLIC_BUILD_LABEL=${label}`,
      '-t',
      image,
      ...extraBuildArgs,
      '.',
    ],
    { inherit: true },
  )
  if (build.status !== 0) return build.status ?? 1

  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  // `-e NAME` (no value) copies from our environment, so secrets never appear in `ps` output.
  const run = docker(
    [
      'run',
      '-d',
      '--name',
      name,
      '-p',
      `127.0.0.1:${port}:3000`,
      '--read-only',
      '--tmpfs',
      `${cachePath}:uid=1000,gid=1000`,
      '--tmpfs',
      '/tmp',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '-e',
      'REVALIDATE_TOKEN',
      '-e',
      'SERVER_ONLY_PROBE',
      '-e',
      'ENABLE_STRESS_TESTS=true',
      '-e',
      'SELF_ORIGIN=http://127.0.0.1:3000', // reachable from INSIDE the container
      image,
    ],
    {
      env: {
        ...process.env,
        REVALIDATE_TOKEN: secrets.revalidateToken,
        SERVER_ONLY_PROBE: secrets.serverProbe,
      },
    },
  )
  if (run.status !== 0) {
    console.error(`[test:docker] could not start container: ${redact(run.stderr ?? '')}`)
    return 1
  }

  try {
    console.log(`[test:docker] container ${name} on ${url}`)
    await waitUntilReady(
      url,
      () => docker(['inspect', '-f', '{{.State.Running}}', name]).stdout.trim() === 'true',
    )
    const runner = spawnSync(
      process.execPath,
      [
        resolve(root, 'scripts/run-compat-tests.ts'),
        '--url',
        url,
        '--host',
        `docker-${variant}`,
        ...args,
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          REVALIDATE_TOKEN: secrets.revalidateToken,
          SERVER_ONLY_PROBE: secrets.serverProbe,
        },
      },
    )
    if (runner.status !== 0)
      console.error(
        '[test:docker] container log tail:\n' +
          redact(
            docker(['logs', '--tail', '30', name]).stdout +
              docker(['logs', '--tail', '30', name]).stderr,
          ),
      )
    return runner.status ?? 1
  } catch (error) {
    console.error(`[test:docker] ${error instanceof Error ? error.message : 'failed'}`)
    console.error(
      '[test:docker] container log tail:\n' + redact(docker(['logs', '--tail', '30', name]).stderr),
    )
    return 1
  } finally {
    docker(['rm', '-f', name])
  }
}

main().then((code) => process.exit(code))
