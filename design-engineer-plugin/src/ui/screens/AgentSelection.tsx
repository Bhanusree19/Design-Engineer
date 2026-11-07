import React, {useState} from 'react';
import {Body,ErrorBanner,Footer,Header,Rail} from '../components/Chrome';
import type {DesignEngineerState,DesignEngineerActions} from '../hooks/useDesignEngineer';
import type {Agent,ModelProvider} from '../../api/client';
const choices: {id: Agent; title: string; detail: string}[] = [
 {id:'codex',title:'Codex CLI',detail:'Use your existing Codex account'},
 {id:'claude',title:'Claude Code CLI',detail:'Use a supported Anthropic API connection'},
 {id:'opencode',title:'OpenCode CLI',detail:'Choose a free or connected provider model'}
];
export default function AgentSelection({state,actions}:{state:DesignEngineerState; actions:DesignEngineerActions}){
 const initial=state.selectedProject;
 const [agent,setAgent]=useState<Agent>(initial?.coding_agent||'codex');
 const [provider,setProvider]=useState<ModelProvider>(initial?.model_provider||'opencode');
 const [model,setModel]=useState(initial?.model_id||'');
 const [apiKey,setApiKey]=useState('');
 const saving=state.waiting==='saving';
 const effectiveProvider=agent==='codex'?'openai':agent==='claude'?'anthropic':provider;
 return <>
  <Header state={state} actions={actions}/><Rail step="agent"/><Body>
   <h1>Choose AI coding agent</h1>
   {state.error&&<ErrorBanner message={state.error}/>}
   <p className="lede">Select an agent to implement your Figma screens. Model providers and authentication differ by agent.</p>
   <div className="stack-options">{choices.map(choice=><button type="button" key={choice.id} disabled={saving} className={'stack-option '+(agent===choice.id?'selected':'')} onClick={()=>{setAgent(choice.id);setModel('')}}>
    <span className="stack-radio" aria-hidden="true"/><span className="stack-option-copy"><b>{choice.title}</b><span>{choice.detail}</span></span>
   </button>)}</div>
   {agent==='opencode'&&<>
    <label className="auth-field"><span>Model provider</span><select value={provider} onChange={e=>{setProvider(e.target.value as ModelProvider);setModel('')}}>
      <option value="opencode">OpenCode models (free models where available)</option>
      <option value="ollama-cloud">Ollama Cloud</option><option value="deepseek">DeepSeek</option>
      <option value="moonshotai">Kimi / Moonshot</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option>
    </select></label>
    <label className="auth-field"><span>Model ID (provider/model, optional for CLI default)</span>
      <input value={model} onChange={e=>setModel(e.target.value)} placeholder="opencode/big-pickle"/></label>
   </>}
   {agent==='codex'&&<p className="lede">Uses your existing Codex connection.</p>}
   {agent==='claude'&&<p className="lede">Connect a supported Anthropic API key. Claude account login is not automatically shared with this server.</p>}
   {(agent==='claude'||(agent==='opencode'&&provider!=='opencode'))&&
     <label className="auth-field"><span>Provider API key (leave blank to reuse saved connection)</span>
       <input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Secret API key"/></label>}
   <p className="lede">Free-model access depends on the provider's current rules and limits.</p>
  </Body><Footer>
   <button type="button" className="btn btn-ghost" disabled={saving} onClick={actions.goBack}>Back</button>
   <button type="button" className="btn btn-primary" disabled={saving} onClick={()=>void actions.chooseAgent(agent,effectiveProvider,model||null,apiKey)}>{saving?'Saving…':'Continue'}</button>
  </Footer>
 </>;
}
