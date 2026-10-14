import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const environment = { ...process.env }
if (process.platform === 'win32' && environment.LOCALAPPDATA) {
  const directory = join(environment.LOCALAPPDATA, 'party-night-tools')
  if (existsSync(directory)) {
    const cached = readdirSync(directory).find((name) =>
      name.startsWith('jdk-21'),
    )
    if (cached) environment.JAVA_HOME = join(directory, cached)
  }
}
const pathName =
  Object.keys(environment).find((name) => name.toUpperCase() === 'PATH') ??
  'PATH'
environment[pathName] = [
  join(process.cwd(), 'node_modules', '.bin'),
  ...(environment.JAVA_HOME ? [join(environment.JAVA_HOME, 'bin')] : []),
  environment[pathName] ?? '',
].join(delimiter)
console.log(
  'Starting Firestore rules tests on the local demo-party-night emulator.',
)
const result = spawnSync(
  process.execPath,
  [
    require.resolve('firebase-tools/lib/bin/firebase.js'),
    'emulators:exec',
    '--project',
    'demo-party-night',
    '--only',
    'firestore',
    '--non-interactive',
    'vitest run tests/firestore.test.ts',
  ],
  { env: environment, stdio: 'inherit' },
)
if (result.error) console.error(result.error.message)
process.exitCode = result.status ?? 1
