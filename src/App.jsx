import React, { useMemo, useState } from 'react'
import { Activity, AlertTriangle, BarChart3, RefreshCw, Shield, Wallet } from 'lucide-react'
import { fetchWalletSnapshot } from './solana'

const demoPositions = [
  { symbol: 'SOL', allocation: 44, pnl: 6.2, note: 'Core liquidity anchor' },
  { symbol: 'JUP', allocation: 16, pnl: -2.4, note: 'Only hold if thesis still intact' },
  { symbol: 'BONK', allocation: 10, pnl: 12.8, note: 'Speculative; trim strength' },
  { symbol: 'USDC', allocation: 22, pnl: 0, note: 'Dry powder / safety buffer' },
  { symbol: 'Other', allocation: 8, pnl: -9.1, note: 'Review for low-quality baggage' },
]

const watchlist = [
  { token: 'SOL', setup: 'Trend + liquidity leader', action: 'Watch for pullback entries only', risk: 'Low' },
  { token: 'JUP', setup: 'Ecosystem beta', action: 'No add unless structure improves', risk: 'Medium' },
  { token: 'New memes', setup: 'High slippage trap risk', action: 'Avoid unless filtered by rules', risk: 'High' },
]

const journalRows = [
  { date: '2026-04-20', rule: 'Max capital at risk per trade', value: '1.0% bankroll' },
  { date: '2026-04-20', rule: 'Max daily loss', value: '3.0% bankroll' },
  { date: '2026-04-20', rule: 'Minimum cash buffer', value: '20% in stables' },
]

function scorePortfolio(totalCapital, stablePct, concentrationPct) {
  let score = 100
  if (totalCapital < 1000) score -= 10
  if (stablePct < 20) score -= 15
  if (concentrationPct > 45) score -= 20
  if (concentrationPct > 60) score -= 15
  return Math.max(25, score)
}

