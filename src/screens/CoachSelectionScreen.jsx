import React from 'react'
import { ArrowRight, CornerDownLeft } from 'lucide-react'
import { coaches } from '../config/coaches'

export default function CoachSelectionScreen({ selectedCoachId, onSelectCoach, onContinue, onBack }) {
  return (
    <section className="auth-shell reveal reveal-delay-2">
      <div className="auth-card">
        <span className="eyebrow">Step 2</span>
        <h1 className="product-title">
          Choose your
          <span> coach.</span>
        </h1>
        <p className="product-copy">
          Pick the support style you want to carry into your session. You can switch later; each coach keeps its own lightweight memory.
        </p>

        <div className="listener-stack">
          {coaches.map((coach) => (
            <button
              key={coach.id}
              className={coach.id === selectedCoachId ? `listener-option selected ${coach.accent}` : `listener-option ${coach.accent}`}
              onClick={() => onSelectCoach(coach.id)}
            >
              <div>
                <strong>{coach.name}</strong>
                <p>{coach.description}</p>
                <div className="coach-detail">{coach.whenToChoose}</div>
                <div className="coach-memory-note">{coach.memoryNote}</div>
              </div>
              <span className="option-tone">{coach.tone}</span>
            </button>
          ))}
        </div>

        <div className="panel-actions">
          <button className="button ghost" onClick={onBack}>
            <CornerDownLeft size={16} /> Back
          </button>
          <button className="button primary" onClick={onContinue}>
            Continue <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </section>
  )
}
