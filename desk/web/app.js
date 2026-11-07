const $=id=>document.getElementById(id);
const m=location.hash.match(/t=([^&]+)/);
if(m){try{localStorage.setItem('tok',m[1])}catch(e){}history.replaceState(null,'',location.pathname)}
let tok='';try{tok=localStorage.getItem('tok')||''}catch(e){}
let running=false;
function save(t){tok=t;try{localStorage.setItem('tok',t)}catch(e){}}
function showLogin(msg){$('login').classList.add('show');$('lerr').textContent=msg||'';$('pw').focus()}
$('enter').onclick=async()=>{const t=$('pw').value.trim();if(!t)return;
  const r=await fetch('/api/state',{headers:{Authorization:'Bearer '+t}}).catch(()=>null);
  if(r&&r.ok){save(t);$('pw').value='';$('login').classList.remove('show');init()}
  else showLogin(r?'Password sbagliata':'Desk non raggiungibile')};
$('show').onclick=()=>{const t=$('pw').type=='password';$('pw').type=t?'text':'password';$('show').textContent=t?'Nascondi':'Mostra'};
$('pw').onkeydown=e=>{if(e.key==='Enter')$('enter').click()};
$('logout').onclick=()=>{save('');try{localStorage.removeItem('tok')}catch(e){}showLogin()};
async function api(path,method='GET',body){
  const r=await fetch(path,{method,headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(r.status==401){showLogin('Password sbagliata o scaduta');throw new Error('Accesso richiesto')}
  if(!r.ok)throw new Error(r.status==401?'':(await r.json().catch(()=>({}))).detail||r.status);
  return r.json();
}
const usd=n=>(n<0?'-':'+')+'$'+Math.abs(n).toFixed(2);
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function refresh(){
  try{
    const s=await api('/api/state');running=s.running;$('err').textContent='';
    $('bal').textContent='$'+s.balance.toFixed(2);
    $('mode').textContent=s.mode;$('mode').className='pill '+(s.mode=='PAPER'?'paper':'live');
    $('pnl').innerHTML=`24h <span class="${s.pnl_24h>=0?'pos':'neg'}">${usd(s.pnl_24h)}</span> · ${s.trades_24h} trade · libero $${s.free.toFixed(2)}`;
    const g=$('go');g.textContent=running?'FERMA':'AVVIA';g.className=running?'on':'off';
    $('status').textContent=running?'In ascolto di nuove monete. Le posizioni aperte restano sorvegliate anche se fermi.':'Spento. Non cerca monete e non invia segnali.';
    $('open').innerHTML=s.open.length?s.open.map(p=>{const ch=p.last_price?(100*(p.last_price/p.entry_price-1)):0;
      return `<div class="card"><b>${esc(p.name)}</b> <span class="${ch>=0?'pos':'neg'}">${ch.toFixed(1)}%</span>
      <div class="sub">$${p.size_usd} · stop -${p.stop_pct}%${p.trail_active?' · trail attivo':''} · ${p.status}</div>
      <a class="btn" href="${esc(p.coin_url)}">Vendi su FOMO</a>${p.status=='exiting'?`<button style="margin-top:8px;background:#2c2c2e;color:#fff" onclick="sold(${p.id})">Venduto</button>`:''}</div>`}).join(''):'<div class="sub">Nessuna</div>';
    const a=await api('/api/activity');
    $('act').innerHTML=a.slice(0,15).map(r=>`<div class="card"><b>${esc(r.title)}</b><div class="sub">${esc(r.subtitle)} · ${esc(r.value)}</div></div>`).join('')||'<div class="sub">Niente ancora</div>';
  }catch(e){$('err').textContent=e.message}
}
async function sold(id){await api('/api/sold/'+id,'POST');refresh()}
$('go').onclick=async()=>{
  try{await api(running?'/api/stop':'/api/start','POST')}catch(e){$('err').textContent=e.message}
  refresh()};
async function bind(id,key){
  const el=$(id);try{el.value=(await api('/api/settings'))[key].value}catch(e){}
  el.onchange=async()=>{try{await api('/api/settings','POST',{key,value:el.value});$('err').textContent=''}catch(e){$('err').textContent=e.message}}}
function init(){bind('s_stop','risk.stop_pct');bind('s_pct','executor.stack_pct');refresh()}
if(!tok)showLogin();else init();
setInterval(()=>{if(tok)refresh()},5000);

$('diag').onclick=async()=>{
  const b=$('diag');b.disabled=true;b.textContent='In corso… (fino a 1 minuto)';$('diagout').innerHTML='';
  try{const r=await api('/api/selftest','POST');const txt=JSON.stringify(r,null,1);
    $('diagout').innerHTML=r.steps.map(s=>`<div class="card"><b>${s.ok?'✓':'✗'} ${esc(s.step)}</b><div class="sub">${s.ms} ms</div></div>`).join('')+
      '<button id="copy" style="margin-top:8px;background:#2c2c2e;color:#fff">Copia report</button>';
    $('copy').onclick=async()=>{try{await navigator.clipboard.writeText(txt);$('copy').textContent='Copiato ✓'}catch(e){
      $('diagout').insertAdjacentHTML('beforeend','<textarea style="width:100%;height:200px;background:#1c1c1e;color:#fff">'+esc(txt)+'</textarea>')}}
  }catch(e){$('diagout').textContent=e.message}
  b.disabled=false;b.textContent='Avvia diagnostica'};
