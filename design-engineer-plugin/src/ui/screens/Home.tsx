// Flow B: Home (projects), account sheet, new project, plans and minutes.

import React, { useState } from 'react';
import * as api from '../../api/client';
import { AppHeader, BackHeader, Body, Footer, Messages, Sheet, SyncIcon, WaitRow } from '../components/Chrome';
import { Clock, Github, Logout, Model, More, Plus, Swap } from '../components/Icons';
import {
  agentDetail,
  agentLabel,
  projectSync,
  readableSeconds,
  stackLabel,
  type DesignEngineerActions,
  type DesignEngineerState,
} from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

function initialOf(email: string | null | undefined) {
  return (email || '?').trim().charAt(0).toUpperCase() || '?';
}

function minutesLeft(b: api.BillingStatus | null) {
  if (!b) return null;
  return Math.floor(Math.max(0, b.usage.availableSeconds) / 60);
}

function renewDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year:'numeric' });
}

export function MinuteBar({ state, actions }: Props) {
  const b = state.billing;
  if (!b) return null;
  const left = minutesLeft(b);
  const renews = renewDate(b.usage.expiresAt);
  const free = b.usage.plan === 'free';
  return (
    <div className="minibar">
      <Clock className="ico muted" />
      <span>
        <b>{free ? 'Free plan' : b.usage.planName}</b> · {left} min left{!free && renews ? ` · ${b.renewal?.autoRenew ? 'renews' : 'ends'} ${renews}` : ''}
      </span>
      <button type="button" className="link" onClick={() => void actions.openBilling()}>{free ? 'Upgrade' : 'Manage'}</button>
    </div>
  );
}

function ProjectRow({ p, state, actions }: Props & { p: api.Project }) {
  const [menu, setMenu] = useState<null | 'menu' | 'rename' | 'delete'>(null);
  const [name, setName] = useState(p.name);
  const running = state.runningJob?.projectId === p.id;
  const sync = projectSync(p, state.projectStates[p.id]);
  const sub = p.repository ? `${p.repository} · ${p.base_branch}` : 'No repo linked yet';

  if (menu === 'delete') {
    return (
      <div className="prow confirm" role="group" aria-label={`Delete ${p.name}`}>
        <p><b>Delete {p.name}?</b> Its saved screens and repo links are removed too. Nothing on GitHub is changed.</p>
        <div className="acts">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMenu(null)}>Keep</button>
          <button type="button" className="btn btn-danger btn-sm" disabled={state.busy === 'delete'} onClick={() => void actions.deleteProject(p.id)}>
            Delete project
          </button>
        </div>
      </div>
    );
  }
  if (menu === 'rename') {
    return (
      <form
        className="prow rename"
        onSubmit={(e) => {
          e.preventDefault();
          void actions.renameProject(p.id, name);
          setMenu(null);
        }}
      >
        <input className="input grow-x" aria-label="Project name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMenu(null)}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>Save</button>
      </form>
    );
  }
  return (
    <div className="prow-wrap">
      <div className="prow">
        <button type="button" className="prow-main" onClick={() => actions.openProject(p.id)}>
          <span className="pic" aria-hidden="true">{initialOf(p.name)}</span>
          <span className="tx">
            <b>{p.name}</b>
            <span className={p.repository ? '' : 'none'}>{sub}</span>
          </span>
          {running ? <span className="tag run">Building</span> : p.stack ? <span className="tag">{stackLabel(p.stack)}</span> : null}
          <SyncIcon kind={sync} />
        </button>
        <button type="button" className={`kebab ${menu === 'menu' ? 'on' : ''}`} aria-label={`More for ${p.name}`} aria-expanded={menu === 'menu'} onClick={() => setMenu(menu === 'menu' ? null : 'menu')}>
          <More className="ico" />
        </button>
      </div>
      {menu === 'menu' && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" onClick={() => setMenu('rename')}>Rename</button>
          <button type="button" role="menuitem" className="danger" onClick={() => setMenu('delete')}>Delete</button>
        </div>
      )}
    </div>
  );
}

