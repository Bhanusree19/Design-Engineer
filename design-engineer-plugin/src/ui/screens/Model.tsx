// Flow E: one AI model for the whole account. Choose an agent; a connected one
// is used straight away, otherwise its Connect screen opens. Back returns to
// whichever screen opened the picker.

import React, { useEffect, useState } from 'react';
import * as api from '../../api/client';
import { BackHeader, Body, Footer, Messages, WaitRow } from '../components/Chrome';
import { Check, Copy, External, Globe, Shield } from '../components/Icons';
import { agentLabel, providerLabel, type DesignEngineerActions, type DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

const AGENTS: { id: api.Agent; icon: string; detail: string }[] = [
  { id: 'codex', icon: '⌘', detail: 'Sign in with ChatGPT · uses your ChatGPT plan' },
  { id: 'claude', icon: '✳', detail: 'Anthropic API key' },
  { id: 'opencode', icon: '▱', detail: 'Choose a provider and model' },
  { id: 'direct-api', icon: 'API', detail: 'Gemini, DeepSeek, OpenAI or Anthropic key' },
];

export function ModelAgents({ state, actions }: Props) {
  const currentAgent = state.accountModel?.agent === 'gemini-api' ? 'direct-api' : state.accountModel?.agent;
  const [selected, setSelected] = useState<api.Agent>(currentAgent || 'codex');
  const saving = state.busy === 'model';
  const connected = actions.agentConnected(selected);
  return (
    <>
      <BackHeader title="AI model" onBack={actions.back} />
      <Body className="scroll">
        <h3>Choose an AI model</h3>
        <div className="applies"><Globe /><span>Applies to all your projects from the next build.</span></div>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        <div className="agents" role="radiogroup" aria-label="AI model">
          {AGENTS.map((a) => {
            const on = selected === a.id;
            const ok = actions.agentConnected(a.id);
            const current = currentAgent === a.id;
            const detail = current && state.accountModel && (a.id === 'opencode' || a.id === 'direct-api')
              ? [providerLabel(state.accountModel.provider), state.accountModel.model].filter(Boolean).join(' · ')
              : a.detail;
            return (
              <button key={a.id} type="button" role="radio" aria-checked={on} className={`ag ${on ? 'on' : ''}`} onClick={() => setSelected(a.id)}>
                <span className="ic">{a.icon}</span>
                <b>{agentLabel(a.id)}{current ? ' · current' : ''}</b>
                <span className={`stt ${ok ? 'ok' : ''}`}>{ok ? 'Connected' : 'Not connected'}</span>
                <span className="d">{detail}</span>
              </button>
            );
          })}
        </div>
        {connected && selected !== 'codex' && (
          <button type="button" className="link small left" onClick={() => actions.changeModelSettings(selected)}>
            {selected === 'claude' ? 'Use a different key or model' : 'Change provider or model'}
          </button>
        )}
      </Body>
      <Footer>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void actions.chooseAgent(selected)}>
          {saving ? 'Saving…' : connected ? `Use ${agentLabel(selected)}` : `Connect ${agentLabel(selected)}`}
        </button>
      </Footer>
    </>
  );
}

export function ModelConnect(props: Props) {
  const agent: api.Agent = props.state.route.params?.agent || 'codex';
  if (agent === 'codex') return <CodexConnect {...props} />;
  if (agent === 'claude') return <KeyConnect {...props} agent="claude" />;
  return <ProviderConnect {...props} agent={agent} />;
}

function CodexConnect({ state, actions }: Props) {
  const wait = state.codexWait;
  const [copied, setCopied] = useState(true);
  const code = wait?.userCode || '';
  const [left, right] = code.includes('-') ? code.split('-') : [code.slice(0, 4), code.slice(4)];
  return (
    <>
      <BackHeader title="Codex CLI" onBack={actions.back} />
      <Body>
        <h3>Sign in with ChatGPT</h3>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        {!wait ? (
          state.error ? null : <WaitRow label="Opening OpenAI sign-in" />
        ) : wait.userCode ? (
          <>
            <p className="lede">We opened OpenAI's sign-in page and copied this code. Paste it there.</p>
            <div className="keys" role="img" aria-label={`Code ${code}`}>
              {left.split('').map((c, i) => <span className="key" key={`l${i}`}>{c}</span>)}
              {right && <i />}
              {right.split('').map((c, i) => <span className="key" key={`r${i}`}>{c}</span>)}
            </div>
            <div className="btn-row">
              <button type="button" className="btn btn-ghost" onClick={() => { actions.copyText(code); setCopied(true); }}>
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy code'}
              </button>
              <a className="btn btn-ghost" href={wait.verificationUrl || '#'} target="_blank" rel="noreferrer"><External />Open page</a>
            </div>
            <div className="grow" />
            <WaitRow label="Waiting for approval" />
          </>
        ) : (
          <>
            <p className="lede">Finish signing in with ChatGPT in the browser window that opened. No code is needed.</p>
            <div className="grow" />
            <WaitRow label="Waiting for approval" />
          </>
        )}
        <p className="lede flush small">Uses your ChatGPT plan, so no API key is needed.</p>
      </Body>
      <Footer>
        {state.error ? (
          <button type="button" className="btn btn-primary" onClick={() => void actions.startCodexConnect()}>Try again</button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={actions.back}>Cancel</button>
        )}
      </Footer>
    </>
  );
}

