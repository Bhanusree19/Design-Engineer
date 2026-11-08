import React, {useEffect,useState} from 'react';
import * as api from '../../api/client';
import {Body,ErrorBanner,Footer,Header,Rail} from '../components/Chrome';
import type {DesignEngineerState,DesignEngineerActions} from '../hooks/useDesignEngineer';
import type {Agent,ModelProvider} from '../../api/client';
const choices: {id: Agent; title: string; detail: string}[] = [
 {id:'codex',title:'Codex CLI',detail:'Use your existing Codex account'},
 {id:'claude',title:'Claude Code CLI',detail:'Use a supported Anthropic API connection'},
 {id:'opencode',title:'OpenCode CLI',detail:'Choose a free or connected provider model'},
 {id:'gemini-api',title:'Gemini Direct API',detail:'Use a Gemini API key. No Gemini CLI required.'}
];
export default function AgentSelection({state,actions}:{state:DesignEngineerState; actions:DesignEngineerActions}){
 const initial=state.selectedProject;
 const [agent,setAgent]=useState<Agent>(initial?.coding_agent||'codex');
 const [provider,setProvider]=useState<ModelProvider>(initial?.model_provider||'opencode');
 const [model,setModel]=useState(initial?.model_id||'');
 const [apiKey,setApiKey]=useState('');
 const [availableModels,setAvailableModels]=useState<string[]>([]);
 const [geminiLoading,setGeminiLoading]=useState(false);
 const [catalogError,setCatalogError]=useState(false);
 useEffect(()=>{
   if(agent!=='opencode')return;
   let active=true;setCatalogError(false);setAvailableModels([]);
   api.listModels(provider).then(data=>{if(active)setAvailableModels(data.models||[])})
     .catch(()=>{if(active)setCatalogError(true)});
   return ()=>{active=false};
 },[agent,provider]);
 const saving=state.waiting==='saving';
 const effectiveProvider=agent==='codex'?'openai':agent==='claude'?'anthropic':agent==='gemini-api'?'gemini':provider;
 async function loadGeminiModels(){
   setGeminiLoading(true);setCatalogError(false);
   try {const result=await api.listGeminiModels(apiKey.trim()||undefined);
     setAvailableModels(result.models);if(!result.models.includes(model))setModel('');
   }catch {setCatalogError(true)}
   finally{setGeminiLoading(false)}
 }
 return <>
  <Header state={state} actions={actions}/><Rail step="agent"/><Body>
   <h1>Choose AI coding agent</h1>
   {state.error&&<ErrorBanner message={state.error}/>}
   <p className="lede">Select an agent to implement your Figma screens. Model providers and authentication differ by agent.</p>
   <div className="stack-options">{choices.map(choice=><button type="button" key={choice.id} disabled={saving} className={'stack-option '+(agent===choice.id?'selected':'')} onClick={()=>{setAgent(choice.id);setProvider('opencode');setModel('');setApiKey('');setAvailableModels([]);setCatalogError(false)}}>
    <span className="stack-radio" aria-hidden="true"/><span className="stack-option-copy"><b>{choice.title}</b><span>{choice.detail}</span></span>
   </button>)}</div>
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
   {agent==='gemini-api'&&<>
    <p className="lede">Gemini runs through Google's hosted API. No Gemini CLI login or installation is needed.</p>
    <label className="auth-field"><span>Gemini API key (leave blank to reuse a saved key)</span>
      <input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)}
        placeholder="Your Google AI Studio API key"/></label>
    <button className="btn btn-ghost" type="button" disabled={geminiLoading||saving}
      onClick={()=>void loadGeminiModels()}>{geminiLoading?'Loading models…':'Load available Gemini models'}</button>
    {catalogError&&<p className="lede">Could not load Gemini models. Check the API key or saved connection.</p>}
    <label className="auth-field"><span>Gemini model</span><select value={availableModels.includes(model)?model:''}
      onChange={e=>setModel(e.target.value)}>
      <option value="">Select a model</option>{availableModels.map(id=><option key={id} value={id}>{id}</option>)}
    </select></label>
  </>}
   {agent==='codex'&&<p className="lede">Uses your existing Codex connection.</p>}
   {agent==='claude'&&<p className="lede">Connect a supported Anthropic API key. Claude account login is not automatically shared with this server.</p>}
   {(agent==='claude'||agent==='opencode')&&
     <label className="auth-field"><span>{agent==='opencode'&&provider==='opencode'?'OpenCode account API key (optional; use when required)':'Provider API key (leave blank to reuse saved connection)'}</span>
       <input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Secret API key"/></label>}
   <p className="lede">Continue verifies model access using a small test request. This may incur provider usage charges. Free-tier models can still require an account or API key.</p>
  </Body><Footer>
   <button type="button" className="btn btn-ghost" disabled={saving} onClick={actions.goBack}>Back</button>
   <button type="button" className="btn btn-primary" disabled={saving||geminiLoading||((agent==='opencode'||agent==='gemini-api')&&!model.trim())} onClick={()=>void actions.chooseAgent(agent,effectiveProvider,model||null,apiKey)}>{saving?'Checking model access…':'Verify connection & Continue'}</button>
  </Footer>
 </>;
}
