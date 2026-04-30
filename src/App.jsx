import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  CornerDownLeft,
  Gift,
  LockKeyhole,
  MessageCircleHeart,
  ShieldAlert,
  X,
} from 'lucide-react'

const listeners = [
  {
    id: 'steady',
    name: 'The Steady Presence',
    tone: 'Calm, reassuring, fatherly',
    description: 'Warm, measured support for nights when your thoughts are loud and you need someone grounded.',
    accent: 'calm',
    opening: 'Take a breath with me. You do not have to solve the whole night at once.',
    followUp: 'What feels heaviest right now: your thoughts, your body, or what happened today?',
    suggestions: ['Guide me through a reset', 'Help me slow my thoughts', 'Stay gentle but direct'],
  },
  {
    id: 'coach',
    name: 'The Caring Coach',
    tone: 'Loving, direct, accountable',
    description: 'Affection first, excuses second. This mode helps you feel seen while still nudging you toward better choices.',
    accent: 'coach',
    opening: 'I am with you, and I am not going to let you disappear into avoidance tonight.',
    followUp: 'Tell me what is true, not what fear is shouting. What actually happened?',
    suggestions: ['Push me a little', 'Help me name the truth', 'Give me one accountable next step'],
  },
  {
    id: 'straight',
    name: 'The Straight Shooter',
    tone: 'Blunt, intense, unsentimental',
    description: 'Not soft. Not cruel. Just sharp honesty for moments when you want to be snapped out of a spiral.',
    accent: 'straight',
    opening: 'Let’s cut through the noise. The spiral is talking louder than reality right now.',
    followUp: 'What story are you repeating that is making this worse?',
    suggestions: ['Call out my spiral', 'Give me blunt clarity', 'Tell me what to do next'],
  },
]

const moods = [
  'Anxious and spiraling',
  'Ashamed after something I said or did',
  'Lonely and needing connection',
  'Numb and drifting',
  'Overwhelmed and close to shutting down',
]

const chatStarters = [
  'I cannot turn my brain off.',
  'I keep replaying a conversation and feeling stupid.',
  'I am about to text someone for the wrong reason.',
  'I need help getting steady before I make tonight worse.',
]

const storageKey = 'northstar.app.state'
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL
const defaultApiBaseUrl = configuredApiBaseUrl || `${window.location.protocol}//${window.location.hostname}:8787/api`

function buildConversation(listener, userName, mood, goal, message) {
  const introName = userName.trim() || 'friend'
  return [
    {
      role: 'system',
      label: 'Northstar',
      text: `You chose ${listener.name}. ${listener.tone}.`,
    },
    {
      role: 'assistant',
      label: listener.name,
      text: `${listener.opening} ${introName !== 'friend' ? `${introName}, ` : ''}${listener.followUp}`,
    },
    {
      role: 'user',
      label: 'You',
      text: message || `I am feeling ${mood.toLowerCase()} and I want help with ${goal.toLowerCase()}.`,
    },
  ]
}

