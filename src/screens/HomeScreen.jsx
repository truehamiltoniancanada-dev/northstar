import React from 'react'
import { ArrowRight } from 'lucide-react'

export default function HomeScreen({ onContinue }) {
  return (
    <section className="auth-shell reveal reveal-delay-2">
      <div className="auth-card">
        <span className="eyebrow">Welcome</span>
        <h1 className="product-title">
          Find your
          <span> Northstar.</span>
        </h1>
        <p className="product-copy">
          A paid emotional support membership for difficult nights, spirals, shame, loneliness, and confusion. It is not therapy or emergency care.
        </p>
        <div className="intro-list">
          <div>
            <strong>Three coaches</strong>
            <span>Pick calm strategy, warm accountability, or blunt clarity depending on the night.</span>
          </div>
          <div>
            <strong>Useful memory</strong>
            <span>Each coach keeps lightweight notes on your triggers, rituals, commitments, and repeat loops.</span>
          </div>
          <div>
            <strong>Membership access</strong>
            <span>Subscription unlocks saved chat history, coach switching, and live model-backed support when configured.</span>
          </div>
        </div>
        <div className="panel-actions">
          <button className="button primary auth-button" onClick={onContinue}>
            Choose your coach <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </section>
  )
}