export function Home({ state, actions }: Props) {
  const list = state.projects;
  const accountOpen = state.sheet?.kind === 'account';
  return (
    <>
      <AppHeader initial={initialOf(state.user?.email)} active={accountOpen} onAvatar={() => actions.setSheet(accountOpen ? null : { kind: 'account' })} />
      <Body>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        {state.busy === 'home' && <WaitRow label="Loading your projects" />}
        {list.length === 0 ? (
          <div className="empty">
            <div>
              <div className="stackart" aria-hidden="true"><i /><i /><i /></div>
              <h5>Start your first project</h5>
              <p>A project holds the Figma screens you build and the GitHub repos they go into.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="sec">
              <h4>Projects</h4>
              <button type="button" className="link small" onClick={actions.newProject}>+ New project</button>
            </div>
            <div className="plist scroll">
              {list.map((p) => <ProjectRow key={p.id} p={p} state={state} actions={actions} />)}
            </div>
            <div className="grow" />
          </>
        )}
        <MinuteBar state={state} actions={actions} />
      </Body>
      {list.length === 0 && (
        <Footer>
          <button type="button" className="btn btn-primary" onClick={actions.newProject}>
            <Plus />
            New project
          </button>
        </Footer>
      )}
      {accountOpen && <AccountSheet state={state} actions={actions} />}
    </>
  );
}

function AccountSheet({ state, actions }: Props) {
  const m = state.accountModel;
  const left = minutesLeft(state.billing);
  return (
    <Sheet label="Account" onClose={() => actions.setSheet(null)}>
      <div className="acct">
        <span className="avatar">{initialOf(state.user?.email)}</span>
        <span className="tx"><b>{state.user?.email}</b><span>Signed in with Google</span></span>
      </div>
      <div>
        <div className="slink">
          <Model className="ico" />
          <span className="tx"><b>AI model</b><span>{m ? `${agentLabel(m.agent)} · ${agentDetail(m)} · all projects` : 'Not chosen yet'}</span></span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { actions.setSheet(null); actions.openModel(); }}>{m ? 'Switch' : 'Choose'}</button>
        </div>
        <div className="slink">
          <Github className="ico" />
          <span className="tx"><b>GitHub</b><span>{state.githubConnected ? `Connected as @${state.githubUser || 'GitHub'}` : 'Not connected'}</span></span>
          {state.githubConnected ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void actions.disconnectGithub()}>Disconnect</button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={actions.connectGithubFromAccount}>Connect</button>
          )}
        </div>
        <div className="slink">
          <Clock className="ico" />
          <span className="tx"><b>Plans and minutes</b><span>{state.billing ? `${state.billing.usage.planName} · ${left} min left` : 'Build minutes and plans'}</span></span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { actions.setSheet(null); void actions.openBilling(); }}>Open</button>
        </div>
        <button type="button" className="slink as-button" onClick={actions.switchGoogleAccount}>
          <Swap className="ico" />
          <span className="tx"><b>Use another Google account</b><span>Signs out here, then opens Google</span></span>
        </button>
        <button type="button" className="slink as-button danger" onClick={actions.logout}>
          <Logout className="ico" />
          <span className="tx"><b>Log out</b><span>Ends your Design Engineer session</span></span>
        </button>
      </div>
    </Sheet>
  );
}

