import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'

const RPC_URL = 'https://api.mainnet-beta.solana.com'
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

const connection = new Connection(RPC_URL, 'confirmed')

function shortAddress(value = '') {
  return value ? `${value.slice(0, 4)}…${value.slice(-4)}` : '—'
}

function classifySignature(sig) {
  if (sig.err) return 'Failed'
  const memo = sig.memo || ''
  if (/swap|jup|raydium|pump/i.test(memo)) return 'Trade-related'
  return 'Transfer / interaction'
}

export async function fetchWalletSnapshot(address) {
  const pubkey = new PublicKey(address)

  const [balanceLamports, tokenAccounts, signatures] = await Promise.all([
    connection.getBalance(pubkey),
    connection.getTokenAccountsByOwner(pubkey, {
      programId: new PublicKey(TOKEN_PROGRAM_ID),
    }, 'confirmed'),
    connection.getSignaturesForAddress(pubkey, { limit: 10 }, 'confirmed'),
  ])

  const solBalance = balanceLamports / LAMPORTS_PER_SOL

  const parsedTokens = tokenAccounts.value
    .map(({ pubkey: accountPubkey, account }) => {
      const parsed = account.data.parsed?.info
      const tokenAmount = parsed?.tokenAmount
      const amount = Number(tokenAmount?.uiAmount || 0)
      const decimals = tokenAmount?.decimals ?? 0
      const mint = parsed?.mint || ''
      if (!amount) return null
      return {
        account: accountPubkey.toBase58(),
        mint,
        mintShort: shortAddress(mint),
        amount,
        decimals,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.amount - a.amount)

  const recentActivity = signatures.map((sig) => ({
    signature: sig.signature,
    signatureShort: shortAddress(sig.signature),
    time: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'Pending',
    status: sig.err ? 'Error' : 'Confirmed',
    category: classifySignature(sig),
  }))

  return {
    address,
    shortAddress: shortAddress(address),
    solBalance,
    tokenCount: parsedTokens.length,
    tokens: parsedTokens,
    recentActivity,
  }
}
