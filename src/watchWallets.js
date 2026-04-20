import { scoreWatchWallet } from './risk'

const seedWallets = [
  {
    label: 'Momentum Wallet A',
    address: '7Y8p…9uQL',
    winRate: 58,
    realizedMultiple: 1.7,
    consistency: 0.7,
    followabilityPenalty: 0.35,
    style: 'Momentum / fast rotations',
  },
  {
    label: 'Rotation Wallet B',
    address: '3kkJ…R1xF',
    winRate: 63,
    realizedMultiple: 1.3,
    consistency: 0.82,
    followabilityPenalty: 0.2,
    style: 'Cleaner swing behavior',
  },
  {
    label: 'Microcap Wallet C',
    address: '9mN4…xY2e',
    winRate: 44,
    realizedMultiple: 2.8,
    consistency: 0.41,
    followabilityPenalty: 0.75,
    style: 'High variance / likely hard to follow',
  },
]

export function getWatchWallets() {
  return seedWallets
    .map((wallet) => ({ ...wallet, score: scoreWatchWallet(wallet) }))
    .sort((a, b) => b.score - a.score)
}