function KeyConnect({ state, actions, agent }: Props & { agent: api.Agent }) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(state.accountModel?.agent === agent ? state.accountModel.model || '' : '');
  const saved = actions.isConnected(agent, 'anthropic');
  const verifying = state.busy === 'verify' || state.busy === 'model';
  return (
    <>
      <BackHeader title={agentLabel(agent)} onBack={actions.back} />
      <Body>
        <h3>Add your Anthropic API key</h3>
        <form
          id="key-connect"
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void actions.connectModel(agent, 'anthropic', model.trim() || null, key);
          }}
        >
          <label className="field">
            <span className="field-label">API key {saved && <span>Leave empty to keep the saved key</span>}</span>
            <input className={`input ${state.error ? 'bad' : ''}`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
            {state.error && <span className="err">{state.error}</span>}
          </label>
          <label className="field">
            <span className="field-label">Model <span>Optional</span></span>
            <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Claude Code's default model" />
          </label>
        </form>
        <div className="points"><div><Shield className="ico" /><span>Your key is encrypted and only used for your builds.</span></div></div>
      </Body>
      <Footer>
        <button type="submit" form="key-connect" className="btn btn-primary" disabled={verifying || (!key.trim() && !saved)}>
          {verifying ? 'Checking with Anthropic…' : 'Verify and use'}
        </button>
      </Footer>
    </>
  );
}

const OPENCODE_PROVIDERS: { id: api.ModelProvider; label: string }[] = [
  { id: 'opencode', label: 'OpenCode models' },
  { id: 'ollama-cloud', label: 'Ollama Cloud' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'moonshotai', label: 'Kimi / Moonshot' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
];
const DIRECT_PROVIDERS: { id: api.DirectProvider; label: string }[] = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
];

function ProviderConnect({ state, actions, agent }: Props & { agent: api.Agent }) {
  const direct = agent === 'direct-api' || agent === 'gemini-api';
  const options = direct ? DIRECT_PROVIDERS : OPENCODE_PROVIDERS;
  const current = state.accountModel && (state.accountModel.agent === agent || (direct && state.accountModel.agent === 'gemini-api')) ? state.accountModel : null;
  const [provider, setProvider] = useState<api.ModelProvider>((current?.provider as api.ModelProvider) || options[0].id);
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState(current?.model || '');
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const saved = actions.isConnected(direct ? 'direct-api' : agent, provider);
  const verifying = state.busy === 'verify' || state.busy === 'model';
  const keyOptional = !direct && provider === 'opencode';

  useEffect(() => {
    if (direct) return;
    let live = true;
    setModels(null);
    setCatalogError(null);
    api.listModels(provider)
      .then((d) => live && setModels(d.models || []))
      .catch(() => live && setCatalogError('The model list is unavailable. Enter an exact model ID instead.'));
    return () => {
      live = false;
    };
  }, [direct, provider]);

  async function loadDirect() {
    setLoading(true);
    setCatalogError(null);
    try {
      const d = await api.listDirectModels(provider as api.DirectProvider, key.trim() || undefined);
      setModels(d.models || []);
      if (!(d.models || []).includes(model)) setModel('');
    } catch {
      setCatalogError(`Couldn't list ${providerLabel(provider)} models. Check the key, or reuse a saved one.`);
    } finally {
      setLoading(false);
    }
  }

  const label = options.find((o) => o.id === provider)?.label || providerLabel(provider);
  return (
    <>
      <BackHeader title={agentLabel(agent)} onBack={actions.back} />
      <Body className="scroll">
        <h3>Choose a provider and model</h3>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        <form
          id="provider-connect"
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void actions.connectModel(direct ? 'direct-api' : agent, provider, model.trim() || null, key);
          }}
        >
          <label className="field">
            <span className="field-label">Provider</span>
            <select className="input" aria-label="Provider" value={provider} onChange={(e) => { setProvider(e.target.value as api.ModelProvider); setModel(''); setModels(null); setKey(''); }}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{label} API key {keyOptional ? <span>Optional</span> : saved ? <span>Leave empty to keep the saved key</span> : null}</span>
            <input className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" />
          </label>
          {direct && (
            <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void loadDirect()}>
              {loading ? 'Loading models…' : 'Load available models'}
            </button>
          )}
          <label className="field">
            <span className="field-label">Model</span>
            <select className="input" aria-label="Model" value={models?.includes(model) ? model : ''} onChange={(e) => setModel(e.target.value)} disabled={!models?.length}>
              <option value="">{models === null ? (direct ? 'Listed after loading models' : 'Loading models…') : models.length ? 'Select a model' : 'No models listed'}</option>
              {(models || []).map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            {catalogError && <span className="help">{catalogError}</span>}
          </label>
          {!direct && (
            <label className="field">
              <span className="field-label">Or an exact model ID <span>Optional</span></span>
              <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={`${provider}/model`} />
            </label>
          )}
        </form>
        <div className="points"><div><Shield className="ico" /><span>Keys are encrypted and only used for your builds. Provider charges may apply.</span></div></div>
      </Body>
      <Footer>
        <button type="submit" form="provider-connect" className="btn btn-primary" disabled={verifying || !model.trim() || (!key.trim() && !saved && !keyOptional)}>
          {verifying ? 'Checking access…' : 'Verify and use'}
        </button>
      </Footer>
    </>
  );
}
