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
import { coaches } from '../config/coaches'

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

const storageKey = 'sentryharbor.app.state'
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL
const defaultApiBaseUrl = configuredApiBaseUrl || `${window.location.protocol}//${window.location.hostname}:8787/api`

function readSavedState() {
  const current = window.localStorage.getItem(storageKey)
  if (current) {
    return current
  }

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.endsWith('.app.state')) {
      const migrated = window.localStorage.getItem(key)
      if (migrated) {
        window.localStorage.setItem(storageKey, migrated)
        window.localStorage.removeItem(key)
        return migrated
      }
    }
  }

  return ''
}

function buildConversation(coach, userName, mood, goal, message) {
  const introName = userName.trim() || 'friend'
  return [
    {
      role: 'system',
      label: 'Sentryharbor',
      text: `You chose ${coach.name}. ${coach.tone}.`,
    },
    {
      role: 'assistant',
      label: coach.name,
      text: `${coach.opening} ${introName !== 'friend' ? `${introName}, ` : ''}${coach.followUp}`,
    },
    {
      role: 'user',
      label: 'You',
      text: message || `I am feeling ${mood.toLowerCase()} and I want help with ${goal.toLowerCase()}.`,
    },
  ]
}

export default function MainExperienceScreen({ selectedCoachId, onChangeCoach }) {
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [membershipActive, setMembershipActive] = useState(false)
  const [email, setEmail] = useState('')
  const [sessionToken, setSessionToken] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [authStep, setAuthStep] = useState('request')
  const [devAuthCode, setDevAuthCode] = useState('')
  const [step, setStep] = useState(1)
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

  const coach = useMemo(() => coaches.find((item) => item.id === selectedCoachId) || coaches[0], [selectedCoachId])

  useEffect(() => {
    try {
      const raw = readSavedState()
      if (!raw) return
      const saved = JSON.parse(raw)
      setIsSignedIn(Boolean(saved.isSignedIn))
      setMembershipActive(Boolean(saved.membershipActive))
      setEmail(saved.email || '')
      setSessionToken(saved.sessionToken || '')
      setStep(saved.step || 1)
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
    setStep((current) => Math.min(2, current + 1))
  }

  function goPrevStep() {
    setStep((current) => Math.max(1, current - 1))
  }

  function startSession() {
    if (!membershipActive) return
    setMessages(buildConversation(coach, userName, selectedMood, goal, draft))
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
      const data = await postJson('/chat', { listenerId: coach.id, message: nextText }, true)
      setMessages((current) => [...current, { role: 'assistant', label: coach.name, text: data.reply }])
    } catch (error) {
      setApiError(error.message)
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          label: coach.name,
          text: modelConfigured
            ? 'Sentryharbor could not complete the response right now. Try again in a moment.'
            : 'A real model provider is not configured yet, so Sentryharbor is using fallback support responses right now.',
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

  async function loadChatHistory(nextCoachId = coach.id) {
    if (!sessionToken) return []
    try {
      const response = await fetch(`${apiBaseUrl}/chat/history?listenerId=${encodeURIComponent(nextCoachId)}`, {
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
      const history = await loadChatHistory(selectedCoachId)
      if (history.length > 0) {
        setMessages(history)
        setStarted(true)
      }
    }

    hydrateChat()
  }, [apiBaseUrl, isSignedIn, membershipActive, selectedCoachId, sessionToken])

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
            Sentryharbor now uses a verification-code sign in flow instead of trusting raw email in the browser.
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
            {devCodesEnabled
              ? 'Dev auth codes are enabled, so the verification code will appear in-app.'
              : emailConfigured
                ? 'Verification codes are configured to send through the active email provider.'
                : 'Production flow still needs a configured email provider before sign-in works without dev codes.'}
          </p>
        </div>
      </section>
    )
  } else if (!membershipActive) {
    content = (
      <section className="gate-shell reveal reveal-delay-2">
        <div className="gate-card">
          <div className="gate-icon">
            <LockKeyhole size={24} />
          </div>
          <span className="eyebrow">Membership required</span>
          <h1 className="product-title">
            Unlock the full
            <span> support flow.</span>
          </h1>
          <p className="product-copy">
            Start checkout to unlock the live support flow: three differentiated coaches, saved session history, coach-specific memory,
            and recurring access when difficult nights show up again.
          </p>
          <div className="gate-price">
            $24<span>/month</span>
          </div>
          <div className="membership-list gate-list">
            <div>
              <CheckCircle2 size={16} /> Coach W, H, and O with distinct emotional support styles
            </div>
            <div>
              <CheckCircle2 size={16} /> Saved chats and lightweight memory per coach
            </div>
            <div>
              <CheckCircle2 size={16} /> Stripe-backed recurring membership and billing portal
            </div>
          </div>
          <button className="button primary auth-button" onClick={beginCheckout} disabled={!apiReady || !stripeConfigured || isLoadingCheckout}>
            {stripeConfigured ? 'Start checkout' : 'Stripe setup required'} <ArrowRight size={16} />
          </button>
          <p className="product-copy gate-helper">
            Status: {subscriptionStatus}.{' '}
            {!stripeConfigured
              ? 'Add Stripe test keys and a monthly price ID in the backend environment to enable checkout.'
              : 'Checkout will open in Stripe test mode.'}
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
            <span className="panel-step">Step {step} of 2</span>
          </div>

          <h1 className="product-title">
            Start with what you need
            <span> tonight.</span>
          </h1>
          <p className="product-copy">
            You selected {coach.name}. Set the emotional route, name what would help, and start with enough context for the first reply
            to meet the night you are actually in.
          </p>
          <div className={`coach-insight-card ${coach.accent}`}>
            <strong>{coach.tone}</strong>
            <span>{coach.whenToChoose}</span>
            <span>{coach.memoryNote}</span>
          </div>

          <div className="progress-row" aria-hidden="true">
            <span className={step >= 1 ? 'progress-dot active' : 'progress-dot'} />
            <span className={step >= 2 ? 'progress-dot active' : 'progress-dot'} />
          </div>

          {step === 1 ? (
            <div className="flow-card">
              <div className="flow-heading">What are you walking in with?</div>
              <p>
                This helps Sentryharbor route the first response: grounding for overwhelm, warmth for shame or loneliness, accountability for
                avoidance, and reality-testing for distorted stories.
              </p>
              <div className="chip-grid">
                {moods.map((item) => (
                  <button key={item} className={item === selectedMood ? 'choice-chip selected' : 'choice-chip'} onClick={() => setSelectedMood(item)}>
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

          {step === 2 ? (
            <div className="flow-card">
              <div className="flow-heading">Set up the first exchange</div>
              <p>
                A specific first message helps your coach remember the useful stuff over time: triggers, rituals, commitments, distortions,
                and wording that actually reaches you.
              </p>
              <label className="field-label">
                What should Sentryharbor call you?
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
            {step < 2 ? (
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
            <button className="button ghost" onClick={onChangeCoach}>
              Change coach
            </button>
            <button className="button ghost" onClick={openBillingPortal} disabled={!stripeConfigured || isOpeningPortal}>
              Manage billing
            </button>
            <button className="button ghost" onClick={signOut}>
              Sign out
            </button>
          </div>

          <div className="safety-note">
            <ShieldAlert size={16} /> Sentryharbor is emotional support, not therapy, diagnosis, or emergency care. In a crisis, it routes to
            urgent human help.
          </div>
        </aside>

        <section className="chat-panel">
          <div className={`chat-header ${coach.accent}`}>
            <div>
              <div className="chat-kicker">Active guide</div>
              <h2>{coach.name}</h2>
              <p>{coach.tone}</p>
            </div>
            <div className="chat-badge">
              <Compass size={16} /> {modelConfigured ? 'Sentryharbor AI live' : 'Sentryharbor fallback mode'}
            </div>
          </div>

          <div className="chat-body">
            {!started ? (
              <div className="chat-empty">
                <MessageCircleHeart size={28} />
                <h3>Your session will appear here.</h3>
                <p>Finish the onboarding steps to preview a real support conversation with your selected coach.</p>
                <div className="empty-preview">
                  <span className="preview-label">Tonight&apos;s setup</span>
                  <strong>{coach.name}</strong>
                  <span>{selectedMood}</span>
                  <span>Goal: {goal}</span>
                  <span>Memory: coach-specific and lightweight</span>
                </div>
              </div>
            ) : (
              <>
                <div className="message-list">
                  {messages.map((message, index) => (
                    <article
                      key={`${message.role}-${index}`}
                      className={
                        message.role === 'user' ? 'message user' : message.role === 'system' ? 'message system' : 'message assistant'
                      }
                    >
                      <div className="message-label">{message.label}</div>
                      <p>{message.text}</p>
                    </article>
                  ))}
                </div>

                <div className="suggestion-row">
                  {coach.suggestions.map((item) => (
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
    <>
      {content}

      {apiError ? <div className="api-banner">{apiError}</div> : null}

      <section className="membership-band reveal reveal-delay-4">
        <div className="membership-copy">
          <span className="eyebrow">Membership</span>
          <h2>One subscription. Three emotional tones. Ongoing support.</h2>
          <p>
            Sentryharbor is a monthly support product with flexible coach switching, saved conversation history, coach-specific memory, and
            guided resets that help users come back before things escalate.
          </p>
        </div>
        <div className="membership-card">
          <div className="membership-price">
            $24<span>/month</span>
          </div>
          <div className="membership-list">
            <div>
              <CheckCircle2 size={16} /> Unlimited coach switching
            </div>
            <div>
              <CheckCircle2 size={16} /> Guided sessions, saved chats, and coach memory
            </div>
            <div>
              <CheckCircle2 size={16} /> Emotional routing for spirals, shame, loneliness, and avoidance
            </div>
          </div>
        </div>
      </section>

      {showEmailModal ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="email-offer-title">
            <button className="modal-close" onClick={() => setShowEmailModal(false)} aria-label="Close offer">
              <X size={18} />
            </button>
            <div className="modal-icon">
              <Gift size={22} />
            </div>
            <span className="eyebrow">Founding member offer</span>
            <h2 id="email-offer-title" className="modal-title">
              Drop your email and lock in a better start.
            </h2>
            <p className="product-copy">
              Join the list and get the founding member rate locked for 3 months plus the Sentryharbor Reset Pack: guided grounding prompts,
              recovery check-ins, and a first-week ritual plan.
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
    </>
  )
}
