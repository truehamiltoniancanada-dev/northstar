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
          A steady guide for difficult nights. Start by choosing the coach voice you want with you tonight.
        </p>
        <div className="panel-actions">
          <button className="button primary auth-button" onClick={onContinue}>
            Choose your coach <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </section>
  )
}
