import React, {useEffect,useRef,useState} from 'react';
import * as api from '../../api/client';
import {Body,ErrorBanner,Footer,Header,Rail} from '../components/Chrome';
import type {DesignEngineerState,DesignEngineerActions} from '../hooks/useDesignEngineer';
import type {Agent,ModelProvider} from '../../api/client';
const cliChoices: {id: Agent; title: string; detail: string}[] = [
 {id:'codex',title:'Codex CLI',detail:'Connect your OpenAI account'},
 {id:'claude',title:'Claude Code CLI',detail:'Use your Anthropic API key with Claude Code'},
 {id:'opencode',title:'OpenCode CLI',detail:'Use a supported OpenCode provider and model'}
];
const directProviders: {id: api.DirectProvider; label: string}[] = [
 {id:'gemini',label:'Google Gemini'},
 {id:'deepseek',label:'DeepSeek'},
 {id:'openai',label:'OpenAI API'},
 {id:'anthropic',label:'Anthropic API'}
];
export default function AgentSelection({state,actions}:{state:DesignEngineerState; actions:DesignEngineerActions}){
 const initial=state.selectedProject;
 const [agent,setAgent]=useState<Agent>(initial?.coding_agent==='gemini-api'?'direct-api':initial?.coding_agent||'codex');
 const [provider,setProvider]=useState<ModelProvider>(initial?.model_provider||'opencode');
 const [model,setModel]=useState(initial?.model_id||'');
 const [apiKey,setApiKey]=useState('');
 const [availableModels,setAvailableModels]=useState<string[]>([]);
 const [catalogLoading,setCatalogLoading]=useState(false);
 const [catalogError,setCatalogError]=useState(false);
 const configRef=useRef<HTMLElement|null>(null);
 const didMount=useRef(false);
 useEffect(()=>{
   if(!didMount.current){didMount.current=true;return}
   configRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
 },[agent]);
 useEffect(()=>{
   if(agent!=='opencode')return;
   let active=true;setCatalogError(false);setAvailableModels([]);
   api.listModels(provider).then(data=>{if(active)setAvailableModels(data.models||[])})
     .catch(()=>{if(active)setCatalogError(true)});
   return ()=>{active=false};
 },[agent,provider]);
 const saving=state.waiting==='saving';
 const effectiveProvider=agent==='codex'?'openai':agent==='claude'?'anthropic':agent==='direct-api'?(directProviders.some(p=>p.id===provider)?provider:'gemini'):provider;
 async function loadDirectModels(){
   setCatalogLoading(true);setCatalogError(false);
   try {
     const result=await api.listDirectModels(effectiveProvider as api.DirectProvider,apiKey.trim()||undefined);
     setAvailableModels(result.models||[]);
     if(!result.models.includes(model))setModel('');
   }catch {setCatalogError(true)}
   finally{setCatalogLoading(false)}
 }
 function switchAgent(next:Agent){
   setAgent(next);setModel('');setApiKey('');setCatalogError(false);setAvailableModels([]);
   setProvider(next==='direct-api'?'gemini':'opencode');
   actions.dismissError();
 }
 return <>
  <Header state={state} actions={actions}/><Rail step="agent"/><Body>
   <h1>Choose AI coding agent</h1>
   {state.error&&<ErrorBanner message={state.error}/>}
   <p className="lede">Select an agent to implement your Figma screens. Model providers and authentication differ by agent.</p>
   <p className="lede"><b>Coding CLI agents</b> — run a coding-agent CLI to implement your designs.</p>
   <div className="stack-options">{cliChoices.map(choice=><button type="button" key={choice.id}
     disabled={saving} className={'stack-option '+(agent===choice.id?'selected':'')}
     onClick={()=>switchAgent(choice.id)}>
    <span className="stack-radio" aria-hidden="true"/><span className="stack-option-copy">
    <b>{choice.title}</b><span>{choice.detail}</span></span>
   </button>)}</div>
   <p className="lede"><b>Direct Model API</b> — call the selected model provider using an API key, without a coding CLI.</p>
   <div className="stack-options"><button type="button"
     disabled={saving} className={'stack-option '+(agent==='direct-api'?'selected':'')}
     onClick={()=>switchAgent('direct-api')}>
     <span className="stack-radio" aria-hidden="true"/><span className="stack-option-copy">
       <b>Direct API (Gemini / DeepSeek / OpenAI / Anthropic)</b>
       <span>Choose a provider, enter its API key and verify the model</span>
     </span></button></div>
   <section ref={configRef} className="agent-config" aria-label="Selected coding agent configuration">
     <p className="lede"><b>Selected:</b> {agent==='direct-api'?'Direct Model API':agent==='codex'?'Codex CLI':agent==='claude'?'Claude Code CLI':'OpenCode CLI'}</p>
   {agent==='opencode'&&<>
    <label className="auth-field"><span>Model provider</span><select value={provider} onChange={e=>{setProvider(e.target.value as ModelProvider);setModel('');setApiKey('')}}>
      <option value="opencode">OpenCode models (free models where available)</option>
      <option value="ollama-cloud">Ollama Cloud</option><option value="deepseek">DeepSeek</option>
      <option value="moonshotai">Kimi / Moonshot</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option>
    </select></label>
    <label className="auth-field"><span>Model</span>
      <select value={availableModels.includes(model)?model:''} onChange={e=>setModel(e.target.value)}>
        <option value="">Select an available model</option>
        {availableModels.map(id=><option key={id} value={id}>{id}</option>)}
      </select></label>
    {catalogError&&<p className="lede">Model discovery unavailable; check that OpenCode is installed in your backend.</p>}
    <label className="auth-field"><span>Or enter an exact provider/model ID</span>
      <input value={model} onChange={e=>setModel(e.target.value)} placeholder="opencode/big-pickle"/></label>
   </>}
   {agent==='direct-api'&&<>
     <label className="auth-field"><span>Direct API provider</span>
       <select value={effectiveProvider} onChange={e=>{
         setProvider(e.target.value as ModelProvider);
         setModel('');setApiKey('');setAvailableModels([]);setCatalogError(false);
       }}>{directProviders.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
     </label>
     <p className="lede">Direct API does not require any coding CLI sign-in. API access and usage charges depend on your provider account.</p>
     <label className="auth-field"><span>API key (leave blank to reuse an already verified connection)</span>
       <input type="password" autoComplete="off" value={apiKey}
         onChange={e=>{setApiKey(e.target.value);setAvailableModels([]);setModel('');}}
         placeholder="Paste your selected provider's API key"/></label>
     <button className="btn btn-ghost" type="button" disabled={catalogLoading||saving}
       onClick={()=>void loadDirectModels()}>{catalogLoading?'Loading models…':'Load available models'}</button>
     {catalogError&&<p className="lede">Model discovery failed. Enter a valid key, check your provider account, or reuse a saved connection.</p>}
     <label className="auth-field"><span>Choose model</span><select value={availableModels.includes(model)?model:''}
       onChange={e=>setModel(e.target.value)}>
       <option value="">Select an available model</option>
       {availableModels.map(id=><option key={id} value={id}>{id}</option>)}
     </select></label>
   </>}
   {agent==='codex'&&<p className="lede">Uses your existing Codex connection.</p>}
   {agent==='claude'&&<p className="lede">Connect a supported Anthropic API key. Claude account login is not automatically shared with this server.</p>}
   {(agent==='claude'||agent==='opencode')&&
     <label className="auth-field"><span>{agent==='opencode'&&provider==='opencode'?'OpenCode account API key (optional; use when required)':'Provider API key (leave blank to reuse saved connection)'}</span>
       <input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Secret API key"/></label>}
   </section>
   <p className="lede">Continue verifies model access using a small test request. This may incur provider usage charges. Free-tier models can still require an account or API key.</p>
  </Body><Footer>
   <button type="button" className="btn btn-ghost" disabled={saving} onClick={actions.goBack}>Back</button>
   <button type="button" className="btn btn-primary"
     title={(agent==='opencode'||agent==='direct-api')&&!model.trim()?'Choose a model above to continue':'Verify the selected agent connection'}
     disabled={saving||catalogLoading||((agent==='opencode'||agent==='direct-api')&&!model.trim())} onClick={()=>void actions.chooseAgent(agent,effectiveProvider,model||null,apiKey)}>{saving?'Checking model access…':'Verify connection & Continue'}</button>
  </Footer>
 </>;
}
