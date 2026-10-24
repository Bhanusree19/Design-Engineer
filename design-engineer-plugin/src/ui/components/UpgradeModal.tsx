import React from 'react';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

export default function UpgradeModal({ state, actions }: Props) {
  const plans = [...(state.plans || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const currentSlug = state.currentPlan?.slug || state.subscription?.plan_slug || 'free';

  return (
    <div className="modal-backdrop" onClick={actions.closeUpgrade}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Upgrade your plan</h2>
          <button className="btn btn-ghost" type="button" onClick={actions.closeUpgrade}>Close</button>
        </header>
        <div className="modal-body">
          {state.upgradeModal?.reason && <p className="lede">{state.upgradeModal.reason}</p>}
          <div className="plan-grid">
            {plans.map((plan) => {
              const isCurrent = plan.slug === currentSlug;
              const price = plan.price_inr || 0;
              return (
                <div key={plan.id || plan.slug} className={`plan-card ${isCurrent ? 'current' : ''}`}>
                  <div className="plan-head">
                    <h3>{plan.name}</h3>
                    {isCurrent && <span className="badge">Current</span>}
                  </div>
                  <div className="plan-price">
                    {price === 0 ? 'Free' : `₹${price}`}
                  </div>
                  <ul className="plan-feats">
                    <li>{plan.project_limit} Projects</li>
                    <li>{plan.screen_limit_per_project} Screens per project</li>
                    {Array.isArray(plan.features) && plan.features.map((f: string, i: number) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={isCurrent || state.billingLoading}
                    onClick={() => {
                      if (price === 0) return;
                      actions.startUpgrade(plan.slug);
                    }}
                  >
                    {isCurrent ? 'Current Plan' : price === 0 ? 'Free' : 'Upgrade to Pro/Plan'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