export function NewProject({ state, actions }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const creating = state.busy === 'create';
  return (
    <>
      <BackHeader onBack={actions.back} label="Projects" showLabel />
      <Body>
        <h3>New project</h3>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        <form
          id="new-project"
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void actions.createProject(name, description);
          }}
        >
          <label className="field">
            <span className="field-label">Project name</span>
            <input className="input" value={name} autoFocus maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Grocery delivery app" />
          </label>
          <label className="field">
            <span className="field-label">Description <span>Optional</span></span>
            <textarea className="input textarea" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder="What is this app about? The AI model reads this." />
          </label>
        </form>
        <div className="grow" />
        <p className="lede flush small">You'll link GitHub repos on the next screen.</p>
      </Body>
      <Footer>
        <button type="submit" form="new-project" className="btn btn-primary" disabled={creating || !name.trim()}>
          {creating ? 'Creating…' : 'Create project'}
        </button>
      </Footer>
    </>
  );
}

const PLAN_LINES: Record<string, string> = {
  free: 'Starter minutes for one or two builds',
  plus: 'For regular builds',
  studio: 'For teams building often',
};

export function Billing({ state, actions }: Props) {
  const [showHistory, setShowHistory] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const b = state.billing;
  const u = b?.usage;
  const allowanceMin = u ? Math.floor(u.allowanceSeconds / 60) : 0;
  const leftMin = u ? Math.floor(Math.max(0, u.availableSeconds) / 60) : 0;
  const pct = u && u.allowanceSeconds > 0 ? Math.min(100, Math.round((Math.max(0, u.availableSeconds) / u.allowanceSeconds) * 100)) : 0;
  const renews = renewDate(u?.expiresAt || null);
  const expired = b?.membership?.expired && u?.plan === 'free';
  const canUpgradeTo = (slug: string) => u?.plan === 'free' ? slug === 'plus' || slug === 'studio' : u?.plan === 'plus' && slug === 'studio';
  const plans = (b?.plans || []).slice().sort((a, c) => a.sort_order - c.sort_order);
  const builds = state.billingHistory?.builds || [];
  const renewal = b?.renewal;
  const canCancelRenewal = renewal && !renewal.cancelAtPeriodEnd && ['active','created','authenticated','pending','halted'].includes(renewal.status);
  const activePaid = u?.plan === 'plus' || u?.plan === 'studio';
  return (
    <>
      <BackHeader onBack={actions.back} showLabel />
      <Body className="scroll">
        <h3>Plans and minutes</h3>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        {!b ? (
          <WaitRow label="Loading your minutes" />
        ) : (
          <>
            <div className="meter-row">
              <span><b>{leftMin} min</b> left of {allowanceMin}</span>
              {renews && u?.plan !== 'free' && <span>{renewal?.autoRenew ? 'Renews' : 'Ends'} {renews}</span>}
            </div>
            {expired && <p className="lede" role="status">Your {b?.membership?.previousPlan === 'studio' ? 'Studio' : 'Plus'} plan ended on {renewDate(b?.membership?.periodEnd || null)}. You are now on Free. Upgrade to restore paid benefits.</p>}
            {u?.plan === 'studio' && <p className="lede" role="status">You are already on Studio, our highest plan. No upgrade or additional payment is required.</p>}
            {u?.plan === 'plus' && <p className="lede">You are on Plus. Upgrade to Studio for the next tier.</p>}
            {u?.plan === 'free' && !expired && <p className="lede">You are on Free. Choose Plus or Studio to upgrade.</p>}
            {activePaid && renews && <p className="lede small">{renewal?.autoRenew ? 'Next automatic renewal' : 'Current paid period ends'}: {renews}</p>}
            {activePaid && renewal?.cancelAtPeriodEnd && <p className="lede" role="status">Auto-renewal is cancelled. Your paid benefits continue until {renews || 'the end of your paid period'}.</p>}
            {renewal?.status === 'created' || renewal?.status === 'authenticated' ? <p className="lede" role="status">Subscription authorization pending. Your upgrade starts after a captured payment is verified.</p> : null}
            {renewal?.status === 'pending' || renewal?.status === 'halted' ? <p className="lede" role="alert">Razorpay could not complete automatic renewal. Your existing paid benefits remain only until their end date. Check your mandate or payment method.</p> : null}
            {u?.plan === 'free' && !showHistory && !showPlans && <button type="button" className="btn btn-primary" onClick={() => setShowPlans(true)}>Upgrade your plan</button>}
            {u?.plan === 'plus' && !showHistory && b?.paymentsEnabled && <button type="button" className="btn btn-primary" disabled={state.busy === 'checkout'} onClick={() => void actions.buyPlan('studio')}>Upgrade to Studio</button>}
            {canCancelRenewal && !showHistory && <div className="form">
              {!confirmCancel ? <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(true)}>Cancel automatic renewal</button> : <>
                <p className="lede">Cancel future payments? Your paid benefits remain until the paid period ends.</p>
                <div className="btn-row">
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(false)}>Keep renewal</button>
                  <button type="button" className="btn btn-danger" disabled={state.busy === 'checkout'} onClick={() => { setConfirmCancel(false); void actions.cancelSubscription(); }}>Confirm cancellation</button>
                </div>
              </>}
            </div>}
            {activePaid && !renewal && <p className="lede small">This is a prepaid, one-time membership. Automatic renewal is not enabled for it.</p>}
            <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Build minutes left">
              <i style={{ width: `${pct}%` }} />
            </div>
            {showHistory ? (
              <div className="hist">
                {builds.length === 0 && <p className="lede flush">No builds yet.</p>}
                {builds.map((x) => (
                  <div className="h" key={x.jobId}>
                    <span className="tx">
                      <b>{x.projectName || 'Project'}</b>
                      <span>{x.screenCount} screen{x.screenCount === 1 ? '' : 's'} · {readableSeconds(x.billedSeconds)} charged</span>
                    </span>
                    <span className={`tag ${x.status === 'completed' ? 'ok' : x.status === 'failed' ? 'bad' : 'run'}`}>
                      {x.status === 'completed' ? 'Done' : x.status === 'failed' ? 'Failed' : 'Running'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (u?.plan !== 'free' || showPlans) ? (
              <div className="plans">
                {plans.map((p) => {
                  const currentPlan = u?.plan === p.slug;
                  const paid = p.slug !== 'free';
                  const inner = (
                    <>
                      <b>{p.name}{currentPlan ? ' · current' : ''}</b>
                      <span className="pr-v">₹{p.price_inr.toLocaleString('en-IN')}{paid && <small> / 30 days</small>}</span>
                      <span>{p.build_minutes} build minutes · {PLAN_LINES[p.slug] || ''}</span>
                    </>
                  );
                  const upgradeAllowed = paid && canUpgradeTo(p.slug);
                  return upgradeAllowed && b.paymentsEnabled ? (
                    <button key={p.slug} type="button" className="plan-c" disabled={state.busy === 'checkout'} onClick={() => void actions.buyPlan(p.slug as 'plus' | 'studio')} aria-label={`Upgrade to ${p.name}`}>
                      {inner}
                      <span className="pr-v">Upgrade to {p.name}</span>
                    </button>
                  ) : (
                    <div key={p.slug} className={`plan-c ${currentPlan ? 'on' : ''}`}>
                      {inner}
                      {currentPlan && <span className="help">Current plan · no payment needed</span>}
                      {paid && !currentPlan && !upgradeAllowed && <span className="help">Not available as an upgrade</span>}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <p className="lede flush small">{b?.recurringEnabled ? 'New upgrades use monthly Razorpay AutoPay after your consent. Card and UPI availability depends on the mandate methods enabled for your Razorpay account.' : 'Paid plans currently use manual one-time payments. Auto-renewal is not configured.'}</p>
            <p className="lede flush small">
              {state.startBufferSeconds
                ? `Each build is charged its run time plus ${state.startBufferSeconds} seconds for the server to start.`
                : 'Each build is charged its run time.'}
            </p>
          </>
        )}
      </Body>
      <Footer>
        <button type="button" className="btn btn-ghost" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? 'Plans' : 'Build history'}
        </button>
      </Footer>
    </>
  );
}
