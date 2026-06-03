import React, { useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { Gift } from 'lucide-react'
import { coaches } from './config/coaches'
import HomeScreen from './screens/HomeScreen'
import CoachSelectionScreen from './screens/CoachSelectionScreen'
import MainExperienceScreen from './screens/MainExperienceScreen'

export default function App() {
  const [screen, setScreen] = useState('home')
  const [selectedCoachId, setSelectedCoachId] = useState(coaches[0].id)

  return (
    <>
      <div className="app therapy-app product-app">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        <div className="shell product-shell">
          <div className="constellation constellation-one" />
          <div className="constellation constellation-two" />

          <header className="topbar reveal reveal-delay-1">
            <div className="brand-lockup reveal reveal-delay-1">
              <div className="brand-mark">
                <img
                  className="brand-logo-image"
                  src="/sentryharbor-logo.jpg"
                  alt="Sentryharbor logo"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none'
                  }}
                />
                <svg className="brand-logo brand-logo-fallback" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <defs>
                    <linearGradient id="sentryharborGradient" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
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
                <div className="brand-name">Sentryharbor</div>
                <div className="brand-sub">a steady guide for difficult nights</div>
              </div>
            </div>
            <div className="session-pills">
              <span className="session-pill session-pill-button">
                <Gift size={14} /> Founding offer
              </span>
              <span className="session-pill">7-day free trial</span>
              <span className="session-pill">$19/month after</span>
              <span className="session-pill muted">support membership</span>
            </div>
          </header>

          {screen === 'home' ? <HomeScreen onContinue={() => setScreen('coach-selection')} /> : null}

          {screen === 'coach-selection' ? (
            <CoachSelectionScreen
              selectedCoachId={selectedCoachId}
              onSelectCoach={setSelectedCoachId}
              onContinue={() => setScreen('main')}
              onBack={() => setScreen('home')}
            />
          ) : null}

          {screen === 'main' ? <MainExperienceScreen selectedCoachId={selectedCoachId} onChangeCoach={() => setScreen('coach-selection')} /> : null}
        </div>
      </div>
      <Analytics />
    </>
  )
}