export default function App() {
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [membershipActive, setMembershipActive] = useState(false)
  const [email, setEmail] = useState('')
  const [sessionToken, setSessionToken] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [authStep, setAuthStep] = useState('request')
  const [devAuthCode, setDevAuthCode] = useState('')
  const [step, setStep] = useState(1)
  const [selectedListenerId, setSelectedListenerId] = useState('steady')
  const [selectedMood, setSelectedMood] = useState(moods[0])
  const [goal, setGoal] = useState('calming down without isolating')
  const [userName, setUserName] = useState('')
  const [draft, setDraft] = useState(chatStarters[0])
  const [started, setStarted] = useState(false)
  const [messages, setMessages] = useState([])
  const [apiError, setApiError] = useState('')
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailCapture, setEmailCapture] = useState('')
  const [emailCaptured, setEmailCaptured] = useState(false)
  const [apiReady, setApiReady] = useState(false)
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl)
  const [stripeConfigured, setStripeConfigured] = useState(false)
  const [modelConfigured, setModelConfigured] = useState(false)
  const [devCodesEnabled, setDevCodesEnabled] = useState(false)
  const [emailConfigured, setEmailConfigured] = useState(false)
  const [subscriptionStatus, setSubscriptionStatus] = useState('inactive')
  const [isLoadingCheckout, setIsLoadingCheckout] = useState(false)
  const [isOpeningPortal, setIsOpeningPortal] = useState(false)

  const listener = useMemo(
    () => listeners.find((item) => item.id === selectedListenerId) || listeners[0],
    [selectedListenerId]
  )

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      setIsSignedIn(Boolean(saved.isSignedIn))
      setMembershipActive(Boolean(saved.membershipActive))
      setEmail(saved.email || '')
      setSessionToken(saved.sessionToken || '')
      setStep(saved.step || 1)
      setSelectedListenerId(saved.selectedListenerId || 'steady')
      setSelectedMood(saved.selectedMood || moods[0])
      setGoal(saved.goal || 'calming down without isolating')
      setUserName(saved.userName || '')
      setDraft(saved.draft || chatStarters[0])
      setStarted(Boolean(saved.started))
      setMessages(Array.isArray(saved.messages) ? saved.messages : [])
      setShowEmailModal(Boolean(saved.showEmailModal))
      setEmailCapture(saved.emailCapture || '')
      setEmailCaptured(Boolean(saved.emailCaptured))
      setSubscriptionStatus(saved.subscriptionStatus || 'inactive')
      setAuthStep(saved.authStep || 'request')
      setDevAuthCode(saved.devAuthCode || '')
    } catch {
      window.localStorage.removeItem(storageKey)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        isSignedIn,
        membershipActive,
        email,
        sessionToken,
        step,
        selectedListenerId,
        selectedMood,
        goal,
        userName,
        draft,
        started,
        messages,
        showEmailModal,
        emailCapture,
        emailCaptured,
        subscriptionStatus,
        authStep,
        devAuthCode,
      })
    )
  }, [
    isSignedIn,
    membershipActive,
    email,
    sessionToken,
    step,
    selectedListenerId,
    selectedMood,
    goal,
    userName,
    draft,
    started,
    messages,
    showEmailModal,
    emailCapture,
    emailCaptured,
    subscriptionStatus,
    authStep,
    devAuthCode,
  ])

  useEffect(() => {
    async function loadHealth() {
      try {
        const response = await fetch(`${defaultApiBaseUrl}/health`)
        const data = await response.json()
        setApiReady(Boolean(data.ok))
        setApiBaseUrl(configuredApiBaseUrl || (data.apiBaseUrl ? `${data.apiBaseUrl}/api` : defaultApiBaseUrl))
        setStripeConfigured(Boolean(data.stripeConfigured))
        setModelConfigured(Boolean(data.modelConfigured))
        setDevCodesEnabled(Boolean(data.devAuthCodes))
        setEmailConfigured(Boolean(data.emailConfigured))
      } catch {
        setApiReady(false)
        setStripeConfigured(false)
        setModelConfigured(false)
        setDevCodesEnabled(false)
      }
    }

    loadHealth()
  }, [])

  useEffect(() => {
    async function syncMembership() {
      if (!sessionToken || !isSignedIn) return
      try {
        const response = await fetch(`${apiBaseUrl}/auth/status`, {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Unable to load membership status')
        }

        setEmail(data.user?.email || '')
        setMembershipActive(Boolean(data.user?.membershipActive))
        setSubscriptionStatus(data.user?.subscriptionStatus || 'inactive')
      } catch (error) {
        setApiError(error.message)
        setIsSignedIn(false)
        setSessionToken('')
      }
    }

    syncMembership()
  }, [apiBaseUrl, sessionToken, isSignedIn])

  function goNextStep() {
    setStep((current) => Math.min(3, current + 1))
  }

  function goPrevStep() {
    setStep((current) => Math.max(1, current - 1))
  }

  function startSession() {
    if (!membershipActive) return
    setMessages(buildConversation(listener, userName, selectedMood, goal, draft))
    setStarted(true)
    if (!emailCaptured) {
      setShowEmailModal(true)
    }
  }

  async function postJson(path, body, useSession = false) {
    const headers = { 'Content-Type': 'application/json' }
    if (useSession && sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`
    }

    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Request failed')
    }
    return data
  }

  async function sendMessage(text) {
    const nextText = text.trim()
    if (!nextText) return

    setApiError('')
    setMessages((current) => [...current, { role: 'user', label: 'You', text: nextText }])
    setDraft('')

    try {
      const data = await postJson('/chat', { listenerId: listener.id, message: nextText }, true)
      setMessages((current) => [...current, { role: 'assistant', label: listener.name, text: data.reply }])
    } catch (error) {
      setApiError(error.message)
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          label: listener.name,
          text: modelConfigured
            ? 'Northstar could not complete the response right now. Try again in a moment.'
            : 'A real model provider is not configured yet, so Northstar is using fallback support responses right now.',
        },
      ])
    }
  }

  async function requestCode() {
    if (!email.trim()) return
    setApiError('')
    try {
      const data = await postJson('/auth/request-code', { email })
      setAuthStep('verify')
      setDevAuthCode(data.devCode || '')
    } catch (error) {
      setApiError(error.message)
    }
  }

  async function verifyCode() {
    if (!email.trim() || !authCode.trim()) return
    setApiError('')
    try {
      const data = await postJson('/auth/verify-code', { email, code: authCode })
      setSessionToken(data.token || '')
      setIsSignedIn(true)
      setMembershipActive(Boolean(data.user?.membershipActive))
      setSubscriptionStatus(data.user?.subscriptionStatus || 'inactive')
      setEmail(data.user?.email || email)
      setAuthCode('')
      setDevAuthCode('')
      setStarted(false)
    } catch (error) {
      setApiError(error.message)
    }
  }

  async function beginCheckout() {
    if (!sessionToken) return
    setApiError('')
    setIsLoadingCheckout(true)
    try {
      const data = await postJson('/billing/checkout-session', {}, true)
      window.location.href = data.url
    } catch (error) {
      setApiError(error.message)
      setIsLoadingCheckout(false)
    }
  }

  async function openBillingPortal() {
    if (!sessionToken) return
    setApiError('')
    setIsOpeningPortal(true)
    try {
      const data = await postJson('/billing/portal-session', {}, true)
      window.location.href = data.url
    } catch (error) {
      setApiError(error.message)
      setIsOpeningPortal(false)
    }
  }

  async function signOut() {
    try {
      if (sessionToken) {
        await postJson('/auth/signout', {}, true)
      }
    } catch {
      // Best effort sign-out; clear local session either way.
    }

    setIsSignedIn(false)
    setMembershipActive(false)
    setEmail('')
    setSessionToken('')
    setSubscriptionStatus('inactive')
    setStarted(false)
    setMessages([])
    setAuthStep('request')
    setAuthCode('')
    setDevAuthCode('')
  }

  function resetSession() {
    setStarted(false)
    setStep(1)
    setDraft(chatStarters[0])
    setMessages([])
  }

  async function loadChatHistory(nextListenerId = listener.id) {
    if (!sessionToken) return []
    try {
      const response = await fetch(`${apiBaseUrl}/chat/history?listenerId=${encodeURIComponent(nextListenerId)}`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Unable to load chat history')
      }
      return Array.isArray(data.messages) ? data.messages : []
    } catch (error) {
      setApiError(error.message)
      return []
    }
  }

  async function captureEmailLead() {
    if (!emailCapture.trim()) return
    setApiError('')
    try {
      await postJson('/email-capture', { email: emailCapture })
      setEmailCaptured(true)
      setShowEmailModal(false)
      if (!email) {
        setEmail(emailCapture)
      }
    } catch (error) {
      setApiError(error.message)
    }
  }

  useEffect(() => {
    async function hydrateChat() {
      if (!isSignedIn || !membershipActive || !sessionToken) return
      const history = await loadChatHistory(selectedListenerId)
      if (history.length > 0) {
        setMessages(history)
        setStarted(true)
      }
    }

    hydrateChat()
  }, [apiBaseUrl, isSignedIn, membershipActive, selectedListenerId, sessionToken])

  let content = null

  if (!isSignedIn) {
    content = (
      <section className="auth-shell reveal reveal-delay-2">
        <div className="auth-card">
          <span className="eyebrow">Member sign in</span>
          <h1 className="product-title">
            Pick up where you
            <span> left off.</span>
          </h1>
          <p className="product-copy">
            Northstar now uses a verification-code sign in flow instead of trusting raw email in the browser.
          </p>
          <label className="field-label">
            Email address
            <input className="text-input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          </label>
          {authStep === 'verify' ? (
            <label className="field-label">
              6-digit verification code
              <input className="text-input" value={authCode} onChange={(event) => setAuthCode(event.target.value)} placeholder="123456" />
            </label>
          ) : null}
          {devAuthCode ? <div className="api-banner">Dev code: {devAuthCode}</div> : null}
          <div className="panel-actions auth-actions-row">
            {authStep === 'verify' ? (
              <button className="button ghost" onClick={() => setAuthStep('request')}>
                Use a different email
              </button>
            ) : null}
            <button className="button primary auth-button" onClick={authStep === 'request' ? requestCode : verifyCode}>
              {authStep === 'request' ? 'Send code' : 'Verify and continue'} <ArrowRight size={16} />
            </button>
          </div>
          <p className="product-copy gate-helper">
            {devCodesEnabled ? 'Dev auth codes are enabled, so the verification code will appear in-app.' : emailConfigured ? 'Verification codes are configured to send through the active email provider.' : 'Production flow still needs a configured email provider before sign-in works without dev codes.'}
          </p>
        </div>
      </section>
    )
  } else if (!membershipActive) {
    content = (
      <section className="gate-shell reveal reveal-delay-2">
        <div className="gate-card">
          <div className="gate-icon"><LockKeyhole size={24} /></div>
          <span className="eyebrow">Membership required</span>
          <h1 className="product-title">
            Unlock the full
            <span> support flow.</span>
          </h1>
          <p className="product-copy">
            Northstar now supports a real subscription backend. Start checkout to unlock persistent support history, recurring access, and full session continuity.
          </p>
          <div className="gate-price">$24<span>/month</span></div>
          <div className="membership-list gate-list">
            <div><CheckCircle2 size={16} /> Persistent user and chat records in the backend</div>
            <div><CheckCircle2 size={16} /> Stripe-backed recurring membership flow</div>
            <div><CheckCircle2 size={16} /> Real model-backed support responses when configured</div>
          </div>
          <button className="button primary auth-button" onClick={beginCheckout} disabled={!apiReady || !stripeConfigured || isLoadingCheckout}>
            {stripeConfigured ? 'Start checkout' : 'Stripe setup required'} <ArrowRight size={16} />
          </button>
          <p className="product-copy gate-helper">
            Status: {subscriptionStatus}. {!stripeConfigured ? 'Add Stripe test keys and a monthly price ID in the backend environment to enable checkout.' : 'Checkout will open in Stripe test mode.'}
          </p>
        </div>
      </section>
    )
  } else {
    content = (
      <section className="product-grid reveal reveal-delay-2">
        <aside className="onboarding-panel">
          <div className="panel-topline">
            <span className="eyebrow">Onboarding</span>
            <span className="panel-step">Step {step} of 3</span>
          </div>

          <h1 className="product-title">
            Start with what you need
            <span> tonight.</span>
          </h1>
          <p className="product-copy">
            Pick the tone, set the mood, and begin a guided support conversation without pretending you have to be okay first.
          </p>

          <div className="progress-row" aria-hidden="true">
            <span className={step >= 1 ? 'progress-dot active' : 'progress-dot'} />
            <span className={step >= 2 ? 'progress-dot active' : 'progress-dot'} />
            <span className={step >= 3 ? 'progress-dot active' : 'progress-dot'} />
          </div>

          {step === 1 ? (
            <div className="flow-card">
              <div className="flow-heading">Choose your listener</div>
              <div className="listener-stack">
                {listeners.map((item) => (
                  <button
                    key={item.id}
                    className={item.id === selectedListenerId ? `listener-option selected ${item.accent}` : `listener-option ${item.accent}`}
                    onClick={async () => {
                      setSelectedListenerId(item.id)
                      if (started && membershipActive) {
                        const history = await loadChatHistory(item.id)
                        setMessages(history)
                      }
                    }}
                  >
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.description}</p>
                    </div>
                    <span className="option-tone">{item.tone}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flow-card">
              <div className="flow-heading">What are you walking in with?</div>
              <div className="chip-grid">
                {moods.map((item) => (
                  <button
                    key={item}
                    className={item === selectedMood ? 'choice-chip selected' : 'choice-chip'}
                    onClick={() => setSelectedMood(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <label className="field-label">
                What would feel helpful by the end of this conversation?
                <input className="text-input" value={goal} onChange={(event) => setGoal(event.target.value)} />
              </label>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flow-card">
              <div className="flow-heading">Set up the first exchange</div>
              <label className="field-label">
                What should Northstar call you?
                <input className="text-input" value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="Optional" />
              </label>
              <label className="field-label">
                Start with a message
                <textarea className="text-area" value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} />
              </label>
              <div className="starter-row">
                {chatStarters.map((item) => (
                  <button key={item} className="starter-pill" onClick={() => setDraft(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="panel-actions">
            <button className="button ghost" onClick={resetSession}>
              Reset session
            </button>
            <button className="button ghost" onClick={goPrevStep} disabled={step === 1}>
              <CornerDownLeft size={16} /> Back
            </button>
            {step < 3 ? (
              <button className="button primary" onClick={goNextStep}>
                Continue <ArrowRight size={16} />
              </button>
            ) : (
              <button className="button primary" onClick={startSession}>
                Open chat <ArrowRight size={16} />
              </button>
            )}
          </div>

          <div className="member-actions">
            <button className="button ghost" onClick={openBillingPortal} disabled={!stripeConfigured || isOpeningPortal}>
              Manage billing
            </button>
            <button className="button ghost" onClick={signOut}>
              Sign out
            </button>
          </div>

          <div className="safety-note">
            <ShieldAlert size={16} /> Northstar is for emotional support and reflection. In a crisis, the interface should route to urgent human help.
          </div>
        </aside>

        <section className="chat-panel">
          <div className={`chat-header ${listener.accent}`}>
            <div>
              <div className="chat-kicker">Active guide</div>
              <h2>{listener.name}</h2>
              <p>{listener.tone}</p>
            </div>
            <div className="chat-badge">
              <Compass size={16} /> {modelConfigured ? 'Northstar AI live' : 'Northstar fallback mode'}
            </div>
          </div>

          <div className="chat-body">
            {!started ? (
              <div className="chat-empty">
                <MessageCircleHeart size={28} />
                <h3>Your session will appear here.</h3>
                <p>
                  Finish the onboarding steps to preview a real support conversation with your selected listener style.
                </p>
                <div className="empty-preview">
                  <span className="preview-label">Tonight&apos;s setup</span>
                  <strong>{listener.name}</strong>
                  <span>{selectedMood}</span>
                  <span>Goal: {goal}</span>
                </div>
              </div>
            ) : (
              <>
                <div className="message-list">
                  {messages.map((message, index) => (
                    <article key={`${message.role}-${index}`} className={message.role === 'user' ? 'message user' : message.role === 'system' ? 'message system' : 'message assistant'}>
                      <div className="message-label">{message.label}</div>
                      <p>{message.text}</p>
                    </article>
                  ))}
                </div>

                <div className="suggestion-row">
                  {listener.suggestions.map((item) => (
                    <button key={item} className="suggestion-pill" onClick={() => sendMessage(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="chat-composer">
            <textarea
              className="composer-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              placeholder="Type what you need help with right now..."
            />
            <button className="button primary" onClick={() => (started ? sendMessage(draft) : startSession())}>
              {started ? 'Send message' : 'Start session'} <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </section>
    )
  }

  return (
    <div className="app therapy-app product-app">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <div className="shell product-shell">
        <div className="constellation constellation-one" />
        <div className="constellation constellation-two" />

        <header className="topbar reveal reveal-delay-1">
          <div className="brand-lockup reveal reveal-delay-1">
            <div className="brand-mark" aria-hidden="true">
              <svg className="brand-logo" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="northstarGradient" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#201517" />
                    <stop offset="0.58" stopColor="#5D2847" />
                    <stop offset="1" stopColor="#F09D48" />
                  </linearGradient>
                </defs>
                <rect x="2" y="2" width="60" height="60" rx="18" className="brand-logo-bg" />
                <path d="M32 12V52" className="brand-logo-line" />
                <path d="M12 32H52" className="brand-logo-line" />
                <path d="M20 20L44 44" className="brand-logo-soft" />
                <path d="M44 20L20 44" className="brand-logo-soft" />
                <circle cx="32" cy="20" r="6" className="brand-logo-star" />
                <path d="M24 46L30.5 30H33.8L40 46H35.8L31.9 35.2L27.7 46H24Z" className="brand-logo-letter" />
              </svg>
            </div>
            <div>
              <div className="brand-name">Northstar</div>
              <div className="brand-sub">a steady guide for difficult nights</div>
            </div>
          </div>
          <div className="session-pills">
            <button className="session-pill session-pill-button" onClick={() => setShowEmailModal(true)}>
              <Gift size={14} /> Claim founding offer
            </button>
            <span className="session-pill">$24/month</span>
            <span className="session-pill muted">support membership</span>
          </div>
        </header>

        {content}

        {apiError ? <div className="api-banner">{apiError}</div> : null}

        <section className="membership-band reveal reveal-delay-4">
          <div className="membership-copy">
            <span className="eyebrow">Membership</span>
            <h2>One subscription. Three emotional tones. Ongoing support.</h2>
            <p>
              Northstar is positioned as a monthly support product, with flexible listener switching, saved conversation history, and guided rituals that help users come back before things escalate.
            </p>
          </div>
          <div className="membership-card">
            <div className="membership-price">$24<span>/month</span></div>
            <div className="membership-list">
              <div><CheckCircle2 size={16} /> Unlimited listener switching</div>
              <div><CheckCircle2 size={16} /> Guided sessions and saved chats</div>
              <div><CheckCircle2 size={16} /> Reflection prompts and daily resets</div>
            </div>
          </div>
        </section>

        {showEmailModal ? (
          <div className="modal-backdrop" role="presentation">
            <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="email-offer-title">
              <button className="modal-close" onClick={() => setShowEmailModal(false)} aria-label="Close offer">
                <X size={18} />
              </button>
              <div className="modal-icon"><Gift size={22} /></div>
              <span className="eyebrow">Founding member offer</span>
              <h2 id="email-offer-title" className="modal-title">Drop your email and lock in a better start.</h2>
              <p className="product-copy">
                Join the list and get the founding member rate locked for 3 months plus the Northstar Reset Pack: guided grounding prompts, recovery check-ins, and a first-week ritual plan.
              </p>
              <label className="field-label">
                Best email
                <input className="text-input" value={emailCapture} onChange={(event) => setEmailCapture(event.target.value)} placeholder="you@example.com" />
              </label>
              <button className="button primary auth-button" onClick={captureEmailLead}>
                Claim the offer <ArrowRight size={16} />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
