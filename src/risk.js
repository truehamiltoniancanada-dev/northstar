export function buildTokenRiskFlags(tokens = []) {
  return tokens.map((token, index) => {
    const flags = []
    const noteParts = []

    if (token.amount <= 0) {
      flags.push('empty')
    }

    if (token.amount > 1000000) {
      flags.push('size-anomaly')
      noteParts.push('Very large unit count; likely micro-priced token')
    }

    if (token.decimals === 0) {
      flags.push('zero-decimals')
      noteParts.push('0 decimals; verify token structure manually')
    }

    if (index > 4) {
      flags.push('long-tail')
      noteParts.push('Lower-priority tail position')
    }

    const riskLevel = flags.includes('size-anomaly') || flags.includes('zero-decimals')
      ? 'High'
      : flags.includes('long-tail')
        ? 'Medium'
        : 'Low'

    return {
      ...token,
      riskLevel,
      flags,
      note: noteParts.join(' · ') || 'Needs liquidity and pricing lookup',
    }
  })
}

export function buildCandidateActions(snapshot, bankrollUsd = 0) {
  if (!snapshot) return []

  const actions = []
  const bankroll = Number(bankrollUsd) || 0

  if (snapshot.solBalance < 0.05) {
    actions.push({
      title: 'Low SOL gas buffer',
      action: 'Hold back from frequent rotations until gas buffer is topped up',
      priority: 'High',
    })
  }

  if (snapshot.tokenCount > 12) {
    actions.push({
      title: 'Too many active token accounts',
      action: 'Consider reducing tail clutter before adding new risk',
      priority: 'Medium',
    })
  }

  if (bankroll > 0) {
    actions.push({
      title: 'Per-trade sizing cap',
      action: `Keep fresh risk between $${(bankroll * 0.005).toFixed(2)} and $${(bankroll * 0.01).toFixed(2)} per idea`,
      priority: 'Low',
    })
  }

  if (!actions.length) {
    actions.push({
      title: 'No urgent structural warning',
      action: 'Continue monitoring and wait for stronger confluence',
      priority: 'Low',
    })
  }

  return actions
}

export function scoreWatchWallet(wallet) {
  let score = wallet.winRate
  score += Math.min(wallet.realizedMultiple * 10, 25)
  score += wallet.consistency * 20
  score -= wallet.followabilityPenalty * 20
  return Math.max(0, Math.min(100, Math.round(score)))
}
