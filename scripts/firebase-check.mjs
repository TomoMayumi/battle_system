import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const project = process.argv[2]
const enableFirestore = process.argv.includes('--enable-firestore')
const checkAuth = process.argv.includes('--check-auth')

async function main() {
  if (!project || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) {
    throw new Error('Specify the Firebase project ID explicitly.')
  }
  console.log(`Checking Firebase project: ${project}`)
  const account = require('firebase-tools/lib/auth').getGlobalDefaultAccount()
  if (!account) throw new Error('Run npx firebase login first.')
  console.log('Using the existing Firebase CLI login.')
  await require('firebase-tools/lib/requireAuth').requireAuth({
    project,
    user: account.user,
    tokens: account.tokens,
  })
  const { Client } = require('firebase-tools/lib/apiv2')
  const billing = new Client({
    urlPrefix: 'https://cloudbilling.googleapis.com',
    apiVersion: 'v1',
  })
  console.log('Checking billing status.')
  const response = await billing.get(`/projects/${project}/billingInfo`, {
    skipLog: { resBody: true },
  })
  const info = response.body
  if (typeof info.billingEnabled !== 'boolean') {
    throw new Error('Could not verify the billing status. Stop before deploying.')
  }
  console.log(JSON.stringify({
    project,
    billingEnabled: info.billingEnabled,
    billingAccountLinked: Boolean(info.billingAccountName),
  }))
  if (info.billingEnabled || info.billingAccountName) {
    throw new Error('Billing is enabled. Stop before deploying.')
  }
  if (enableFirestore) {
    await require('firebase-tools/lib/ensureApiEnabled').ensure(
      project,
      'firestore.googleapis.com',
      'firestore',
    )
    console.log('Firestore API is enabled.')
  }
  if (checkAuth) {
    console.log('Checking Google sign-in configuration.')
    const identity = new Client({
      urlPrefix: 'https://identitytoolkit.googleapis.com',
      apiVersion: 'admin/v2',
    })
    const provider = await identity.get(
      `/projects/${project}/defaultSupportedIdpConfigs/google.com`,
      { skipLog: { resBody: true } },
    )
    console.log(JSON.stringify({
      googleSignInEnabled: provider.body.enabled === true,
      googleClientConfigured: Boolean(provider.body.clientId),
    }))
  }
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})