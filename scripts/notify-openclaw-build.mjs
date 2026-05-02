const hookUrl = process.env.OPENCLAW_BUILD_HOOK_URL || process.env.DEPLOY_WEBHOOK_URL || ''
const hookToken = process.env.OPENCLAW_BUILD_HOOK_TOKEN || process.env.DEPLOY_WEBHOOK_TOKEN || ''

if (!hookUrl || !hookToken) {
  console.log('[deploy-hook] skipped: missing OPENCLAW_BUILD_HOOK_URL/DEPLOY_WEBHOOK_URL or OPENCLAW_BUILD_HOOK_TOKEN/DEPLOY_WEBHOOK_TOKEN')
  process.exit(0)
}

const payload = {
  status: 'success',
  project: process.env.RAILWAY_PROJECT_NAME || process.env.PROJECT_NAME || 'northstar',
  branch: process.env.RAILWAY_GIT_BRANCH || process.env.SOURCE_BRANCH || process.env.GIT_BRANCH || '',
  commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || process.env.GIT_COMMIT || '',
  buildId: process.env.RAILWAY_DEPLOYMENT_ID || process.env.DEPLOYMENT_ID || '',
  url: process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : (process.env.APP_URL || ''),
}

try {
  const response = await fetch(hookUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hookToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    console.error(`[deploy-hook] failed: ${response.status} ${text}`)
    process.exit(1)
  }

  console.log('[deploy-hook] delivered')
} catch (error) {
  console.error(`[deploy-hook] error: ${error.message}`)
  process.exit(1)
}