export default function App() {
  const [walletAddress, setWalletAddress] = useState('E3wgMHveNtVzRW1cbJU7Pn4M5vvup4pJPi4PEmQjiBzq')
  const [bankroll, setBankroll] = useState('1300')
  const [snapshot, setSnapshot] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [stablePct, setStablePct] = useState('22')
  const [maxPositionPct, setMaxPositionPct] = useState('25')

  const totalCapital = Number(bankroll) || 0
  const stable = Number(stablePct) || 0
  const concentration = Number(maxPositionPct) || 0

  const healthScore = useMemo(
    () => scorePortfolio(totalCapital, stable, concentration),
    [totalCapital, stable, concentration]
  )

  const riskBand = healthScore >= 80 ? 'Controlled' : healthScore >= 60 ? 'Caution' : 'Fragile'

  async function refreshWallet() {
    setIsLoading(true)
    setError('')
    try {
      const nextSnapshot = await fetchWalletSnapshot(walletAddress.trim())
      setSnapshot(nextSnapshot)
    } catch (err) {
      setError(err?.message || 'Failed to load wallet data')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app">
      <div className="shell">
        <section className="hero">
          <div>
            <h1>Solana Wallet Command Dashboard</h1>
            <p>
              A professional-trader-style control surface for a small bankroll: monitor exposure,
              score concentration risk, enforce discipline, and only act after explicit approval.
              This dashboard is scaffolded for GMGN-style Solana workflows without autonomous trading.
            </p>
          </div>
          <div className="badge">Approval-first · small-bankroll aware</div>
        </section>

        <section className="grid">
          <div className="card span-4">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Account Snapshot</h2>
              <Wallet size={18} />
            </div>
            <div className="metric">
              <span className="metric-label">Estimated bankroll</span>
              <span className="metric-value">${totalCapital.toLocaleString()}</span>
              <span className="metric-sub">{snapshot ? `${snapshot.solBalance.toFixed(4)} SOL · ${snapshot.tokenCount} active token accounts` : 'Manual bankroll model + live wallet ready'}</span>
            </div>
            <div className="kv"><span>Risk health</span><strong>{healthScore}/100</strong></div>
            <div className="kv"><span>Risk band</span><strong className={riskBand === 'Controlled' ? 'positive' : riskBand === 'Caution' ? 'warning' : 'negative'}>{riskBand}</strong></div>
            <div className="kv"><span>Stablecoin buffer</span><strong>{stable}%</strong></div>
            <div className="kv"><span>Largest position cap</span><strong>{concentration}%</strong></div>
          </div>

          <div className="card span-8">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Control Inputs</h2>
              <Shield size={18} />
            </div>
            <div className="grid">
              <div className="span-6">
                <label className="small">Public wallet address</label>
                <input className="input" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} placeholder="Paste Solana public wallet address" />
              </div>
              <div className="span-6">
                <label className="small">Estimated bankroll (USD)</label>
                <input className="input" value={bankroll} onChange={(e) => setBankroll(e.target.value)} placeholder="1300" />
              </div>
              <div className="span-6">
                <label className="small">Stablecoin reserve %</label>
                <input className="input" value={stablePct} onChange={(e) => setStablePct(e.target.value)} placeholder="22" />
              </div>
              <div className="span-6">
                <label className="small">Largest position %</label>
                <input className="input" value={maxPositionPct} onChange={(e) => setMaxPositionPct(e.target.value)} placeholder="25" />
              </div>
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="button" onClick={refreshWallet} disabled={isLoading}>
                {isLoading ? 'Loading wallet…' : 'Refresh live read-only data'} <RefreshCw size={14} />
              </button>
              <button className="button secondary">Export risk notes</button>
            </div>
            <p className="small" style={{ marginTop: 12 }}>
              Live data uses public Solana RPC only. No private keys, no seed phrase, no autonomous execution.
              {error ? <><br /><span className="negative">{error}</span></> : null}
            </p>
          </div>

          <div className="card span-7">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>{snapshot ? 'Live Token Accounts' : 'Portfolio Structure'}</h2>
              <BarChart3 size={18} />
            </div>
            <table className="table">
              <thead>
                <tr>
                  {snapshot ? <>
                    <th>Mint</th>
                    <th>Amount</th>
                    <th>Account</th>
                    <th>Operator note</th>
                  </> : <>
                    <th>Asset</th>
                    <th>Alloc.</th>
                    <th>PnL</th>
                    <th>Operator note</th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {snapshot ? snapshot.tokens.slice(0, 10).map((row) => (
                  <tr key={row.account}>
                    <td>{row.mintShort}</td>
                    <td>{row.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td>{row.account.slice(0, 4)}…{row.account.slice(-4)}</td>
                    <td>Needs pricing/liquidity score before action</td>
                  </tr>
                )) : demoPositions.map((row) => (
                  <tr key={row.symbol}>
                    <td>{row.symbol}</td>
                    <td>{row.allocation}%</td>
                    <td className={row.pnl >= 0 ? 'positive' : 'negative'}>{row.pnl >= 0 ? '+' : ''}{row.pnl}%</td>
                    <td>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card span-5">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Hard Rules</h2>
              <AlertTriangle size={18} />
            </div>
            <div className="list">
              <div className="kv"><span>Per-trade risk</span><strong>0.5%–1.0%</strong></div>
              <div className="kv"><span>Daily stop</span><strong className="negative">-3.0%</strong></div>
              <div className="kv"><span>No new low-liquidity punts</span><strong>Unless rules pass</strong></div>
              <div className="kv"><span>No averaging down</span><strong>In weak microcaps</strong></div>
              <div className="kv"><span>Execution mode</span><strong>Approval required</strong></div>
            </div>
          </div>

          <div className="card span-6">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Watchlist Logic</h2>
              <Activity size={18} />
            </div>
            {watchlist.map((item) => (
              <div className="kv" key={item.token}>
                <span>
                  <strong>{item.token}</strong><br />
                  <span className="small">{item.setup}</span>
                </span>
                <span>
                  <div>{item.action}</div>
                  <div className={item.risk === 'Low' ? 'positive' : item.risk === 'Medium' ? 'warning' : 'negative'}>{item.risk} risk</div>
                </span>
              </div>
            ))}
          </div>

          <div className="card span-6">
            <h2>Discipline Journal</h2>
            {journalRows.map((row) => (
              <div className="kv" key={row.rule}>
                <span>
                  <strong>{row.rule}</strong><br />
                  <span className="small">{row.date}</span>
                </span>
                <strong>{row.value}</strong>
              </div>
            ))}
            <div style={{ marginTop: 12 }}>
              <span className="pill">Preserve capital first</span>
              <span className="pill">Trade less, not more</span>
              <span className="pill">No autonomous execution</span>
            </div>
          </div>

          <div className="card span-12">
            <h2>Recent Wallet Activity</h2>
            {snapshot ? (
              <table className="table">
                <thead>
                  <tr><th>Signature</th><th>Time</th><th>Status</th><th>Category</th></tr>
                </thead>
                <tbody>
                  {snapshot.recentActivity.map((row) => (
                    <tr key={row.signature}>
                      <td>{row.signatureShort}</td>
                      <td>{row.time}</td>
                      <td className={row.status === 'Confirmed' ? 'positive' : 'negative'}>{row.status}</td>
                      <td>{row.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="small">
                Click refresh to load read-only Solana balance, token accounts, and recent signatures for the configured public wallet.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
