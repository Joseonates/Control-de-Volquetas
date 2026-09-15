/* Volquetas — PWA de control de viajes, validación y facturación.
   Funciona sin señal: todo se guarda en el teléfono y se envía cuando hay internet. */
(function(){
"use strict";

/* Número de versión visible en la app. Sirve para comprobar de un vistazo
   si el celular ya tomó la versión nueva. */
const VERSION='15';
const FECHA_VERSION='14/09/2026';

/* ===================== utilidades ===================== */
const $=(s,r)=>(r||document).querySelector(s);
const $$=(s,r)=>[...(r||document).querySelectorAll(s)];
const el=(t,a,h)=>{const n=document.createElement(t);if(a)for(const k in a)n.setAttribute(k,a[k]);if(h!=null)n.innerHTML=h;return n};
const nf=new Intl.NumberFormat('es-CO',{maximumFractionDigits:0});
const nf2=new Intl.NumberFormat('es-CO',{maximumFractionDigits:2});
const money=v=>'$ '+nf.format(Math.round(v||0));
const n2=v=>nf2.format(+(v||0));
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>p+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const hoy=()=>new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,10);
const fFecha=d=>{if(!d)return'';const p=String(d).split('-');return p[2]+'/'+p[1]+'/'+p[0]};
const now=()=>Date.now();
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(t._i);t._i=setTimeout(()=>t.classList.remove('on'),2800)}
function abrir(t,node){$('#dlgT').textContent=t;const b=$('#dlgB');b.innerHTML='';b.appendChild(node);const d=$('#dlg');if(!d.open)d.showModal()}
function cerrar(){const d=$('#dlg');if(d.open)d.close()}
$('#dlgX').onclick=cerrar;
const fld=(l,inner)=>'<label class="f"><span>'+esc(l)+'</span>'+inner+'</label>';
const plu=(n,s1,s2)=>nf.format(n)+' '+(Math.abs(n)===1?s1:(s2||s1+'s'));
const tile=(k,v,s,hi)=>'<div class="tile'+(hi?' hi':'')+'"><div class="k">'+esc(k)+'</div><div class="v">'+v+'</div><div class="s">'+esc(s||'')+'</div></div>';

/* ===================== credenciales de conductores =====================
   La clave no se guarda tal cual: se guarda su huella (hash) con una sal propia
   de cada conductor. Quien abra la base no lee la clave. Aun así esto es un
   control de operación, no una seguridad fuerte: ver la nota de la guía. */
function salAlAzar(){
  const a=new Uint8Array(8);
  if(window.crypto&&crypto.getRandomValues)crypto.getRandomValues(a);
  else for(let i=0;i<8;i++)a[i]=Math.floor(Math.random()*256);
  return [].map.call(a,b=>b.toString(16).padStart(2,'0')).join('');
}
async function huella(sal,clave){
  const txt='vq1|'+sal+'|'+String(clave||'');
  if(window.crypto&&crypto.subtle&&crypto.subtle.digest){
    try{
      const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(txt));
      return [].map.call(new Uint8Array(buf),b=>b.toString(16).padStart(2,'0')).join('');
    }catch(e){}
  }
  let h=5381;for(let i=0;i<txt.length;i++)h=((h*33)^txt.charCodeAt(i))>>>0;
  return 'x'+h.toString(16);
}
const PAL=['ruta','vale','obra','carga','volco','flete'];
function claveNueva(){return PAL[Math.floor(Math.random()*PAL.length)]+Math.floor(1000+Math.random()*9000)}
const normUsr=u=>String(u||'').trim().toLowerCase();
const hayCredenciales=()=>!!(S.mae&&(S.mae.conductores||[]).some(c=>c.usuario&&c.clave));

/* ===================== base de datos local ===================== */
const STORES=['kv','viajes','costos','facturas','fotos'];
let _db=null;
function idb(){
  if(_db)return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const r=indexedDB.open('volquetas',1);
    r.onupgradeneeded=()=>{const d=r.result;STORES.forEach(s=>{if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:'id'})})};
    r.onsuccess=()=>{_db=r.result;res(_db)};
    r.onerror=()=>rej(r.error);
  });
}
async function dbPut(store,obj){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).put(obj);t.oncomplete=()=>res(obj);t.onerror=()=>rej(t.error)})}
async function dbAll(store){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(store,'readonly');const q=t.objectStore(store).getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error)})}
async function dbGet(store,id){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(store,'readonly');const q=t.objectStore(store).get(id);q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error)})}
async function dbDel(store,id){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).delete(id);t.oncomplete=res;t.onerror=()=>rej(t.error)})}

/* ===================== estado ===================== */
const CFG0={id:'config',empresaId:'',syncUrl:'',authKey:'',rol:'',conductorId:'',pin:'',
  auth:false,verPagoConductor:true,ultVolqueta:'',ultObra:'',ultConductor:'',empresa:{nombre:'',nit:'',direccion:'',ciudad:'',telefono:''},
  iva:19,retefuente:1,reteica:0,prefijo:'CC-',consecutivo:1,upd:0};
const MAE0={id:'maestros',clientes:[],obras:[],volquetas:[],conductores:[],upd:0,dirty:false};
const S={cfg:null,mae:null,viajes:[],costos:[],facturas:[]};
const P={from:'',to:''};
function mesActual(){const d=new Date(),a=d.getFullYear(),m=d.getMonth();
  const p=x=>String(x).padStart(2,'0');
  P.from=a+'-'+p(m+1)+'-01';P.to=a+'-'+p(m+1)+'-'+p(new Date(a,m+1,0).getDate())}

const byId=(arr,id)=>arr.find(x=>x.id===id)||null;
const nomObra=id=>{const o=byId(S.mae.obras,id);return o?o.nombre:'—'};
const nomCli=id=>{const c=byId(S.mae.clientes,id);return c?c.nombre:'—'};
const nomVol=id=>{const v=byId(S.mae.volquetas,id);return v?v.placa:'—'};
const nomCon=id=>{const c=byId(S.mae.conductores,id);return c?c.nombre:'—'};
const cliDeObra=id=>{const o=byId(S.mae.obras,id);return o?o.clienteId:null};

/* Cada viaje guarda, además del identificador, el nombre de la obra, la placa,
   el conductor y la tarifa que se le aplicó. Así el registro se sostiene solo
   aunque después se borre o se cambie un maestro, y una factura vieja no cambia
   de precio si mañana se sube la tarifa. */
const tObra=v=>{const o=byId(S.mae.obras,v.obraId);return o?o.nombre:(v.obraNombre||'—')};
const tVol=v=>{const o=byId(S.mae.volquetas,v.volquetaId);return o?o.placa:(v.placa||'')};
const tCon=v=>{const o=byId(S.mae.conductores,v.conductorId);return o?o.nombre:(v.conductorNombre||'')};
const tCli=v=>{const o=byId(S.mae.obras,v.obraId);const c=byId(S.mae.clientes,(o&&o.clienteId)||v.clienteId);
  return c?c.nombre:(v.clienteNombre||'—')};
const tCliId=v=>{const o=byId(S.mae.obras,v.obraId);return (o&&o.clienteId)||v.clienteId||''};
const kObra=v=>v.obraId||('n:'+(v.obraNombre||'—'));
const kVol=v=>v.volquetaId||('n:'+(v.placa||''));
const kCon=v=>v.conductorId||('n:'+(v.conductorNombre||''));
/* ¿A este viaje le falta algo para poder cobrarlo o liquidarlo? */
const viajeIncompleto=v=>!v.obraId||!byId(S.mae.obras,v.obraId)||!v.volquetaId||!byId(S.mae.volquetas,v.volquetaId)||
  !v.conductorId||!byId(S.mae.conductores,v.conductorId)||!calcViaje(v).total;

function calcViaje(v){
  const o=byId(S.mae.obras,v.obraId)||{};
  // La tarifa guardada con el viaje manda; si no la tiene (registros viejos), se toma la de la obra.
  const vv=v.valorViaje!=null&&v.valorViaje!==''?+v.valorViaje:+(o.valorViaje||0);
  const vm=v.valorM3!=null&&v.valorM3!==''?+v.valorM3:+(o.valorM3||0);
  const cant=+(v.cant||1),m3=+(v.m3||0);
  return {vv,vm,cant,m3,m3Tot:cant*m3,total:cant*vv+cant*m3*vm};
}
const sumTot=a=>a.reduce((s,v)=>s+calcViaje(v).total,0);
const sumM3=a=>a.reduce((s,v)=>s+calcViaje(v).m3Tot,0);
const sumCant=a=>a.reduce((s,v)=>s+(+v.cant||1),0);
const enRango=(v,f,t)=>v.fecha>=(f||P.from)&&v.fecha<=(t||P.to);
const ESTADOS={pendiente:['pen','Por validar'],aprobado:['apr','Aprobado'],rechazado:['rec','Rechazado'],facturado:['fac','Facturado']};
const chipE=e=>{const x=ESTADOS[e||'pendiente'];return '<span class="chip '+x[0]+'">'+x[1]+'</span>'};

/* Cada guardado sube un contador propio del registro. No se usa el reloj para decidir
   qué versión gana: los relojes de los celulares no coinciden y una aprobación se
   perdía cuando el teléfono del conductor iba adelantado. */
const marcar=o=>{o.ver=(+o.ver||0)+1;o.upd=now();o.dirty=true;return o};
async function guardarViaje(v){marcar(v);await dbPut('viajes',v);
  const i=S.viajes.findIndex(x=>x.id===v.id);if(i<0)S.viajes.push(v);else S.viajes[i]=v;sincronizar()}
async function guardarCosto(c){marcar(c);await dbPut('costos',c);
  const i=S.costos.findIndex(x=>x.id===c.id);if(i<0)S.costos.push(c);else S.costos[i]=c;sincronizar()}
async function guardarFactura(f){marcar(f);await dbPut('facturas',f);
  const i=S.facturas.findIndex(x=>x.id===f.id);if(i<0)S.facturas.push(f);else S.facturas[i]=f;sincronizar()}
async function guardarMae(){marcar(S.mae);await dbPut('kv',S.mae);sincronizar()}
async function guardarCfg(){S.cfg.upd=now();await dbPut('kv',S.cfg)}

/* ===================== fotos ===================== */
async function comprimir(file,max,q){
  max=max||1400;q=q||0.62;
  const url=URL.createObjectURL(file);
  try{
    const im=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('img'));i.src=url});
    let w=im.naturalWidth||im.width,h=im.naturalHeight||im.height;
    const s=Math.min(1,max/Math.max(w,h));w=Math.max(1,Math.round(w*s));h=Math.max(1,Math.round(h*s));
    const c=document.createElement('canvas');c.width=w;c.height=h;
    c.getContext('2d').drawImage(im,0,0,w,h);
    return c.toDataURL('image/jpeg',q);
  }finally{URL.revokeObjectURL(url)}
}
async function guardarFoto(dataUrl){const f={id:uid('p'),b64:dataUrl,upd:now(),dirty:true};await dbPut('fotos',f);sincronizar();return f.id}
const _fcache=Object.create(null);
async function traerFoto(id){
  if(!id)return null;
  if(_fcache[id])return _fcache[id];
  let f=await dbGet('fotos',id);
  if(!f&&conectado()){
    try{const r=await fetch(rutaSync('fotos/'+id));if(r.ok){const j=await r.json();if(j&&j.b64){f={id,b64:j.b64,upd:j.upd||now(),dirty:false};await dbPut('fotos',f)}}}catch(e){}
  }
  if(f)_fcache[id]=f.b64;
  return f?f.b64:null;
}
function imgFoto(id,maxh,cls){
  const im=new Image();im.alt='Foto del vale';im.className=cls||'';
  if(!cls)im.style.cssText='max-width:100%;max-height:'+(maxh||220)+'px;border-radius:10px;border:1px solid var(--line);display:block';
  traerFoto(id).then(b=>{if(b)im.src=b;else{im.replaceWith(el('div',{class:'empty'},'La foto todavía no ha llegado a este equipo. Sincroniza cuando tengas señal.'))}});
  return im;
}
function verFoto(id){const b=el('div');b.appendChild(imgFoto(id,560));abrir('Foto del vale',b)}

/* ===================== sincronización ===================== */
const conectado=()=>!!(S.cfg&&S.cfg.syncUrl&&S.cfg.empresaId);
function rutaSync(path){
  const base=String(S.cfg.syncUrl||'').replace(/\/+$/,'');
  const ns=encodeURIComponent(S.cfg.empresaId);
  const q=S.cfg.authKey?'?auth='+encodeURIComponent(S.cfg.authKey):'';
  return base+'/'+ns+'/'+path+'.json'+q;
}
let sincronizando=false,pendientePorSync=false,ultimoError='';
function pintarSync(){
  const d=$('#sDot'),t=$('#sTxt');if(!d)return;
  if(!conectado()){d.className='dot';t.textContent='solo este equipo';return}
  const p=S.viajes.filter(x=>x.dirty).length+S.costos.filter(x=>x.dirty).length+S.facturas.filter(x=>x.dirty).length;
  if(sincronizando){d.className='dot off';t.textContent='enviando…';return}
  if(ultimoError){d.className='dot err';t.textContent='sin conexión';return}
  if(p){d.className='dot off';t.textContent=p+' por enviar';return}
  d.className='dot on';t.textContent='al día';
}
async function enviar(path,obj){
  const r=await fetch(rutaSync(path),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
  if(!r.ok)throw new Error('HTTP '+r.status);
  return true;
}
async function traer(path){
  const r=await fetch(rutaSync(path),{cache:'no-store'});
  if(!r.ok)throw new Error('HTTP '+r.status);
  return await r.json();
}
/* ¿El registro del servidor trae algo nuevo frente al que tengo? */
function distinto(a,b){
  return (+a.ver||0)!==(+b.ver||0)||a.estado!==b.estado||a.motivo!==b.motivo||
         !!a.borrado!==!!b.borrado||a.facturaId!==b.facturaId||(+a.upd||0)!==(+b.upd||0);
}
async function sincronizar(forzar){
  if(!conectado()){pintarSync();return}
  if(sincronizando){pendientePorSync=true;return}
  sincronizando=true;pintarSync();
  let cambios=false, subio=false;
  try{
    // 1. subir lo pendiente
    for(const v of S.viajes.filter(x=>x.dirty)){const c=Object.assign({},v);delete c.dirty;await enviar('viajes/'+v.id,c);subio=true;v.dirty=false;await dbPut('viajes',v)}
    for(const c of S.costos.filter(x=>x.dirty)){const o=Object.assign({},c);delete o.dirty;await enviar('costos/'+c.id,o);subio=true;c.dirty=false;await dbPut('costos',c)}
    for(const f of S.facturas.filter(x=>x.dirty)){const o=Object.assign({},f);delete o.dirty;await enviar('facturas/'+f.id,o);subio=true;f.dirty=false;await dbPut('facturas',f)}
    for(const f of (await dbAll('fotos')).filter(x=>x.dirty)){const o={b64:f.b64,upd:f.upd};await enviar('fotos/'+f.id,o);subio=true;f.dirty=false;await dbPut('fotos',f)}
    if(S.mae.dirty&&esAdmin()){const o=Object.assign({},S.mae);delete o.dirty;await enviar('maestros',o);subio=true;S.mae.dirty=false;await dbPut('kv',S.mae)}
    // 2. bajar novedades
    // Solo el administrador manda maestros. Si un teléfono de conductor quedó con
    // la marca de "pendiente por subir" (por ejemplo, porque alguna vez se usó en
    // modo administrador), se le quita: si no, nunca volvería a recibir los
    // conductores nuevos que crea la oficina.
    if(!esAdmin()&&S.mae.dirty){S.mae.dirty=false;await dbPut('kv',S.mae)}
    const rm=await traer('maestros');
    if(rm&&!S.mae.dirty&&((+rm.ver||0)!==(+S.mae.ver||0)||(+rm.upd||0)!==(+S.mae.upd||0))){
      S.mae=Object.assign({},MAE0,rm,{id:'maestros',dirty:false});await dbPut('kv',S.mae);cambios=true;
    }
    for(const [path,arr,store] of [['viajes',S.viajes,'viajes'],['costos',S.costos,'costos'],['facturas',S.facturas,'facturas']]){
      const r=await traer(path);
      if(!r)continue;
      for(const k in r){
        const rem=r[k];if(!rem||!rem.id)continue;
        const i=arr.findIndex(x=>x.id===rem.id);
        if(i<0){const o=Object.assign({},rem,{dirty:false});arr.push(o);await dbPut(store,o);cambios=true}
        // Si no hay nada pendiente de subir, lo del servidor manda: es lo que ya vieron
        // todos. Así la aprobación del administrador llega siempre al conductor.
        else if(!arr[i].dirty&&distinto(rem,arr[i])){
          const o=Object.assign({},rem,{dirty:false});arr[i]=o;await dbPut(store,o);cambios=true;
        }
      }
    }
    // Si subimos algo, avisamos a los demás equipos; si no, tomamos nota del latido actual.
    if(subio)await tocarLatido(); else await leerLatido();
    ultimoError='';
  }catch(e){ultimoError=String(e&&e.message||e)}
  sincronizando=false;pintarSync();
  if(pendientePorSync){pendientePorSync=false;setTimeout(()=>sincronizar(forzar),400);return}
  // Si la oficina le quitó el acceso o lo desactivó, el conductor sale a la pantalla de entrada.
  if(S.cfg.rol==='conductor'&&S.cfg.auth){
    const cd=miConductor();
    if(!cd||cd.activo===false||!cd.clave){
      S.cfg.rol='';S.cfg.auth=false;await guardarCfg();
      cerrar();pintarGate('con2');toast('La oficina cambió tu acceso. Vuelve a entrar.');return;
    }
  }
  // Si algo cambió en el servidor, la pantalla se refresca sola (salvo con un diálogo abierto).
  if((forzar||cambios)&&!$('#dlg').open&&S.cfg&&S.cfg.rol)render();
}
/* El "latido" es un dato diminuto que cambia cada vez que alguien guarda algo.
   Se consulta cada pocos segundos (pesa nada) y solo cuando cambió se bajan
   los datos completos. Así el tablero reacciona casi de inmediato sin gastar
   los datos del celular del conductor. */
let latidoVisto=null;
async function tocarLatido(){
  const v={t:now(),r:Math.random().toString(36).slice(2,8)};
  try{await enviar('latido',v);latidoVisto=JSON.stringify(v)}catch(e){}
}
async function leerLatido(){
  try{latidoVisto=JSON.stringify(await traer('latido'))}catch(e){}
}
async function revisarLatido(){
  if(!conectado()||sincronizando||document.visibilityState!=='visible')return;
  try{
    const s=JSON.stringify(await traer('latido'));
    if(latidoVisto===null){latidoVisto=s;return}
    if(s!==latidoVisto){latidoVisto=s;await sincronizar(true)}
  }catch(e){}
}
window.addEventListener('online',()=>sincronizar(true));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')sincronizar(true)});
setInterval(revisarLatido,6000);
setInterval(()=>{if(document.visibilityState==='visible')sincronizar()},60000);

/* ===================== instalación en el celular ===================== */
let promptInstalar=null, instalaOculto=false;
const yaInstalada=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
const esIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&/Mac/.test(navigator.userAgent));
const puedeInstalar=()=>!yaInstalada()&&!instalaOculto&&(!!promptInstalar||esIOS());
function pintarInstalar(){
  const b=$('#instala');if(!b)return;
  const ver=puedeInstalar();
  b.hidden=!ver;
  document.body.classList.toggle('coninstala',ver);
  if(ver&&!promptInstalar&&esIOS()){
    $('#instalaD').textContent='Desde Safari: Compartir → Agregar a inicio.';
    $('#instalaOk').textContent='Cómo';
  }
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();promptInstalar=e;pintarInstalar()});
window.addEventListener('appinstalled',()=>{promptInstalar=null;pintarInstalar();toast('App instalada en tu celular')});
async function lanzarInstalacion(){
  if(promptInstalar){
    const p=promptInstalar;promptInstalar=null;
    try{p.prompt();const r=await p.userChoice;if(r&&r.outcome==='accepted')toast('Instalando…')}catch(e){}
    pintarInstalar();return;
  }
  const b=el('div');
  b.innerHTML='<ol class="pasos">'+
    (esIOS()
      ?'<li>Abre esta página en <b>Safari</b> (no en Chrome ni dentro de WhatsApp).</li>'+
       '<li>Toca el botón <b>Compartir</b>, el cuadrito con la flecha hacia arriba.</li>'+
       '<li>Baja y elige <b>Agregar a pantalla de inicio</b>.</li>'+
       '<li>Toca <b>Agregar</b>. El ícono queda junto a tus otras apps.</li>'
      :'<li>Abre esta página en <b>Chrome</b>.</li>'+
       '<li>Toca el menú de <b>tres puntos</b> arriba a la derecha.</li>'+
       '<li>Elige <b>Instalar aplicación</b> o <b>Agregar a pantalla principal</b>.</li>'+
       '<li>Confirma. El ícono queda junto a tus otras apps.</li>')+
    '</ol><p style="color:var(--muted);font-size:12.5px;margin-bottom:0">Después ábrela siempre desde el ícono: así funciona a pantalla completa y sin señal.</p>';
  abrir('Instalar en tu celular',b);
}

/* ===================== roles y arranque ===================== */
const esAdmin=()=>S.cfg.rol==='admin';
const miConductor=()=>byId(S.mae.conductores,S.cfg.conductorId);

function codigoConexion(){
  try{return btoa(unescape(encodeURIComponent(JSON.stringify({u:S.cfg.syncUrl,e:S.cfg.empresaId,a:S.cfg.authKey||''}))))}catch(e){return ''}
}
function leerCodigo(txt){
  try{const o=JSON.parse(decodeURIComponent(escape(atob(String(txt).trim()))));
    if(o&&o.u&&o.e)return o}catch(e){}
  return null;
}

/* ---------- pantalla de entrada ---------- */
function pintarGate(paso){
  const g=$('#gate'),c=$('#gateIn');g.hidden=false;
  $('#head').hidden=true;$('#main').hidden=true;
  if(paso==='rol'){
    c.innerHTML='<h2 style="font-size:26px">Volquetas</h2>'+
      '<p style="color:var(--muted);margin:6px 0 22px">Control de viajes, vales y facturación.</p>'+
      '<div class="stack">'+
      '<button class="btn big acc" id="gCon">Soy conductor</button>'+
      '<button class="btn big sec" id="gAdm">Soy administrador</button></div>'+
      '<p style="color:var(--muted);font-size:12px;text-align:center;margin-top:22px">Versión '+VERSION+' · '+FECHA_VERSION+'</p>';
    // si el teléfono ya está conectado a la empresa, va directo a pedir usuario y clave
    $('#gCon').onclick=()=>pintarGate(conectado()?'con2':'con1');
    $('#gAdm').onclick=()=>pintarGate('adm');
    return;
  }
  if(paso==='con1'){
    c.innerHTML='<h2>Conectar con la empresa</h2>'+
      '<p style="color:var(--muted);margin:6px 0 16px">Pega el código que te envió la oficina.</p>'+
      '<div class="stack">'+fld('Código de conexión','<textarea id="cCod" placeholder="Pega aquí el código"></textarea>')+
      '<button class="btn acc" id="cOk">Conectar</button>'+
      '<button class="btn sec" id="cBack">Atrás</button></div>'+
      '<p style="color:var(--muted);font-size:12.5px;margin-top:16px">Si aún no tienes el código, pídeselo al administrador: lo genera desde Ajustes → Conexión.</p>';
    $('#cBack').onclick=()=>pintarGate('rol');
    $('#cOk').onclick=async()=>{
      const o=leerCodigo($('#cCod').value);
      if(!o){toast('Ese código no es válido. Pídelo de nuevo a la oficina.');return}
      S.cfg.syncUrl=o.u;S.cfg.empresaId=o.e;S.cfg.authKey=o.a||'';await guardarCfg();
      toast('Conectando…');await sincronizar();
      if(ultimoError){toast('No se pudo conectar. Revisa tu internet e inténtalo otra vez.');return}
      pintarGate('con2');
    };
    return;
  }
  if(paso==='con2'){
    // Con credenciales creadas por la oficina, se entra con usuario y clave.
    if(hayCredenciales()){
      c.innerHTML='<h2>Entrar</h2>'+
        '<p style="color:var(--muted);margin:6px 0 16px">Usa el usuario y la clave que te dio la oficina.</p>'+
        '<div class="stack">'+
        fld('Usuario','<input id="lUsr" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="tu usuario">')+
        fld('Clave','<input id="lCla" type="password" placeholder="tu clave">')+
        '<button class="btn acc" id="lOk">Entrar</button>'+
        '<button class="btn sec" id="cBack">Atrás</button></div>'+
        '<p style="color:var(--muted);font-size:12.5px;margin-top:16px">¿No tienes usuario o se te olvidó la clave? '+
        'Pídeselos a la oficina: los crea desde Ajustes → Conductores.</p>'+
        '<p style="text-align:center;margin-top:10px"><button class="btn sm sec" id="lAct">Actualizar datos</button> '+
        '<button class="btn sm sec" id="lOtra">Conectar con otro código</button></p>';
      const entrar=async()=>{
        const u=normUsr($('#lUsr').value), k=$('#lCla').value;
        if(!u||!k){toast('Escribe usuario y clave');return}
        let cd=(S.mae.conductores||[]).find(x=>normUsr(x.usuario)===u&&x.clave);
        if(!cd&&conectado()){
          // puede ser un conductor creado hace poco que este teléfono todavía no conoce
          toast('Buscando tu usuario…');await sincronizar();
          cd=(S.mae.conductores||[]).find(x=>normUsr(x.usuario)===u&&x.clave);
        }
        if(!cd){toast('No encuentro ese usuario. Toca “Actualizar datos” y vuelve a intentar.');return}
        if(cd.activo===false){toast('Ese usuario está inactivo. Habla con la oficina.');return}
        const h=await huella(cd.claveSal||'',k);
        if(h!==cd.clave){toast('Usuario o clave incorrectos');$('#lCla').value='';return}
        S.cfg.conductorId=cd.id;S.cfg.rol='conductor';S.cfg.auth=true;await guardarCfg();iniciar();
      };
      $('#lOk').onclick=entrar;
      $('#lCla').addEventListener('keydown',e=>{if(e.key==='Enter')entrar()});
      $('#cBack').onclick=()=>pintarGate('rol');
      $('#lOtra').onclick=()=>pintarGate('con1');
      $('#lAct').onclick=async()=>{
        toast('Trayendo los datos de la oficina…');
        await sincronizar();
        toast(ultimoError?'Sin conexión. Revisa tu internet.':'Datos al día: '+(S.mae.conductores||[]).length+' conductor(es)');
        pintarGate('con2');
      };
      return;
    }
    // Todavía sin credenciales: se elige el nombre, como antes.
    const cs=S.mae.conductores.filter(x=>x.activo!==false);
    c.innerHTML='<h2>¿Quién eres?</h2>'+
      '<p style="color:var(--muted);margin:6px 0 16px">Toca tu nombre. Quedará guardado en este teléfono.</p>'+
      (cs.length?'<div class="stack" id="cList"></div>':'<div class="note">La oficina todavía no ha registrado conductores. Avísales y vuelve a entrar.</div>')+
      '<div class="row" style="margin-top:16px"><button class="btn sec" id="cAct" style="flex:1">Actualizar lista</button>'+
      '<button class="btn sec" id="cBack" style="flex:1">Atrás</button></div>';
    const L=$('#cList');
    cs.forEach(x=>{const b=el('button',{class:'btn big sec',type:'button'},esc(x.nombre));
      b.onclick=async()=>{S.cfg.conductorId=x.id;S.cfg.rol='conductor';S.cfg.auth=false;await guardarCfg();iniciar()};
      if(L)L.appendChild(b)});
    $('#cAct').onclick=async()=>{
      toast('Trayendo los datos de la oficina…');
      await sincronizar();
      toast(ultimoError?'Sin conexión. Revisa tu internet.':'Datos al día');
      pintarGate('con2');
    };
    $('#cBack').onclick=()=>pintarGate('rol');
    return;
  }
  if(paso==='adm'){
    const tiene=!!S.cfg.pin;
    c.innerHTML='<h2>'+(tiene?'Clave de administrador':'Crea tu clave')+'</h2>'+
      '<p style="color:var(--muted);margin:6px 0 16px">'+(tiene?'Escribe la clave de 4 dígitos.':'Elige 4 dígitos para entrar al modo administrador en este equipo.')+'</p>'+
      '<div class="stack">'+fld('Clave','<input id="aPin" type="tel" inputmode="numeric" maxlength="4" placeholder="••••" style="font-size:26px;text-align:center;letter-spacing:.4em">')+
      '<button class="btn acc" id="aOk">'+(tiene?'Entrar':'Guardar y entrar')+'</button>'+
      '<button class="btn sec" id="aBack">Atrás</button></div>';
    $('#aBack').onclick=()=>pintarGate('rol');
    $('#aOk').onclick=async()=>{
      const p=$('#aPin').value.trim();
      if(!/^\d{4}$/.test(p)){toast('Escribe 4 dígitos');return}
      if(tiene&&p!==S.cfg.pin){toast('Clave incorrecta');return}
      S.cfg.pin=p;S.cfg.rol='admin';await guardarCfg();iniciar();
    };
    return;
  }
}
function iniciar(){
  $('#gate').hidden=true;$('#head').hidden=false;$('#main').hidden=false;
  $('#tWho').textContent=esAdmin()?'administración':(miConductor()?miConductor().nombre:'conductor');
  $('#tTitle').textContent=S.cfg.empresa.nombre?S.cfg.empresa.nombre.slice(0,22):'Volquetas';
  vista=esAdmin()?'tablero':'registrar';
  render();sincronizar(true);
}
async function salirDeRol(){
  S.cfg.rol='';await guardarCfg();pintarGate('rol');
}

/* ===================== navegación ===================== */
let vista='registrar';
const NAV_CON=[['registrar','Registrar'],['mios','Mi trabajo']];
const NAV_ADM=[['tablero','Tablero'],['validar','Validar'],['viajes','Viajes'],['costos','Costos'],['cobro','Cobro'],['ajustes','Ajustes']];
function pintarBar(){
  const bar=$('#bar');bar.innerHTML='';
  const items=esAdmin()?NAV_ADM:NAV_CON;
  for(const [id,l] of items){
    let extra='';
    if(id==='validar'){const n=S.viajes.filter(v=>(v.estado||'pendiente')==='pendiente'&&!v.borrado).length;
      if(n)extra='<b>'+n+'</b>'}
    const b=el('button',{type:'button','data-v':id},esc(l)+extra);
    if(id===vista)b.setAttribute('aria-current','true');
    bar.appendChild(b);
  }
  const act=bar.querySelector('[aria-current="true"]');
  if(act&&act.scrollIntoView)act.scrollIntoView({block:'nearest',inline:'nearest'});
}
$('#bar').addEventListener('click',e=>{const b=e.target.closest('button[data-v]');if(!b)return;vista=b.dataset.v;render()});
$('#btnSync').onclick=()=>{if(!conectado()){vista='ajustes';render();toast('Configura la conexión para trabajar en línea')}else{sincronizar(true);toast('Sincronizando…')}};

function render(){
  pintarBar();pintarSync();
  const m=$('#main');m.innerHTML='';
  const f={tablero:vTablero,registrar:vRegistrar,mios:vMios,validar:vValidar,viajes:vViajes,costos:vCostos,cobro:vCobro,ajustes:vAjustes}[vista];
  m.appendChild(f?f():el('div',{class:'empty'},'—'));
  window.scrollTo(0,0);
}
function ph(t,s,extra){const h=el('div',{class:'ph'});h.innerHTML='<div><h2>'+esc(t)+'</h2><p>'+esc(s||'')+'</p></div>';
  if(extra){h.appendChild(el('div',{class:'spacer'}));h.appendChild(extra)}return h}


/* ===================== exportar a Excel =====================
   Se arma el .xlsx a mano (un .xlsx es un zip de archivos XML). Sin librerías
   externas, para que la app siga funcionando sin señal. */
let _crcT=null;
function crcTabla(){
  if(_crcT)return _crcT;
  _crcT=new Uint32Array(256);
  for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);_crcT[i]=c>>>0}
  return _crcT;
}
function crc32(b){const t=crcTabla();let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=t[(c^b[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
const utf8=s=>new TextEncoder().encode(s);
function zipear(archivos){
  const partes=[],central=[];let off=0;
  const u16=v=>[v&255,(v>>8)&255], u32=v=>[v&255,(v>>8)&255,(v>>16)&255,(v>>24)&255];
  for(const a of archivos){
    const nom=utf8(a.nombre), dat=a.datos, c=crc32(dat);
    const loc=[].concat([0x50,0x4b,3,4],u16(20),u16(0),u16(0),u16(0),u16(0),u32(c),u32(dat.length),u32(dat.length),u16(nom.length),u16(0));
    partes.push(new Uint8Array(loc),nom,dat);
    central.push({nom,c,len:dat.length,off});
    off+=loc.length+nom.length+dat.length;
  }
  const cd=[];let cdLen=0;
  for(const e of central){
    const h=[].concat([0x50,0x4b,1,2],u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(e.c),u32(e.len),u32(e.len),
      u16(e.nom.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(e.off));
    cd.push(new Uint8Array(h),e.nom);cdLen+=h.length+e.nom.length;
  }
  const fin=new Uint8Array([].concat([0x50,0x4b,5,6],u16(0),u16(0),u16(central.length),u16(central.length),u32(cdLen),u32(off),u16(0)));
  const todo=partes.concat(cd,[fin]);
  let total=0;todo.forEach(p=>total+=p.length);
  const out=new Uint8Array(total);let p=0;
  todo.forEach(x=>{out.set(x,p);p+=x.length});
  return out;
}
const xe=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const colLetra=n=>{let s='';n++;while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=(n-1-r)/26}return s};
const serieFecha=f=>{const p=String(f).split('-');if(p.length<3)return null;
  return (Date.UTC(+p[0],+p[1]-1,+p[2])-Date.UTC(1899,11,30))/86400000};

/* celda: {v:valor, t:'s'|'n'|'f'|'e', b:true para negrita} */
function hoja(filas,anchos){
  let x='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  if(anchos&&anchos.length){x+='<cols>';anchos.forEach((a,i)=>{x+='<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+a+'" customWidth="1"/>'});x+='</cols>'}
  x+='<sheetData>';
  filas.forEach((fila,r)=>{
    x+='<row r="'+(r+1)+'">';
    fila.forEach((c,i)=>{
      if(c==null||c.v===''||c.v==null)return;
      const ref=colLetra(i)+(r+1);
      let s=0;
      if(c.t==='e')s=1;                       // encabezado
      else if(c.t==='f')s=3;                  // fecha
      else if(c.t==='$')s=c.b?7:2;            // dinero
      else if(c.t==='n')s=c.b?6:4;            // número con decimal
      else if(c.t==='i')s=c.b?6:5;            // entero
      else if(c.b)s=6;
      if(c.t==='f'){const n=serieFecha(c.v);if(n==null)return;x+='<c r="'+ref+'" s="'+s+'"><v>'+n+'</v></c>';return}
      if(c.t==='$'||c.t==='n'||c.t==='i'){x+='<c r="'+ref+'" s="'+s+'"><v>'+(+c.v||0)+'</v></c>';return}
      x+='<c r="'+ref+'" s="'+s+'" t="inlineStr"><is><t xml:space="preserve">'+xe(c.v)+'</t></is></c>';
    });
    x+='</row>';
  });
  return x+'</sheetData></worksheet>';
}
function libro(hojas){
  const N='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const estilos='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<styleSheet xmlns="'+N+'">'+
    '<numFmts count="4">'+
      '<numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0"/>'+
      '<numFmt numFmtId="165" formatCode="DD/MM/YYYY"/>'+
      '<numFmt numFmtId="166" formatCode="#,##0.0"/>'+
      '<numFmt numFmtId="167" formatCode="#,##0"/>'+
    '</numFmts>'+
    '<fonts count="3">'+
      '<font><sz val="10"/><name val="Arial"/></font>'+
      '<font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>'+
      '<font><b/><sz val="10"/><name val="Arial"/></font>'+
    '</fonts>'+
    '<fills count="3"><fill><patternFill patternType="none"/></fill>'+
      '<fill><patternFill patternType="gray125"/></fill>'+
      '<fill><patternFill patternType="solid"><fgColor rgb="FF22312B"/><bgColor indexed="64"/></patternFill></fill></fills>'+
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="8">'+
      '<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="0"/>'+
      '<xf xfId="0" numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>'+
      '<xf xfId="0" numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>'+
      '<xf xfId="0" numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>'+
      '<xf xfId="0" numFmtId="166" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>'+
      '<xf xfId="0" numFmtId="167" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>'+
      '<xf xfId="0" numFmtId="167" fontId="2" fillId="0" borderId="0" applyNumberFormat="1" applyFont="1"/>'+
      '<xf xfId="0" numFmtId="164" fontId="2" fillId="0" borderId="0" applyNumberFormat="1" applyFont="1"/>'+
    '</cellXfs>'+
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'+
    '</styleSheet>';
  let ct='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  let sh='',rel='';
  hojas.forEach((h,i)=>{
    ct+='<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    sh+='<sheet name="'+xe(h.nombre.slice(0,31))+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>';
    rel+='<Relationship Id="rId'+(i+1)+'" Type="'+R+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>';
  });
  ct+='</Types>';
  rel+='<Relationship Id="rId'+(hojas.length+1)+'" Type="'+R+'/styles" Target="styles.xml"/>';
  const wb='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="'+N+'" xmlns:r="'+R+'"><sheets>'+sh+'</sheets></workbook>';
  const wbr='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rel+'</Relationships>';
  const raiz='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rIdWB" Type="'+R+'/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const arch=[{nombre:'[Content_Types].xml',datos:utf8(ct)},{nombre:'_rels/.rels',datos:utf8(raiz)},
    {nombre:'xl/workbook.xml',datos:utf8(wb)},{nombre:'xl/_rels/workbook.xml.rels',datos:utf8(wbr)},
    {nombre:'xl/styles.xml',datos:utf8(estilos)}];
  hojas.forEach((h,i)=>arch.push({nombre:'xl/worksheets/sheet'+(i+1)+'.xml',datos:utf8(hoja(h.filas,h.anchos))}));
  return zipear(arch);
}

function exportarExcel(){
  const E=t=>({v:t,t:'e'});
  const vs=S.viajes.filter(v=>enRango(v)&&!v.borrado).sort((a,b)=>a.fecha<b.fecha?-1:1);
  const cs=S.costos.filter(x=>enRango(x)&&!x.borrado).sort((a,b)=>a.fecha<b.fecha?-1:1);
  if(!vs.length&&!cs.length){toast('No hay nada que exportar en este periodo');return}

  // Hoja 1: Viajes
  const h1=[[E('Fecha'),E('Vale'),E('Cliente'),E('Obra'),E('Destino'),E('Placa'),E('Conductor'),
    E('Cant. viajes'),E('m³ por viaje'),E('m³ total'),E('Tarifa viaje'),E('Tarifa m³'),E('Valor total'),
    E('Estado'),E('N.º documento'),E('Observaciones')]];
  vs.forEach(v=>{const k=calcViaje(v),o=byId(S.mae.obras,v.obraId)||{};
    h1.push([{v:v.fecha,t:'f'},{v:v.vale||''},{v:tCli(v)},{v:tObra(v)},{v:o.destino||v.destino||''},
      {v:tVol(v)},{v:tCon(v)},{v:k.cant,t:'i'},{v:k.m3,t:'n'},{v:k.m3Tot,t:'n'},
      {v:k.vv,t:'$'},{v:k.vm,t:'$'},{v:k.total,t:'$'},
      {v:(ESTADOS[v.estado||'pendiente']||['','' ])[1]},
      {v:(byId(S.facturas,v.facturaId)||{}).numero||''},{v:v.obs||''}])});
  h1.push([{v:'TOTAL',b:true},null,null,null,null,null,null,{v:sumCant(vs),t:'i',b:true},null,
    {v:sumM3(vs),t:'n',b:true},null,null,{v:sumTot(vs),t:'$',b:true}]);

  // Hoja 2: Costos
  const h2=[[E('Fecha'),E('Tipo'),E('Placa'),E('Detalle'),E('Valor')]];
  cs.forEach(x=>h2.push([{v:x.fecha,t:'f'},{v:x.tipo||'Otros'},
    {v:x.volquetaId?nomVol(x.volquetaId):'General'},{v:x.descripcion||''},{v:+x.valor||0,t:'$'}]));
  const totCos=cs.reduce((s,x)=>s+(+x.valor||0),0);
  h2.push([{v:'TOTAL',b:true},null,null,null,{v:totCos,t:'$',b:true}]);

  // Hoja 3: Resumen por obra
  const go={};vs.forEach(v=>{(go[kObra(v)]=go[kObra(v)]||[]).push(v)});
  const h3=[[E('Obra'),E('Cliente'),E('Viajes'),E('m³'),E('Valor'),E('Por facturar')]];
  Object.keys(go).forEach(k=>{const a=go[k];
    h3.push([{v:tObra(a[0])},{v:tCli(a[0])},{v:sumCant(a),t:'i'},{v:sumM3(a),t:'n'},
      {v:sumTot(a),t:'$'},{v:sumTot(a.filter(x=>x.estado!=='facturado')),t:'$'}])});
  h3.push([{v:'TOTAL',b:true},null,{v:sumCant(vs),t:'i',b:true},{v:sumM3(vs),t:'n',b:true},{v:sumTot(vs),t:'$',b:true}]);

  // Hoja 4: Liquidación de conductores
  const gc={};vs.forEach(v=>{(gc[kCon(v)]=gc[kCon(v)]||[]).push(v)});
  const h4=[[E('Conductor'),E('Viajes'),E('m³'),E('Flete generado'),E('Base de pago'),E('A pagar')]];
  let totPago=0;
  Object.keys(gc).forEach(k=>{const a=gc[k],d=byId(S.mae.conductores,a[0].conductorId)||{};
    const apr=a.filter(x=>x.estado==='aprobado'||x.estado==='facturado');
    const pago=pagoDe(d,apr);totPago+=pago;
    h4.push([{v:tCon(a[0])||'Sin conductor'},{v:sumCant(a),t:'i'},{v:sumM3(a),t:'n'},{v:sumTot(a),t:'$'},
      {v:d.tipoPago==='Porcentaje'?((+d.porcentaje||0)+'% del flete'):((+d.valorViaje||0)+' por viaje')},
      {v:pago,t:'$'}])});
  h4.push([{v:'TOTAL',b:true},null,null,null,null,{v:totPago,t:'$',b:true}]);

  // Hoja 5: Rendimiento por volqueta
  const gv={};vs.forEach(v=>{(gv[kVol(v)]=gv[kVol(v)]||[]).push(v)});
  const h5=[[E('Placa'),E('Vinculación'),E('Viajes'),E('m³'),E('Ingreso'),E('Costos'),E('Pago tercero'),E('Margen')]];
  Object.keys(gv).forEach(k=>{const a=gv[k],vo=byId(S.mae.volquetas,a[0].volquetaId)||{};
    const i=sumTot(a),co=cs.filter(x=>x.volquetaId===a[0].volquetaId).reduce((s,x)=>s+(+x.valor||0),0);
    const te=vo.tipo==='Tercero'?i*(+vo.porcTercero||0)/100:0;
    h5.push([{v:tVol(a[0])||'Sin volqueta'},{v:vo.tipo||''},{v:sumCant(a),t:'i'},{v:sumM3(a),t:'n'},
      {v:i,t:'$'},{v:co,t:'$'},{v:te,t:'$'},{v:i-co-te,t:'$'}])});

  // Hoja 6: Documentos de cobro
  const fac=S.facturas.filter(f=>!f.borrado&&f.fecha>=P.from&&f.fecha<=P.to);
  const h6=[[E('N.º'),E('Fecha'),E('Cliente'),E('Obra'),E('Desde'),E('Hasta'),E('Viajes'),E('m³'),
    E('Subtotal'),E('IVA'),E('Total'),E('Retefuente'),E('ReteICA'),E('Neto a pagar'),E('Estado')]];
  fac.forEach(f=>h6.push([{v:f.numero},{v:f.fecha,t:'f'},{v:nomCli(f.clienteId)},{v:f.obraNombre||'Todas'},
    {v:f.desde,t:'f'},{v:f.hasta,t:'f'},{v:f.viajes||0,t:'i'},{v:f.m3||0,t:'n'},
    {v:f.subtotal,t:'$'},{v:f.iva,t:'$'},{v:f.total,t:'$'},{v:f.retefuente,t:'$'},{v:f.reteica,t:'$'},
    {v:f.pagar,t:'$'},{v:f.estado||''}]));

  const bytes=libro([
    {nombre:'Viajes',filas:h1,anchos:[11,10,24,24,22,10,20,9,10,9,12,10,13,12,13,30]},
    {nombre:'Costos',filas:h2,anchos:[11,16,10,40,13]},
    {nombre:'Resumen por obra',filas:h3,anchos:[26,24,9,10,14,14]},
    {nombre:'Liquidacion conductores',filas:h4,anchos:[24,9,10,15,18,14]},
    {nombre:'Rendimiento volquetas',filas:h5,anchos:[12,13,9,10,14,13,14,14]},
    {nombre:'Documentos de cobro',filas:h6,anchos:[11,11,24,22,11,11,9,9,13,12,13,12,11,14,11]}
  ]);
  const nombre='Volquetas '+P.from+' a '+P.to+'.xlsx';
  const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=nombre;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('Excel generado: '+nombre);
}

/* ===================== TABLERO (admin) ===================== */
function tablaSimple(cols,rows,foot){
  const w=el('div',{class:'tw'});
  if(!rows.length){w.innerHTML='<div class="empty">Sin datos en el periodo.</div>';return w}
  const cl=c=>' class="'+(c.num?'num ':'')+(c.opt?'opt':'')+'"';
  let h='<table><thead><tr>'+cols.map(c=>'<th'+cl(c)+'>'+esc(c.l)+'</th>').join('')+'</tr></thead><tbody>';
  rows.forEach(r=>{h+='<tr>'+cols.map(c=>'<td'+cl(c)+'>'+(r[c.k]==null?'':r[c.k])+'</td>').join('')+'</tr>'});
  h+='</tbody>';
  if(foot)h+='<tfoot><tr>'+cols.map(c=>'<td'+cl(c)+'>'+(foot[c.k]==null?'':foot[c.k])+'</td>').join('')+'</tr></tfoot>';
  w.innerHTML=h+'</table>';return w;
}
function selectorPeriodo(){
  const d=el('div',{class:'card'});
  d.innerHTML='<div class="pad gf">'+fld('Desde','<input type="date" id="pD" value="'+P.from+'">')+
    fld('Hasta','<input type="date" id="pH" value="'+P.to+'">')+
    '<div style="display:flex;align-items:flex-end"><button class="btn sec" id="pM" style="width:100%">Mes actual</button></div></div>';
  $('#pD',d).onchange=e=>{P.from=e.target.value;render()};
  $('#pH',d).onchange=e=>{P.to=e.target.value;render()};
  $('#pM',d).onclick=()=>{mesActual();render()};
  return d;
}
function vTablero(){
  const c=el('div',{class:'stack'});
  const acc=el('div',{class:'row'});
  const bXls=el('button',{class:'btn sm acc',type:'button'},'Exportar a Excel');
  bXls.onclick=()=>{try{exportarExcel()}catch(e){toast('No se pudo generar el Excel')}};
  const bAct=el('button',{class:'btn sm sec',type:'button'},'Actualizar');
  bAct.onclick=async()=>{toast('Buscando novedades…');await sincronizar(true)};
  acc.appendChild(bXls);acc.appendChild(bAct);
  c.appendChild(ph('Tablero','Del '+fFecha(P.from)+' al '+fFecha(P.to),acc));
  c.appendChild(selectorPeriodo());

  const vs=S.viajes.filter(v=>enRango(v)&&!v.borrado);
  const cs=S.costos.filter(x=>enRango(x)&&!x.borrado);
  const pend=vs.filter(v=>(v.estado||'pendiente')==='pendiente');
  const apr=vs.filter(v=>v.estado==='aprobado');
  const fac=vs.filter(v=>v.estado==='facturado');
  const ing=sumTot(vs), cost=cs.reduce((s,x)=>s+(+x.valor||0),0);

  const t=el('div',{class:'tiles'});
  t.innerHTML=tile('Viajes',nf.format(sumCant(vs)),n2(sumM3(vs))+' m³ transportados')+
    tile('Facturación generada',money(ing),plu(vs.length,'registro'),1)+
    tile('Costos operativos',money(cost),plu(cs.length,'movimiento'))+
    tile('Margen bruto',money(ing-cost),ing?Math.round((ing-cost)/ing*100)+'% sobre ingresos':'—');
  c.appendChild(t);

  // viajes a los que les falta la placa o el conductor
  const inc=vs.filter(viajeIncompleto);
  if(inc.length){
    const n=el('div',{class:'note bad'});
    n.innerHTML='<b>'+sumCant(inc)+' viaje(s) incompletos o en $ 0.</b> Les falta la obra, la placa o el '+
      'conductor, o apuntan a uno que ya no existe. Por eso no suman en las tablas. '+
      '<button class="btn sm sec" id="tInc" type="button" style="margin-top:8px">Ver y corregir</button>';
    n.querySelector('#tInc').onclick=()=>{fEstado='incompletos';vista='viajes';render()};
    c.appendChild(n);
  }

  // estado del trabajo
  const est=el('div',{class:'card'});
  est.innerHTML='<h3>Estado de los viajes</h3>';
  const eb=el('div',{class:'pad stack'});
  const fila=(lbl_,arr,cls)=>{
    const pc=sumCant(vs)?Math.round(sumCant(arr)/sumCant(vs)*100):0;
    return '<div><div class="row" style="gap:8px"><span class="chip '+cls+'">'+lbl_+'</span>'+
      '<span class="spacer"></span><span class="mono">'+nf.format(sumCant(arr))+' viajes · '+money(sumTot(arr))+'</span></div>'+
      '<div class="pbar" style="margin-top:5px"><i style="width:'+pc+'%"></i></div></div>';
  };
  eb.innerHTML=fila('Por validar',pend,'pen')+fila('Aprobado',apr,'apr')+fila('Facturado',fac,'fac');
  if(pend.length){
    const b=el('button',{class:'btn acc',type:'button'},'Ir a validar '+sumCant(pend)+' viaje(s)');
    b.onclick=()=>{vista='validar';render()};
    eb.appendChild(b);
  }
  est.appendChild(eb);c.appendChild(est);

  // por obra
  const go={};vs.forEach(v=>{(go[kObra(v)]=go[kObra(v)]||[]).push(v)});
  const ro=Object.keys(go).map(k=>{const a=go[k],val=sumTot(a);
    return{o:esc(tObra(a[0])),cl:esc(tCli(a[0])),v:nf.format(sumCant(a)),m3:n2(sumM3(a)),t:money(val),
      b:'<div class="pbar"><i style="width:'+(ing?Math.round(val/ing*100):0)+'%"></i></div>',_v:val}})
    .sort((a,b)=>b._v-a._v);
  const co=el('div',{class:'card'});co.innerHTML='<h3>Producción por obra</h3>';
  co.appendChild(tablaSimple([{k:'o',l:'Obra'},{k:'cl',l:'Cliente',opt:1},{k:'v',l:'Viajes',num:1},{k:'m3',l:'m³',num:1},{k:'t',l:'Valor',num:1},{k:'b',l:'Part.',opt:1}],ro,
    {o:'Total',v:nf.format(sumCant(vs)),m3:n2(sumM3(vs)),t:money(ing)}));
  c.appendChild(co);

  // por volqueta
  const gv={};vs.forEach(v=>{(gv[kVol(v)]=gv[kVol(v)]||[]).push(v)});
  const rv=Object.keys(gv).map(k=>{
    const a=gv[k],vo=byId(S.mae.volquetas,a[0].volquetaId)||{},i=sumTot(a);
    const co2=cs.filter(x=>x.volquetaId===a[0].volquetaId).reduce((s,x)=>s+(+x.valor||0),0);
    const te=vo.tipo==='Tercero'?i*(+vo.porcTercero||0)/100:0;
    return{p:esc(tVol(a[0])||'Sin volqueta'),v:nf.format(sumCant(a)),m3:n2(sumM3(a)),
      i:money(i),c:money(co2),te:te?money(te):'—',m:money(i-co2-te),_i:i,_c:co2,_t:te,_m:i-co2-te}})
    .sort((a,b)=>b._m-a._m);
  const cv=el('div',{class:'card'});cv.innerHTML='<h3>Rendimiento por volqueta</h3>';
  cv.appendChild(tablaSimple([{k:'p',l:'Placa'},{k:'v',l:'Viajes',num:1},{k:'m3',l:'m³',num:1,opt:1},{k:'i',l:'Ingreso',num:1},
    {k:'c',l:'Costos',num:1},{k:'te',l:'Pago tercero',num:1,opt:1},{k:'m',l:'Margen',num:1}],rv,
    {p:'Total',i:money(rv.reduce((s,x)=>s+x._i,0)),c:money(rv.reduce((s,x)=>s+x._c,0)),
     te:money(rv.reduce((s,x)=>s+x._t,0)),m:money(rv.reduce((s,x)=>s+x._m,0))}));
  c.appendChild(cv);

  // conductores
  const gc={};vs.forEach(v=>{(gc[kCon(v)]=gc[kCon(v)]||[]).push(v)});
  const rc=Object.keys(gc).map(k=>{
    const a=gc[k],d=byId(S.mae.conductores,a[0].conductorId)||{},i=sumTot(a),cant=sumCant(a);
    const pago=d.tipoPago==='Porcentaje'?i*(+d.porcentaje||0)/100:cant*(+d.valorViaje||0);
    const base=d.tipoPago==='Porcentaje'?((+d.porcentaje||0)+'% del flete'):(money(d.valorViaje||0)+' por viaje');
    return{n:esc(tCon(a[0])||'Sin conductor'),v:nf.format(cant),m3:n2(sumM3(a)),b:esc(base),p:money(pago),_p:pago}})
    .sort((a,b)=>b._p-a._p);
  const cc=el('div',{class:'card'});cc.innerHTML='<h3>Pago a conductores</h3>';
  cc.appendChild(tablaSimple([{k:'n',l:'Conductor'},{k:'v',l:'Viajes',num:1},{k:'m3',l:'m³',num:1,opt:1},{k:'b',l:'Base',opt:1},{k:'p',l:'A pagar',num:1}],rc,
    {n:'Total',p:money(rc.reduce((s,x)=>s+x._p,0))}));
  c.appendChild(cc);

  // últimos
  const ul=el('div',{class:'card'});ul.innerHTML='<h3>Últimos viajes</h3>';
  const ub=el('div',{class:'stack',style:'padding:12px'});
  const ord=vs.slice().sort((a,b)=>a.fecha<b.fecha?1:a.fecha>b.fecha?-1:(b.upd||0)-(a.upd||0)).slice(0,6);
  if(!ord.length)ub.appendChild(el('div',{class:'empty'},'Todavía no hay viajes en el periodo.'));
  ord.forEach(v=>ub.appendChild(itemViaje(v,false)));
  ul.appendChild(ub);c.appendChild(ul);
  return c;
}

/* ===================== CONDUCTOR ===================== */
function vRegistrar(){
  const c=el('div',{class:'stack'});
  const mios=S.viajes.filter(v=>esMio(v)&&v.fecha===hoy());
  c.appendChild(ph('Registrar viaje','Hoy '+fFecha(hoy())));
  const rech=S.viajes.filter(v=>esMio(v)&&v.estado==='rechazado');
  if(rech.length){
    const n=el('div',{class:'note bad'});
    n.innerHTML='<b>'+rech.length+' viaje(s) rechazado(s).</b> Revísalos en Mis viajes y vuelve a registrarlos corregidos.';
    c.appendChild(n);
  }
  const b=el('button',{class:'btn big acc',type:'button'},'Registrar un viaje');
  b.onclick=()=>formViaje();
  c.appendChild(b);
  const t=el('div',{class:'tiles'});
  t.innerHTML=tile('Viajes de hoy',nf.format(sumCant(mios)),mios.length+' registros')+
    tile('m³ de hoy',n2(sumM3(mios)),'')+
    tile('Por validar',nf.format(sumCant(mios.filter(v=>(v.estado||'pendiente')==='pendiente'))),'');
  c.appendChild(t);
  const l=el('div',{class:'stack'});
  if(!mios.length)l.appendChild(el('div',{class:'empty'},'Todavía no has registrado viajes hoy.'));
  mios.sort((a,b)=>(b.upd||0)-(a.upd||0)).forEach(v=>l.appendChild(itemViaje(v,true)));
  c.appendChild(l);
  return c;
}
/* ---------- historial del conductor: hoy, semana, mes, año ---------- */
const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MESC=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DIAS=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const pad2=x=>String(x).padStart(2,'0');
const fISO=d=>d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
const desdeISO=s=>{const p=String(s).split('-');return new Date(+p[0],+p[1]-1,+p[2])};
const PC={k:'mes',from:'',to:''};
/* Un viaje es mío si coincide el identificador o, en su defecto, el nombre que
   quedó guardado en el propio viaje. Así el historial no se pierde si la oficina
   recrea al conductor o si entro desde otro teléfono. */
function esMio(v){
  if(v.borrado)return false;
  if(v.conductorId&&S.cfg.conductorId&&v.conductorId===S.cfg.conductorId)return true;
  const yo=miConductor();
  if(!yo)return false;
  // basta con que coincida el usuario O el nombre; no se exige que coincidan los dos
  if(v.conductorUsuario&&yo.usuario&&normUsr(v.conductorUsuario)===normUsr(yo.usuario))return true;
  if(v.conductorNombre&&yo.nombre&&normUsr(v.conductorNombre)===normUsr(yo.nombre))return true;
  if(v.conductorId&&yo.usuario&&normUsr(v.conductorId)===normUsr(yo.usuario))return true;
  return false;
}
function aplicarPreset(k){
  PC.k=k;const h=new Date();
  if(k==='hoy'){PC.from=PC.to=hoy();return}
  if(k==='semana'){const d=new Date(h);d.setDate(d.getDate()-((d.getDay()+6)%7));
    const e=new Date(d);e.setDate(d.getDate()+6);PC.from=fISO(d);PC.to=fISO(e);return}
  if(k==='mes'){PC.from=fISO(new Date(h.getFullYear(),h.getMonth(),1));PC.to=fISO(new Date(h.getFullYear(),h.getMonth()+1,0));return}
  if(k==='anio'){PC.from=h.getFullYear()+'-01-01';PC.to=h.getFullYear()+'-12-31';return}
  PC.from='0000-01-01';PC.to='9999-12-31';
}
function rotuloPeriodo(){
  const h=new Date();
  if(PC.k==='hoy')return DIAS[h.getDay()][0].toUpperCase()+DIAS[h.getDay()].slice(1)+' '+fFecha(hoy());
  if(PC.k==='semana')return 'Del '+fFecha(PC.from)+' al '+fFecha(PC.to);
  if(PC.k==='mes')return MESES[h.getMonth()][0].toUpperCase()+MESES[h.getMonth()].slice(1)+' de '+h.getFullYear();
  if(PC.k==='anio')return 'Año '+h.getFullYear();
  return 'Todo el historial';
}
function pagoDe(d,vs){
  if(!d)return 0;
  if(d.tipoPago==='Porcentaje')return sumTot(vs)*(+d.porcentaje||0)/100;
  return sumCant(vs)*(+d.valorViaje||0);
}
function barras(titulo,filas){
  if(!filas.length)return null;
  const max=Math.max.apply(null,filas.map(f=>f.v))||1;
  const d=el('div',{class:'card'});
  d.innerHTML='<h3>'+esc(titulo)+'</h3>';
  const b=el('div',{class:'pad stack',style:'gap:9px'});
  b.innerHTML=filas.map(f=>
    '<div><div class="row" style="gap:8px"><span style="font-size:13px">'+esc(f.l)+'</span>'+
    '<span class="spacer"></span><span class="mono">'+esc(f.r)+'</span></div>'+
    '<div class="pbar" style="margin-top:4px"><i style="width:'+Math.round(f.v/max*100)+'%"></i></div></div>').join('');
  d.appendChild(b);return d;
}
function vMios(){
  if(!PC.from)aplicarPreset(PC.k||'mes');
  const c=el('div',{class:'stack'});
  const yo=miConductor()||{};
  const todos=S.viajes.filter(esMio);
  const mios=todos.filter(v=>v.fecha>=PC.from&&v.fecha<=PC.to);
  const pagados=mios.filter(v=>v.estado==='aprobado'||v.estado==='facturado');
  const pend=mios.filter(v=>(v.estado||'pendiente')==='pendiente');

  c.appendChild(ph('Mi trabajo',(yo.nombre?yo.nombre+' · ':'')+rotuloPeriodo()));

  const chips=el('div',{class:'bar',style:'background:none;border:0;padding:0'});
  [['hoy','Hoy'],['semana','Semana'],['mes','Mes'],['anio','Año'],['todo','Todo']].forEach(([k,l])=>{
    const b=el('button',{type:'button'},l);
    if(k===PC.k)b.setAttribute('aria-current','true');
    b.onclick=()=>{aplicarPreset(k);render()};
    chips.appendChild(b);
  });
  c.appendChild(chips);

  const t=el('div',{class:'tiles'});
  let h=tile('Viajes',nf.format(sumCant(mios)),'en '+plu(mios.length,'registro'))+
        tile('Metros cúbicos',n2(sumM3(mios)),'transportados');
  if(S.cfg.verPagoConductor!==false){
    h+=tile('Tu liquidación',money(pagoDe(yo,pagados)),
      yo.tipoPago==='Porcentaje'?((+yo.porcentaje||0)+'% del flete'):(money(yo.valorViaje||0)+' por viaje'),1);
    if(pend.length)h+=tile('En espera',money(pagoDe(yo,pend)),'de '+sumCant(pend)+' viaje(s) por validar');
  }else{
    h+=tile('Aprobados',nf.format(sumCant(pagados)),'de '+sumCant(mios)+' viajes');
  }
  t.innerHTML=h;
  c.appendChild(t);

  if(S.cfg.verPagoConductor!==false&&mios.length){
    const n=el('div',{class:'note'});
    n.innerHTML='Se te liquidan los viajes <b>aprobados</b> por la oficina. Los que están por validar aparecen aparte hasta que los revisen.';
    c.appendChild(n);
  }

  // actividad en el tiempo
  if(mios.length){
    const g={};
    const porMes=(PC.k==='anio'||PC.k==='todo');
    mios.forEach(v=>{
      const k=porMes?v.fecha.slice(0,7):v.fecha;
      (g[k]=g[k]||[]).push(v);
    });
    const filas=Object.keys(g).sort().reverse().slice(0,14).map(k=>{
      const a=g[k];
      let l;
      if(porMes){const p=k.split('-');l=MESC[+p[1]-1]+' '+p[0]}
      else{const d=desdeISO(k);l=DIAS[d.getDay()].slice(0,3)+' '+fFecha(k).slice(0,5)}
      const pago=S.cfg.verPagoConductor!==false?'  ·  '+money(pagoDe(yo,a.filter(v=>v.estado==='aprobado'||v.estado==='facturado'))):'';
      return {l,v:sumCant(a),r:nf.format(sumCant(a))+' viajes · '+n2(sumM3(a))+' m³'+pago};
    });
    const bl=barras(porMes?'Mes a mes':'Día a día',filas);
    if(bl)c.appendChild(bl);

    const go={};mios.forEach(v=>{(go[kObra(v)]=go[kObra(v)]||[]).push(v)});
    const fo=Object.keys(go).map(k=>{const a=go[k];
      return{l:tObra(a[0]),v:sumCant(a),r:nf.format(sumCant(a))+' viajes · '+n2(sumM3(a))+' m³'}})
      .sort((a,b)=>b.v-a.v);
    const bo=barras('Por obra',fo);
    if(bo)c.appendChild(bo);
  }

  // listado agrupado por día
  const lst=el('div',{class:'stack'});
  if(!mios.length){
    const z=el('div',{class:'empty'});
    if(todos.length){
      z.innerHTML='No tienes viajes en este periodo, pero sí tienes <b>'+sumCant(todos)+'</b> en tu historial.';
      const t=el('button',{class:'btn sec',type:'button',style:'margin-top:12px'},'Ver todo mi historial');
      t.onclick=()=>{aplicarPreset('todo');render()};
      z.appendChild(document.createElement('br'));z.appendChild(t);
    }else{
      z.textContent=PC.k==='hoy'?'Todavía no has registrado viajes hoy.':'Todavía no tienes viajes registrados.';
      // Diagnóstico: si el teléfono sí tiene viajes pero ninguno a tu nombre, hay que verlo.
      const otros=S.viajes.filter(x=>!x.borrado);
      if(otros.length){
        const duenos=[...new Set(otros.map(x=>(x.conductorNombre||'').trim()||'(sin nombre)'))];
        const d=el('div',{class:'note',style:'text-align:left;margin-top:14px;font-size:12.5px'});
        d.innerHTML='<b>Revisa esto con la oficina.</b><br>'+
          'Este teléfono tiene '+otros.length+' viaje(s) guardados, pero ninguno a tu nombre.<br>'+
          'Entraste como <b>'+esc(yo.nombre||'—')+'</b>'+(yo.usuario?' ('+esc(yo.usuario)+')':'')+'.<br>'+
          'Los viajes guardados están a nombre de: '+esc(duenos.join(', '))+'.';
        z.appendChild(d);
      }
    }
    lst.appendChild(z);
  }else{
    const gd={};mios.forEach(v=>{(gd[v.fecha]=gd[v.fecha]||[]).push(v)});
    Object.keys(gd).sort().reverse().forEach(f=>{
      const a=gd[f].sort((x,y)=>(y.upd||0)-(x.upd||0));
      const d=desdeISO(f);
      const enc=el('div',{class:'row',style:'gap:8px;margin-top:4px'});
      enc.innerHTML='<b style="font-family:var(--disp);font-size:14px">'+DIAS[d.getDay()][0].toUpperCase()+DIAS[d.getDay()].slice(1)+' '+fFecha(f)+'</b>'+
        '<span class="spacer"></span><span class="mono" style="color:var(--muted)">'+nf.format(sumCant(a))+' viajes · '+n2(sumM3(a))+' m³</span>';
      lst.appendChild(enc);
      a.forEach(v=>lst.appendChild(itemViaje(v,true)));
    });
  }
  c.appendChild(lst);
  const pie=el('div',{class:'row',style:'margin-top:6px'});
  const out=el('button',{class:'btn sec',type:'button'},'Cerrar sesión');
  out.onclick=async()=>{
    // se borra también lo que el teléfono recordaba del turno anterior
    S.cfg.rol='';S.cfg.auth=false;S.cfg.conductorId='';
    S.cfg.ultVolqueta='';S.cfg.ultObra='';S.cfg.ultConductor='';
    await guardarCfg();PC.k='mes';PC.from='';
    pintarGate(conectado()?'con2':'rol');
  };
  const upd=el('button',{class:'btn sec sm',type:'button'},'Buscar actualización');
  upd.onclick=buscarActualizacion;
  pie.appendChild(out);pie.appendChild(upd);
  pie.appendChild(el('div',{class:'spacer'}));
  pie.appendChild(el('span',{style:'font-size:12px;color:var(--muted)'},'Versión '+VERSION));
  c.appendChild(pie);
  return c;
}
function itemViaje(v,corto){
  const k=calcViaje(v);
  const d=el('div',{class:'item'});
  const th=el('div');
  if(v.fotoId){const im=imgFoto(v.fotoId,54,'thumb');im.onclick=()=>verFoto(v.fotoId);th.appendChild(im)}
  else{const x=el('div',{class:'thumb',style:'display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:10px;text-align:center;cursor:default'},'sin<br>foto');th.appendChild(x)}
  d.appendChild(th);
  const m=el('div',{class:'m'});
  const placa=tVol(v)||'sin placa';
  const cond=tCon(v)||'sin conductor';
  m.innerHTML='<div class="t">'+esc(tObra(v))+'</div>'+
    '<div class="d">'+fFecha(v.fecha)+' · Vale '+esc(v.vale||'s/n')+'</div>'+
    '<div class="d">'+(tVol(v)?'':'<span style="color:var(--bad)">')+esc(placa)+(tVol(v)?'':'</span>')+
      ' · '+esc(cond)+'</div>'+
    '<div class="d">'+nf.format(k.cant)+' viaje(s) · '+n2(k.m3Tot)+' m³</div>'+
    '<div style="margin-top:6px">'+chipE(v.estado)+(v.dirty?' <span class="chip neu">Por enviar</span>':'')+'</div>'+
    (v.estado==='rechazado'&&v.motivo?'<div class="d" style="color:var(--bad);margin-top:4px">Motivo: '+esc(v.motivo)+'</div>':'');
  d.appendChild(m);
  if(esAdmin()||S.cfg.verPagoConductor!==false){const n=el('div',{class:'n'},money(k.total));d.appendChild(n)}
  d.style.cursor='pointer';
  d.addEventListener('click',e=>{if(e.target.classList.contains('thumb'))return;
    if(esAdmin())formViaje(v);
    else if((v.estado||'pendiente')==='pendiente'||v.estado==='rechazado')formViaje(v);
    else toast('Este viaje ya fue aprobado: pídele el cambio a la oficina.')});
  return d;
}

/* ===================== formulario de viaje ===================== */
function formViaje(v){
  v=v||{};
  const nuevo=!v.id;
  const soloLectura=!esAdmin()&&(v.estado==='aprobado'||v.estado==='facturado');
  const obras=S.mae.obras.filter(o=>o.activa!==false||o.id===v.obraId);
  const vols=S.mae.volquetas.filter(o=>o.activa!==false||o.id===v.volquetaId);
  const cons=S.mae.conductores.filter(o=>o.activo!==false||o.id===v.conductorId);
  const conId=esAdmin()?(v.conductorId||S.cfg.ultConductor||''):S.cfg.conductorId;
  // La placa y la obra vienen preseleccionadas con las del viaje anterior: en la obra
  // se repiten todo el día y así no se queda ningún registro sin placa.
  const volSel=v.volquetaId||(nuevo?(S.cfg.ultVolqueta||(vols.length===1?vols[0].id:'')):'');
  const obraSel=v.obraId||(nuevo?(S.cfg.ultObra||(obras.length===1?obras[0].id:'')):'');
  const yo=esAdmin()?null:miConductor();
  const b=el('div');
  b.innerHTML=(yo?'<div class="note" style="margin-bottom:12px">Registras como <b>'+esc(yo.nombre)+'</b>'+
      (yo.usuario?' <span class="mono">('+esc(yo.usuario)+')</span>':'')+'</div>':'')+
    '<div class="gf">'+
    fld('Fecha','<input type="date" id="fFecha" value="'+esc(v.fecha||hoy())+'">')+
    fld('N.º de vale','<input id="fVale" inputmode="numeric" value="'+esc(v.vale||'')+'" placeholder="Ej. 10482">')+
    '</div>'+
    '<div style="margin-top:10px">'+fld('Obra','<select id="fObra">'+(obraSel?'':'<option value="">Selecciona la obra…</option>')+obras.map(o=>'<option value="'+o.id+'"'+(o.id===obraSel?' selected':'')+'>'+esc(o.nombre)+'</option>').join('')+'</select>')+'</div>'+
    '<div class="gf" style="margin-top:10px">'+
    fld('Volqueta (placa)','<select id="fVol">'+(volSel?'':'<option value="">Selecciona la placa…</option>')+vols.map(o=>'<option value="'+o.id+'"'+(o.id===volSel?' selected':'')+'>'+esc(o.placa)+'</option>').join('')+'</select>')+
    (esAdmin()?fld('Conductor','<select id="fCon">'+(conId?'':'<option value="">Selecciona…</option>')+cons.map(o=>'<option value="'+o.id+'"'+(o.id===conId?' selected':'')+'>'+esc(o.nombre)+'</option>').join('')+'</select>'):'')+
    fld('Cantidad de viajes','<input type="number" id="fCant" inputmode="numeric" min="1" step="1" value="'+(v.cant||1)+'">')+
    fld('m³ por viaje','<input type="number" id="fM3" inputmode="decimal" min="0" step="0.5" value="'+(v.m3!=null?v.m3:'')+'" placeholder="Ej. 7">')+
    '</div>'+
    (esAdmin()?'<div class="card" style="margin-top:12px"><div class="pad"><div class="row"><span style="font-size:13px">Valor del registro</span><span class="spacer"></span><b id="fTot" style="font-family:var(--disp);font-size:20px">$ 0</b></div></div></div>':'')+
    '<div style="margin-top:10px">'+fld('Observaciones','<textarea id="fObs" placeholder="Novedades, material, demoras…">'+esc(v.obs||'')+'</textarea>')+'</div>'+
    '<div style="margin-top:12px"><label class="f"><span>Foto del vale o del servicio</span>'+
      '<input type="file" id="fFile" accept="image/*" capture="environment"></label>'+
      '<div id="fPrev" style="margin-top:10px"></div></div>'+
    '<div class="row" style="margin-top:16px">'+
      (soloLectura?'':'<button class="btn acc" id="fOk" style="flex:1">Guardar</button>')+
      '<button class="btn sec" id="fC">Cerrar</button>'+
      (v.id&&esAdmin()?'<button class="btn bad" id="fD">Eliminar</button>':'')+
    '</div>';

  const g=i=>$('#'+i,b);
  let fotoId=v.fotoId||null;
  const prev=()=>{const box=$('#fPrev',b);box.innerHTML='';if(!fotoId)return;
    box.appendChild(imgFoto(fotoId,220));
    if(!soloLectura){const q=el('button',{class:'btn sm sec',type:'button',style:'margin-top:8px'},'Quitar foto');
      q.onclick=()=>{fotoId=null;prev()};box.appendChild(q)}};
  prev();
  g('fFile').onchange=async ev=>{
    const f=ev.target.files&&ev.target.files[0];if(!f)return;
    toast('Procesando foto…');
    try{const d=await comprimir(f);fotoId=await guardarFoto(d);prev();toast('Foto lista. Falta guardar el viaje.')}
    catch(e){toast('No se pudo procesar la foto. Intenta con otra.')}
    ev.target.value='';
  };
  function calc(){const t=$('#fTot',b);if(!t)return;
    const o=byId(S.mae.obras,g('fObra').value)||{};
    const cant=+g('fCant').value||1,m3=+g('fM3').value||0;
    t.textContent=money(cant*(+o.valorViaje||0)+cant*m3*(+o.valorM3||0))}
  b.addEventListener('input',calc);b.addEventListener('change',calc);calc();
  if(soloLectura)$$('input,select,textarea',b).forEach(x=>x.disabled=true);

  $('#fC',b).onclick=cerrar;
  const dl=$('#fD',b);
  if(dl)dl.onclick=async()=>{
    if(v.estado==='facturado'){toast('No se puede borrar un viaje ya facturado');return}
    v.borrado=true;v.estado='rechazado';v.motivo='Eliminado por la oficina';await guardarViaje(v);cerrar();render();toast('Viaje eliminado')};
  const ok=$('#fOk',b);
  if(ok)ok.onclick=async()=>{
    if(!g('fObra').value){toast('Selecciona la obra');return}
    if(!g('fVol').value){toast('Selecciona la placa de la volqueta');g('fVol').focus();return}
    const cid=esAdmin()?(g('fCon')?g('fCon').value:conId):S.cfg.conductorId;
    if(!cid){toast('Selecciona el conductor');return}
    const ob=byId(S.mae.obras,g('fObra').value)||{};
    const vo=byId(S.mae.volquetas,g('fVol').value)||{};
    const co=byId(S.mae.conductores,cid)||{};
    if(!esAdmin()&&!co.id){toast('No se reconoce tu usuario. Cierra sesión y vuelve a entrar.');return}
    const cl=byId(S.mae.clientes,ob.clienteId)||{};
    const nv=Object.assign({},v,{
      id:v.id||uid('t'),fecha:g('fFecha').value||hoy(),vale:g('fVale').value.trim(),
      obraId:g('fObra').value,volquetaId:g('fVol').value,conductorId:cid,
      // copia de seguridad dentro del propio viaje
      obraNombre:ob.nombre||v.obraNombre||'',destino:ob.destino||v.destino||'',
      clienteId:ob.clienteId||v.clienteId||'',clienteNombre:cl.nombre||v.clienteNombre||'',
      placa:vo.placa||v.placa||'',conductorNombre:co.nombre||v.conductorNombre||'',
      conductorUsuario:co.usuario||v.conductorUsuario||'',
      valorViaje:+(ob.valorViaje||0),valorM3:+(ob.valorM3||0),
      cant:Math.max(1,+g('fCant').value||1),m3:+g('fM3').value||0,
      obs:g('fObs').value.trim(),fotoId:fotoId,
      creadoPor:v.creadoPor||(esAdmin()?'admin':'conductor'),
      estado:esAdmin()?(v.estado||'aprobado'):'pendiente',
      motivo:esAdmin()?(v.motivo||''):'' ,borrado:false
    });
    await guardarViaje(nv);
    S.cfg.ultVolqueta=nv.volquetaId;S.cfg.ultObra=nv.obraId;
    if(esAdmin())S.cfg.ultConductor=cid;
    await guardarCfg();
    cerrar();render();
    toast(nuevo?(esAdmin()?'Viaje registrado':'Enviado. La oficina lo validará.'):'Viaje actualizado');
  };
  abrir(nuevo?'Registrar viaje':'Viaje',b);
}

/* ===================== ADMIN: validar ===================== */
function vValidar(){
  const c=el('div',{class:'stack'});
  const pend=S.viajes.filter(v=>(v.estado||'pendiente')==='pendiente'&&!v.borrado)
    .sort((a,b)=>a.fecha<b.fecha?1:a.fecha>b.fecha?-1:0);
  c.appendChild(ph('Validar viajes',pend.length?pend.length+' registro(s) esperando revisión':'Todo al día'));
  if(!conectado()){
    const n=el('div',{class:'note'});
    n.innerHTML='<b>Sin conexión configurada.</b> Los conductores no pueden enviarte viajes todavía. Ve a Ajustes → Conexión.';
    c.appendChild(n);
  }
  if(!pend.length){c.appendChild(el('div',{class:'empty'},'No hay viajes pendientes de validar.'));return c}
  const porDia={};pend.forEach(v=>{(porDia[v.fecha]=porDia[v.fecha]||[]).push(v)});
  for(const d of Object.keys(porDia).sort().reverse()){
    const grp=porDia[d];
    const cd=el('div',{class:'card'});
    const h=el('h3');
    h.innerHTML=fFecha(d)+' <span class="chip neu">'+sumCant(grp)+' viajes</span><span class="spacer" style="margin-left:auto"></span>';
    const ba=el('button',{class:'btn sm ok',type:'button'},'Aprobar el día');
    ba.onclick=async()=>{for(const v of grp){v.estado='aprobado';v.motivo='';await guardarViaje(v)}render();toast('Día aprobado')};
    h.appendChild(ba);cd.appendChild(h);
    const body=el('div',{class:'stack',style:'padding:12px'});
    grp.forEach(v=>body.appendChild(tarjetaValidar(v)));
    cd.appendChild(body);c.appendChild(cd);
  }
  return c;
}
function tarjetaValidar(v){
  const k=calcViaje(v);
  const d=el('div',{style:'border:1px solid var(--line);border-radius:11px;padding:11px'});
  const top=el('div',{class:'item',style:'padding:0;border:0;background:none'});
  const th=el('div');
  if(v.fotoId){const im=imgFoto(v.fotoId,54,'thumb');im.onclick=()=>verFoto(v.fotoId);th.appendChild(im)}
  else th.appendChild(el('div',{class:'thumb',style:'display:flex;align-items:center;justify-content:center;color:var(--bad);font-size:10px;text-align:center'},'sin<br>foto'));
  top.appendChild(th);
  const m=el('div',{class:'m'});
  m.innerHTML='<div class="t">'+esc(tObra(v))+'</div>'+
    '<div class="d">Vale '+esc(v.vale||'s/n')+' · '+esc(tVol(v)||'sin placa')+' · '+esc(tCon(v)||'sin conductor')+'</div>'+
    '<div class="d">'+nf.format(k.cant)+' viaje(s) × '+n2(k.m3)+' m³ = '+n2(k.m3Tot)+' m³</div>'+
    (v.obs?'<div class="d">“'+esc(v.obs)+'”</div>':'');
  top.appendChild(m);
  top.appendChild(el('div',{class:'n'},money(k.total)));
  d.appendChild(top);
  const row=el('div',{class:'row',style:'margin-top:10px'});
  const a=el('button',{class:'btn sm ok',type:'button'},'Aprobar');
  a.onclick=async()=>{v.estado='aprobado';v.motivo='';await guardarViaje(v);render();toast('Aprobado')};
  const r=el('button',{class:'btn sm bad',type:'button'},'Rechazar');
  r.onclick=()=>rechazar(v);
  const e=el('button',{class:'btn sm sec',type:'button'},'Corregir');
  e.onclick=()=>formViaje(v);
  row.appendChild(a);row.appendChild(r);row.appendChild(e);
  d.appendChild(row);
  return d;
}
function rechazar(v){
  const b=el('div');
  b.innerHTML='<p style="margin-top:0;color:var(--muted)">El conductor verá el motivo en su teléfono.</p>'+
    fld('Motivo','<select id="rMot"><option>La foto del vale no se ve</option><option>Falta la foto del vale</option><option>El número de vale no coincide</option><option>Los metros cúbicos no coinciden</option><option>Viaje duplicado</option><option>Obra equivocada</option><option>Otro</option></select>')+
    '<div style="margin-top:10px">'+fld('Detalle (opcional)','<input id="rDet" placeholder="Escribe algo más si hace falta">')+'</div>'+
    '<div class="row" style="margin-top:14px"><button class="btn bad" id="rOk" style="flex:1">Rechazar viaje</button><button class="btn sec" id="rC">Cancelar</button></div>';
  $('#rC',b).onclick=cerrar;
  $('#rOk',b).onclick=async()=>{
    const det=$('#rDet',b).value.trim();
    v.estado='rechazado';v.motivo=$('#rMot',b).value+(det?' — '+det:'');
    await guardarViaje(v);cerrar();render();toast('Rechazado, el conductor será notificado al sincronizar');
  };
  abrir('Rechazar viaje',b);
}

/* ===================== ADMIN: viajes ===================== */
let fEstado='todos';
function vViajes(){
  const c=el('div',{class:'stack'});
  const btn=el('button',{class:'btn sm acc',type:'button'},'+ Viaje');
  btn.onclick=()=>formViaje();
  c.appendChild(ph('Viajes',fFecha(P.from)+' al '+fFecha(P.to),btn));
  const per=el('div',{class:'card'});
  per.innerHTML='<div class="pad gf">'+fld('Desde','<input type="date" id="pD" value="'+P.from+'">')+
    fld('Hasta','<input type="date" id="pH" value="'+P.to+'">')+
    fld('Estado','<select id="pE"><option value="todos">Todos</option><option value="pendiente">Por validar</option><option value="aprobado">Aprobados</option><option value="rechazado">Rechazados</option><option value="facturado">Facturados</option><option value="incompletos">Incompletos o en $ 0</option></select>')+'</div>';
  $('#pD',per).onchange=e=>{P.from=e.target.value;render()};
  $('#pH',per).onchange=e=>{P.to=e.target.value;render()};
  $('#pE',per).value=fEstado;
  $('#pE',per).onchange=e=>{fEstado=e.target.value;render()};
  c.appendChild(per);

  let vs=S.viajes.filter(v=>enRango(v)&&!v.borrado);
  if(fEstado==='incompletos')vs=vs.filter(viajeIncompleto);
  else if(fEstado!=='todos')vs=vs.filter(v=>(v.estado||'pendiente')===fEstado);
  vs.sort((a,b)=>a.fecha<b.fecha?1:a.fecha>b.fecha?-1:0);
  const apr=vs.filter(v=>v.estado==='aprobado');
  const t=el('div',{class:'tiles'});
  t.innerHTML=tile('Viajes',nf.format(sumCant(vs)),n2(sumM3(vs))+' m³')+
    tile('Valor',money(sumTot(vs)),'',1)+
    tile('Listo para cobrar',money(sumTot(apr)),sumCant(apr)+' viajes aprobados')+
    tile('Costos',money(S.costos.filter(x=>enRango(x)).reduce((s,x)=>s+(+x.valor||0),0)),'del periodo');
  c.appendChild(t);

  // resumen por obra
  const gr={};vs.forEach(v=>{(gr[kObra(v)]=gr[kObra(v)]||[]).push(v)});
  const cd=el('div',{class:'card'});
  cd.innerHTML='<h3>Por obra</h3>';
  let h='<div class="tw"><table><thead><tr><th>Obra</th><th class="num">Viajes</th><th class="num">m³</th><th class="num">Valor</th></tr></thead><tbody>';
  for(const k in gr){const a=gr[k];h+='<tr><td>'+esc(tObra(a[0]))+'</td><td class="num">'+nf.format(sumCant(a))+'</td><td class="num">'+n2(sumM3(a))+'</td><td class="num">'+money(sumTot(a))+'</td></tr>'}
  h+='</tbody><tfoot><tr><td>Total</td><td class="num">'+nf.format(sumCant(vs))+'</td><td class="num">'+n2(sumM3(vs))+'</td><td class="num">'+money(sumTot(vs))+'</td></tr></tfoot></table></div>';
  cd.appendChild(el('div',null,h));
  c.appendChild(cd);

  const l=el('div',{class:'stack'});
  if(!vs.length)l.appendChild(el('div',{class:'empty'},'No hay viajes con ese filtro.'));
  vs.forEach(v=>l.appendChild(itemViaje(v,false)));
  c.appendChild(l);
  return c;
}

/* ===================== ADMIN: costos ===================== */
const TIPOS=['Combustible','Peajes','Mantenimiento','Llantas','Nómina','Seguros','Otros'];
function vCostos(){
  const c=el('div',{class:'stack'});
  const btn=el('button',{class:'btn sm acc',type:'button'},'+ Costo');
  btn.onclick=()=>formCosto();
  c.appendChild(ph('Costos',fFecha(P.from)+' al '+fFecha(P.to),btn));
  c.appendChild(selectorPeriodo());
  const cs=S.costos.filter(x=>enRango(x)&&!x.borrado).sort((a,b)=>a.fecha<b.fecha?1:-1);
  const tot=cs.reduce((s,x)=>s+(+x.valor||0),0);
  const porTipo={};cs.forEach(x=>porTipo[x.tipo||'Otros']=(porTipo[x.tipo||'Otros']||0)+(+x.valor||0));
  const t=el('div',{class:'tiles'});
  t.innerHTML=tile('Total costos',money(tot),plu(cs.length,'movimiento'),1)+
    Object.keys(porTipo).map(k=>tile(k,money(porTipo[k]),'')).join('');
  c.appendChild(t);
  const l=el('div',{class:'stack'});
  if(!cs.length)l.appendChild(el('div',{class:'empty'},'Sin costos en el periodo.'));
  cs.forEach(x=>{
    const d=el('div',{class:'item'});
    d.innerHTML='<div class="m"><div class="t">'+esc(x.tipo||'Otros')+'</div>'+
      '<div class="d">'+fFecha(x.fecha)+' · '+esc(x.volquetaId?nomVol(x.volquetaId):'General')+'</div>'+
      '<div class="d">'+esc(x.descripcion||'')+'</div></div><div class="n">'+money(x.valor)+'</div>';
    d.style.cursor='pointer';d.onclick=()=>formCosto(x);
    l.appendChild(d);
  });
  c.appendChild(l);
  return c;
}
function formCosto(x){
  x=x||{};const b=el('div');
  b.innerHTML='<div class="gf">'+
    fld('Fecha','<input type="date" id="cF" value="'+esc(x.fecha||hoy())+'">')+
    fld('Tipo','<select id="cT">'+TIPOS.map(t=>'<option'+(t===x.tipo?' selected':'')+'>'+t+'</option>').join('')+'</select>')+
    fld('Volqueta','<select id="cV"><option value="">General</option>'+S.mae.volquetas.map(o=>'<option value="'+o.id+'"'+(o.id===x.volquetaId?' selected':'')+'>'+esc(o.placa)+'</option>').join('')+'</select>')+
    fld('Valor','<input type="number" id="cVal" inputmode="numeric" min="0" step="1000" value="'+(x.valor||'')+'">')+
    '</div><div style="margin-top:10px">'+fld('Detalle','<input id="cD" value="'+esc(x.descripcion||'')+'">')+'</div>'+
    '<div class="row" style="margin-top:14px"><button class="btn acc" id="cOk" style="flex:1">Guardar</button><button class="btn sec" id="cC">Cancelar</button>'+
    (x.id?'<button class="btn bad" id="cDel">Eliminar</button>':'')+'</div>';
  $('#cC',b).onclick=cerrar;
  const dl=$('#cDel',b);
  if(dl)dl.onclick=async()=>{x.borrado=true;x.valor=0;await guardarCosto(x);cerrar();render();toast('Eliminado')};
  $('#cOk',b).onclick=async()=>{
    const o=Object.assign({},x,{id:x.id||uid('k'),fecha:$('#cF',b).value||hoy(),tipo:$('#cT',b).value,
      volquetaId:$('#cV',b).value,valor:+$('#cVal',b).value||0,descripcion:$('#cD',b).value.trim(),borrado:false});
    await guardarCosto(o);cerrar();render();toast('Costo guardado');
  };
  abrir(x.id?'Editar costo':'Registrar costo',b);
}

/* ===================== ADMIN: cobro ===================== */
let cobroCli='', cobroObra='', verBorradas=false;
function vCobro(){
  const c=el('div',{class:'stack'});
  c.appendChild(ph('Cuenta de cobro',fFecha(P.from)+' al '+fFecha(P.to)));
  if(!S.mae.clientes.length){c.appendChild(el('div',{class:'empty'},'Registra un cliente en Ajustes para poder cobrar.'));return c}
  if(!cobroCli)cobroCli=S.mae.clientes[0].id;
  const card=el('div',{class:'card'});
  card.innerHTML='<h3>Nuevo documento</h3><div class="pad">'+
    '<div class="gf">'+fld('Cliente','<select id="kCli">'+S.mae.clientes.map(o=>'<option value="'+o.id+'"'+(o.id===cobroCli?' selected':'')+'>'+esc(o.nombre)+'</option>').join('')+'</select>')+
    fld('Desde','<input type="date" id="pD" value="'+P.from+'">')+fld('Hasta','<input type="date" id="pH" value="'+P.to+'">')+'</div>'+
    '<div style="margin-top:10px" id="kObraSel"></div>'+
    '<div id="kBody" style="margin-top:12px"></div></div>';
  $('#kCli',card).onchange=e=>{cobroCli=e.target.value;cobroObra='';render()};
  $('#pD',card).onchange=e=>{P.from=e.target.value;render()};
  $('#pH',card).onchange=e=>{P.to=e.target.value;render()};
  c.appendChild(card);

  const delCliente=S.viajes.filter(v=>v.estado==='aprobado'&&!v.borrado&&enRango(v)&&tCliId(v)===cobroCli);
  // Obras del cliente que tienen viajes aprobados en el corte
  const obrasCorte=[];
  delCliente.forEach(v=>{const k=kObra(v);if(!obrasCorte.some(o=>o.k===k))obrasCorte.push({k,nombre:tObra(v),ej:v})});
  if(cobroObra&&!obrasCorte.some(o=>o.k===cobroObra))cobroObra='';
  $('#kObraSel',card).innerHTML=fld('Obra a facturar',
    '<select id="kObra"><option value="">Todas las obras del cliente ('+obrasCorte.length+')</option>'+
    obrasCorte.map(o=>{const a=delCliente.filter(v=>kObra(v)===o.k);
      return '<option value="'+esc(o.k)+'"'+(o.k===cobroObra?' selected':'')+'>'+esc(o.nombre)+
        ' — '+sumCant(a)+' viajes · '+money(sumTot(a))+'</option>'}).join('')+'</select>');
  const so=$('#kObra',card);if(so)so.onchange=e=>{cobroObra=e.target.value;render()};

  const list=cobroObra?delCliente.filter(v=>kObra(v)===cobroObra):delCliente;
  const pendVal=S.viajes.filter(v=>(v.estado||'pendiente')==='pendiente'&&enRango(v)&&tCliId(v)===cobroCli&&
    (!cobroObra||kObra(v)===cobroObra));
  const body=$('#kBody',card);
  let h='';
  if(pendVal.length)h+='<div class="note" style="margin-bottom:10px"><b>'+sumCant(pendVal)+' viaje(s) sin validar</b> de este cliente no entran a la cuenta. Valídalos primero.</div>';
  if(!list.length){h+='<div class="empty">No hay viajes aprobados de este cliente en las fechas.</div>';body.innerHTML=h}
  else{
    const k=totales(list);
    h+='<div class="tiles">'+tile('Subtotal fletes',money(k.sub),sumCant(list)+' viajes · '+n2(sumM3(list))+' m³')+
      tile('IVA '+n2(S.cfg.iva)+'%',money(k.iva),'')+
      tile('Total',money(k.total),'',1)+
      tile('Neto a recibir',money(k.pagar),'menos retenciones')+'</div>'+
      '<div class="row" style="margin-top:12px"><button class="btn acc" id="kGen" style="flex:1">Generar cuenta de cobro</button></div>';
    body.innerHTML=h;
    $('#kGen',body).onclick=async()=>{
      const num=(S.cfg.prefijo||'CC-')+String(S.cfg.consecutivo||1).padStart(4,'0');
      const f={id:uid('f'),numero:num,fecha:hoy(),clienteId:cobroCli,desde:P.from,hasta:P.to,
        obraNombre:cobroObra?tObra(list[0]):'',
        viajeIds:list.map(v=>v.id),pIva:+S.cfg.iva||0,pRf:+S.cfg.retefuente||0,pRi:+S.cfg.reteica||0,
        subtotal:k.sub,iva:k.iva,retefuente:k.rf,reteica:k.ri,total:k.total,pagar:k.pagar,
        viajes:sumCant(list),m3:sumM3(list),estado:'emitida'};
      await guardarFactura(f);
      for(const v of list){v.estado='facturado';v.facturaId=f.id;await guardarViaje(v)}
      S.cfg.consecutivo=(+S.cfg.consecutivo||1)+1;await guardarCfg();
      render();verFactura(f.id);toast('Documento '+num+' generado');
    };
  }

  const borrados=S.facturas.filter(f=>f.borrado).sort((a,b)=>a.fecha<b.fecha?1:-1);
  const hist=(verBorradas?borrados:S.facturas.filter(f=>!f.borrado)).sort((a,b)=>a.fecha<b.fecha?1:-1);
  const hc=el('div',{class:'card'});
  const hh=el('h3');
  hh.innerHTML=(verBorradas?'Documentos eliminados':'Documentos emitidos')+'<span class="spacer" style="margin-left:auto"></span>';
  if(borrados.length||verBorradas){
    const tg=el('button',{class:'btn sm sec',type:'button'},verBorradas?'Ver emitidos':'Ver eliminados ('+borrados.length+')');
    tg.onclick=()=>{verBorradas=!verBorradas;render()};
    hh.appendChild(tg);
  }
  hc.appendChild(hh);
  const hl=el('div',{class:'stack',style:'padding:12px'});
  if(!hist.length)hl.appendChild(el('div',{class:'empty'},verBorradas?'No hay documentos eliminados.':'Todavía no has emitido documentos.'));
  hist.forEach(f=>{
    const d=el('div',{class:'item'});
    const chip=f.borrado?'<span class="chip rec">Eliminado'+(f.borradoEn?' el '+fFecha(f.borradoEn):'')+'</span>':
      f.estado==='pagada'?'<span class="chip apr">Pagada</span>':
      f.estado==='anulada'?'<span class="chip rec">Anulada</span>':'<span class="chip fac">Emitida</span>';
    d.innerHTML='<div class="m"><div class="t">'+esc(f.numero)+'</div>'+
      '<div class="d">'+esc(nomCli(f.clienteId))+(f.obraNombre?' · '+esc(f.obraNombre):'')+' · '+fFecha(f.desde)+' al '+fFecha(f.hasta)+'</div>'+
      '<div style="margin-top:5px">'+chip+'</div></div>'+
      '<div class="n">'+money(f.pagar)+'</div>';
    if(f.borrado){d.style.opacity='.62'}
    else{d.style.cursor='pointer';d.onclick=()=>verFactura(f.id)}
    hl.appendChild(d);
  });
  hc.appendChild(hl);c.appendChild(hc);
  return c;
}
function totales(vs){
  const sub=sumTot(vs);
  const iva=sub*(+S.cfg.iva||0)/100, rf=sub*(+S.cfg.retefuente||0)/100, ri=sub*(+S.cfg.reteica||0)/100;
  return {sub,iva,rf,ri,total:sub+iva,pagar:sub+iva-rf-ri};
}
function verFactura(id){
  const f=byId(S.facturas,id);if(!f)return;
  const b=el('div');
  b.innerHTML='<div id="fv"></div><div class="row" style="margin-top:14px">'+
    '<button class="btn acc" id="vP" style="flex:1">Imprimir / PDF</button>'+
    (f.estado==='emitida'?'<button class="btn sec" id="vPag">Marcar pagada</button>':'')+
    (f.estado!=='anulada'?'<button class="btn sec" id="vAn">Anular</button>':'')+
    '<span class="spacer"></span><button class="btn bad" id="vDel">Eliminar</button></div>';
  $('#fv',b).innerHTML=docFactura(f);
  $('#vP',b).onclick=()=>{$('#print').innerHTML=docFactura(f);window.print()};
  const p=$('#vPag',b);if(p)p.onclick=async()=>{f.estado='pagada';await guardarFactura(f);cerrar();render();toast('Marcada como pagada')};
  const a=$('#vAn',b);if(a)a.onclick=async()=>{
    f.estado='anulada';await guardarFactura(f);
    for(const vid of (f.viajeIds||[])){const v=byId(S.viajes,vid);if(v){v.estado='aprobado';v.facturaId=null;await guardarViaje(v)}}
    cerrar();render();toast('Anulado. Los viajes vuelven a estar disponibles.')};
  $('#vDel',b).onclick=()=>eliminarFactura(f);
  abrir('Documento '+f.numero,b);
}
function eliminarFactura(f){
  const n=(f.viajeIds||[]).length;
  const b=el('div');
  b.innerHTML='<div class="note bad"><b>Vas a eliminar el documento '+esc(f.numero)+'.</b><br>'+
      (n===1?'El viaje que incluye vuelve a quedar disponible para cobrarlo en otro documento. '
            :'Los '+n+' viajes que incluye vuelven a quedar disponibles para cobrarlos en otro documento. ')+
      'El número '+esc(f.numero)+' no se reutiliza.</div>'+
    '<div style="margin-top:12px">'+
    fld('Escribe la clave de administrador','<input id="dPin" type="password" inputmode="numeric" maxlength="4" placeholder="••••" style="font-size:24px;text-align:center;letter-spacing:.4em">')+
    '</div>'+
    '<div class="row" style="margin-top:14px"><button class="btn bad" id="dOk" style="flex:1">Eliminar documento</button>'+
    '<button class="btn sec" id="dC">Cancelar</button></div>'+
    '<p style="color:var(--muted);font-size:12px;margin:12px 0 0">Queda registrado quién y cuándo lo eliminó. '+
    'Puedes verlo después con “Ver eliminados”.</p>';
  $('#dC',b).onclick=cerrar;
  $('#dOk',b).onclick=async()=>{
    const pin=$('#dPin',b).value.trim();
    if(!S.cfg.pin){toast('Primero crea una clave de administrador');return}
    if(pin!==S.cfg.pin){toast('Clave incorrecta');$('#dPin',b).value='';return}
    for(const vid of (f.viajeIds||[])){
      const v=byId(S.viajes,vid);
      if(v&&v.estado==='facturado'){v.estado='aprobado';v.facturaId=null;await guardarViaje(v)}
    }
    f.borrado=true;f.borradoEn=hoy();f.estado='eliminada';
    await guardarFactura(f);
    cerrar();render();toast('Documento '+f.numero+' eliminado');
  };
  abrir('Eliminar documento',b);
  setTimeout(()=>{const i=$('#dPin',b);if(i)i.focus()},60);
}
function docFactura(f){
  const e=S.cfg.empresa||{},cli=byId(S.mae.clientes,f.clienteId)||{};
  const vs=(f.viajeIds||[]).map(i=>byId(S.viajes,i)).filter(Boolean);
  const gr={};vs.forEach(v=>{(gr[kObra(v)]=gr[kObra(v)]||[]).push(v)});
  let det='';
  for(const k in gr){const a=gr[k],o=byId(S.mae.obras,a[0].obraId)||{},c=calcViaje(a[0]);
    const dest=o.destino||a[0].destino||'';
    det+='<tr><td><b>'+esc(tObra(a[0]))+'</b><br><span style="color:#5A615A">Transporte y disposición de escombros'+(dest?' — '+esc(dest):'')+'</span></td>'+
      '<td style="text-align:right">'+nf.format(sumCant(a))+'</td><td style="text-align:right">'+n2(sumM3(a))+'</td>'+
      '<td style="text-align:right">'+nf.format(c.vv)+' / '+nf.format(c.vm)+'</td>'+
      '<td style="text-align:right">'+money(sumTot(a))+'</td></tr>'}
  let anx='<tr><th>Fecha</th><th>Vale</th><th>Obra</th><th>Placa</th><th>Conductor</th><th style="text-align:right">Viajes</th><th style="text-align:right">m³</th><th style="text-align:right">Valor</th></tr>';
  vs.sort((a,b)=>a.fecha<b.fecha?-1:1).forEach(v=>{const c=calcViaje(v);
    anx+='<tr><td>'+fFecha(v.fecha)+'</td><td>'+esc(v.vale||'')+'</td><td>'+esc(tObra(v))+'</td><td>'+esc(tVol(v))+'</td><td>'+esc(tCon(v))+'</td><td style="text-align:right">'+nf.format(c.cant)+'</td><td style="text-align:right">'+n2(c.m3Tot)+'</td><td style="text-align:right">'+money(c.total)+'</td></tr>'});
  return '<div class="doc">'+
    '<div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap">'+
    '<div><div style="font-family:var(--disp);font-weight:800;font-size:19px">'+esc(e.nombre||'Mi empresa')+'</div>'+
    '<div style="color:#5A615A">NIT '+esc(e.nit||'—')+(e.direccion?' · '+esc(e.direccion):'')+(e.ciudad?' · '+esc(e.ciudad):'')+(e.telefono?' · Tel. '+esc(e.telefono):'')+'</div></div>'+
    '<div style="text-align:right"><div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#5A615A">Cuenta de cobro</div>'+
    '<div style="font-family:var(--disp);font-weight:800;font-size:19px">'+esc(f.numero)+'</div>'+
    '<div style="color:#5A615A">'+fFecha(f.fecha)+'</div></div></div><div class="hr"></div>'+
    '<div style="display:flex;gap:26px;flex-wrap:wrap;margin-bottom:10px">'+
    '<div><div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#5A615A">Cliente</div><b>'+esc(cli.nombre||'—')+'</b><br>NIT '+esc(cli.nit||'—')+'</div>'+
    '<div><div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#5A615A">Periodo</div><b>'+fFecha(f.desde)+' al '+fFecha(f.hasta)+'</b><br>'+nf.format(f.viajes||0)+' viajes · '+n2(f.m3||0)+' m³</div></div>'+
    '<div class="tw"><table><thead><tr><th>Concepto</th><th style="text-align:right">Viajes</th><th style="text-align:right">m³</th><th style="text-align:right">Tarifa viaje / m³</th><th style="text-align:right">Valor</th></tr></thead><tbody>'+det+'</tbody></table></div>'+
    '<div style="display:flex;justify-content:flex-end;margin-top:10px"><table style="width:auto;min-width:270px"><tbody>'+
    '<tr><td>Subtotal fletes</td><td style="text-align:right">'+money(f.subtotal)+'</td></tr>'+
    '<tr><td>IVA ('+n2(f.pIva)+'%)</td><td style="text-align:right">'+money(f.iva)+'</td></tr>'+
    '<tr style="font-weight:700"><td>Total factura</td><td style="text-align:right">'+money(f.total)+'</td></tr>'+
    '<tr><td>Retefuente ('+n2(f.pRf)+'%)</td><td style="text-align:right">'+(f.retefuente?'-':'')+money(f.retefuente)+'</td></tr>'+
    '<tr><td>ReteICA ('+n2(f.pRi)+'%)</td><td style="text-align:right">'+(f.reteica?'-':'')+money(f.reteica)+'</td></tr>'+
    '<tr style="font-weight:800;font-size:14px"><td>Neto a pagar</td><td style="text-align:right">'+money(f.pagar)+'</td></tr>'+
    '</tbody></table></div>'+
    '<div style="margin-top:18px"><div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#5A615A;margin-bottom:5px">Anexo — relación de vales</div>'+
    '<div class="tw"><table><tbody>'+anx+'</tbody></table></div></div></div>';
}

/* ===================== ADMIN: ajustes ===================== */
let subA='conexion';
function vAjustes(){
  const c=el('div',{class:'stack'});
  c.appendChild(ph('Ajustes',''));
  const tabs=el('div',{class:'row'});
  [['conexion','Conexión'],['empresa','Empresa'],['clientes','Clientes'],['obras','Obras'],['volquetas','Volquetas'],['conductores','Conductores']].forEach(([k,l])=>{
    const b=el('button',{class:'btn sm '+(k===subA?'acc':'sec'),type:'button'},l);
    b.onclick=()=>{subA=k;render()};tabs.appendChild(b)});
  c.appendChild(tabs);
  if(subA==='conexion')c.appendChild(panelConexion());
  else if(subA==='empresa')c.appendChild(panelEmpresa());
  else c.appendChild(panelMaestro(subA));
  const out=el('button',{class:'btn sec',type:'button'},'Salir del modo administrador');
  out.onclick=salirDeRol;c.appendChild(out);
  return c;
}
function panelConexion(){
  const d=el('div',{class:'card'});
  d.innerHTML='<h3>Conexión con los conductores</h3><div class="pad stack">'+
    '<p style="margin:0;color:var(--muted);font-size:13px">Para que los conductores registren viajes desde su celular, la app necesita una base de datos en línea (Firebase Realtime Database, gratis). Pega aquí la dirección que te da Firebase.</p>'+
    fld('Dirección de la base de datos','<input id="xUrl" placeholder="https://tuproyecto-default-rtdb.firebaseio.com" value="'+esc(S.cfg.syncUrl||'')+'">')+
    fld('Código de tu empresa','<input id="xEmp" placeholder="mivolquetera" value="'+esc(S.cfg.empresaId||'')+'">')+
    fld('Clave secreta (opcional)','<input id="xKey" value="'+esc(S.cfg.authKey||'')+'">')+
    '<div class="row"><button class="btn acc" id="xOk">Guardar y probar</button><button class="btn sec" id="xSync">Sincronizar ahora</button></div>'+
    '<div id="xEst"></div>'+
    '<hr style="border:0;border-top:1px solid var(--line);margin:4px 0">'+
    '<div><div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">Código para los conductores</div>'+
    '<textarea id="xCod" readonly style="margin-top:5px;font-family:var(--mono);font-size:11px"></textarea>'+
    '<div class="row" style="margin-top:8px"><button class="btn sm acc" id="xCopy">Copiar código</button>'+
    '<span style="font-size:12.5px;color:var(--muted)">Envíaselo por WhatsApp. Ellos lo pegan al abrir la app.</span></div></div>'+
    (yaInstalada()?'':'<div><button class="btn sec" id="xInst" type="button">Instalar la app en este dispositivo</button></div>')+
    '<hr style="border:0;border-top:1px solid var(--line);margin:4px 0">'+
    '<div class="row"><div><div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">Versión instalada</div>'+
    '<b style="font-family:var(--disp);font-size:17px">'+VERSION+'</b> <span style="color:var(--muted);font-size:12px">· '+FECHA_VERSION+'</span></div>'+
    '<span class="spacer"></span><button class="btn sm sec" id="xUpd" type="button">Buscar actualización</button></div>'+
    '<label class="f" style="flex-direction:row;align-items:center;gap:9px"><input type="checkbox" id="xVer" style="width:auto"'+(S.cfg.verPagoConductor?' checked':'')+'> <span style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink)">Mostrar a cada conductor su liquidación</span></label>'+
    '</div>';
  const est=$('#xEst',d);
  const pintar=()=>{
    $('#xCod',d).value=conectado()?codigoConexion():'Guarda primero la dirección y el código de empresa.';
    est.innerHTML=!conectado()?'<div class="note">Sin conexión: la app funciona solo en este equipo.</div>':
      ultimoError?'<div class="note bad">No se pudo conectar: '+esc(ultimoError)+'</div>':
      '<div class="note" style="background:var(--ok-soft);border-color:var(--ok);color:var(--ok)">Conectado. '+S.viajes.length+' viajes sincronizados.</div>';
  };
  pintar();
  $('#xOk',d).onclick=async()=>{
    S.cfg.syncUrl=$('#xUrl',d).value.trim().replace(/\/+$/,'');
    S.cfg.empresaId=$('#xEmp',d).value.trim().replace(/[^A-Za-z0-9_-]/g,'')||'empresa';
    S.cfg.authKey=$('#xKey',d).value.trim();
    await guardarCfg();await sincronizar();pintar();pintarSync();
    toast(ultimoError?'No se pudo conectar':'Conexión lista');
  };
  $('#xSync',d).onclick=async()=>{toast('Sincronizando…');await sincronizar(true)};
  $('#xCopy',d).onclick=async()=>{
    const t=$('#xCod',d).value;
    try{await navigator.clipboard.writeText(t);toast('Código copiado')}
    catch(e){$('#xCod',d).select();toast('Selecciona y copia el código')}
  };
  const bi=$('#xInst',d);if(bi)bi.onclick=lanzarInstalacion;
  $('#xUpd',d).onclick=buscarActualizacion;
  $('#xVer',d).onchange=async e=>{S.cfg.verPagoConductor=e.target.checked;await guardarCfg();toast('Guardado')};
  return d;
}
function panelEmpresa(){
  const e=S.cfg.empresa||{},d=el('div',{class:'card'});
  d.innerHTML='<h3>Datos de la empresa y facturación</h3><div class="pad"><div class="gf">'+
    fld('Razón social','<input id="eN" value="'+esc(e.nombre||'')+'">')+
    fld('NIT','<input id="eI" value="'+esc(e.nit||'')+'">')+
    fld('Teléfono','<input id="eT" value="'+esc(e.telefono||'')+'">')+
    fld('Dirección','<input id="eD" value="'+esc(e.direccion||'')+'">')+
    fld('Ciudad','<input id="eC" value="'+esc(e.ciudad||'')+'">')+
    fld('Prefijo','<input id="eP" value="'+esc(S.cfg.prefijo||'CC-')+'">')+
    fld('Próximo consecutivo','<input type="number" id="eK" min="1" value="'+(S.cfg.consecutivo||1)+'">')+
    fld('IVA %','<input type="number" id="eIva" step="1" min="0" value="'+(S.cfg.iva||0)+'">')+
    fld('Retefuente %','<input type="number" id="eRf" step="0.1" min="0" value="'+(S.cfg.retefuente||0)+'">')+
    fld('ReteICA %','<input type="number" id="eRi" step="0.001" min="0" value="'+(S.cfg.reteica||0)+'">')+
    '</div><p style="color:var(--muted);font-size:12.5px">El transporte de carga suele tener retención en la fuente del 1%; el IVA depende del régimen. Confírmalo con tu contador.</p>'+
    '<button class="btn acc" id="eOk">Guardar</button></div>';
  $('#eOk',d).onclick=async()=>{
    S.cfg.empresa={nombre:$('#eN',d).value.trim(),nit:$('#eI',d).value.trim(),telefono:$('#eT',d).value.trim(),
      direccion:$('#eD',d).value.trim(),ciudad:$('#eC',d).value.trim()};
    S.cfg.prefijo=$('#eP',d).value.trim()||'CC-';S.cfg.consecutivo=+$('#eK',d).value||1;
    S.cfg.iva=+$('#eIva',d).value||0;S.cfg.retefuente=+$('#eRf',d).value||0;S.cfg.reteica=+$('#eRi',d).value||0;
    await guardarCfg();render();toast('Guardado');
  };
  return d;
}
const SCH={
  clientes:{t:'Clientes',sing:'cliente',f:[{k:'nombre',l:'Razón social',req:1},{k:'nit',l:'NIT'},{k:'contacto',l:'Contacto'},{k:'telefono',l:'Teléfono'},{k:'direccion',l:'Dirección'}],main:'nombre',sub:o=>o.nit||''},
  obras:{t:'Obras y tarifas',sing:'obra',f:[{k:'nombre',l:'Nombre de la obra',req:1},{k:'clienteId',l:'Cliente',type:'ref',src:'clientes',req:1},
    {k:'origen',l:'Punto de cargue'},{k:'destino',l:'Escombrera / destino'},
    {k:'valorViaje',l:'Tarifa fija por viaje',type:'num'},{k:'valorM3',l:'Tarifa por m³',type:'num'},{k:'activa',l:'Activa',type:'bool',def:true}],
    main:'nombre',sub:o=>nomCli(o.clienteId)+' · '+money(o.valorViaje)+' + '+money(o.valorM3)+'/m³'},
  volquetas:{t:'Volquetas',sing:'volqueta',f:[{k:'placa',l:'Placa',req:1},{k:'capacidad',l:'Capacidad (m³)',type:'num'},{k:'marca',l:'Marca'},
    {k:'tipo',l:'Vinculación',type:'opt',opts:['Propia','Tercero'],def:'Propia'},{k:'propietario',l:'Propietario'},
    {k:'porcTercero',l:'% para el tercero',type:'num'},{k:'activa',l:'Activa',type:'bool',def:true}],
    main:'placa',sub:o=>(o.tipo||'Propia')+(o.capacidad?' · '+n2(o.capacidad)+' m³':'')},
  conductores:{t:'Conductores',sing:'conductor',f:[{k:'nombre',l:'Nombre',req:1},{k:'usuario',l:'Usuario para entrar'},{k:'doc',l:'Cédula'},{k:'telefono',l:'Teléfono'},
    {k:'tipoPago',l:'Forma de pago',type:'opt',opts:['Por viaje','Porcentaje'],def:'Por viaje'},
    {k:'valorViaje',l:'Pago por viaje',type:'num'},{k:'porcentaje',l:'% sobre el flete',type:'num'},{k:'activo',l:'Activo',type:'bool',def:true}],
    main:'nombre',sub:o=>(o.tipoPago==='Porcentaje'?(+o.porcentaje||0)+'% del flete':money(o.valorViaje)+' por viaje')+
      (o.usuario&&o.clave?'  ·  entra como '+o.usuario:'  ·  sin acceso a la app')}
};
function panelMaestro(ent){
  const s=SCH[ent],arr=S.mae[ent]||[];
  const d=el('div',{class:'card'});
  const h=el('h3');h.innerHTML=esc(s.t)+'<span class="spacer" style="margin-left:auto"></span>';
  const add=el('button',{class:'btn sm acc',type:'button'},'+ Nuevo');
  add.onclick=()=>formMaestro(ent);h.appendChild(add);d.appendChild(h);
  const l=el('div',{class:'stack',style:'padding:12px'});
  if(!arr.length)l.appendChild(el('div',{class:'empty'},'Todavía no hay '+s.t.toLowerCase()+'.'));
  arr.forEach(o=>{
    const it=el('div',{class:'item'});
    it.innerHTML='<div class="m"><div class="t">'+esc(o[s.main]||'—')+'</div><div class="d">'+esc(s.sub(o))+'</div></div>';
    it.style.cursor='pointer';it.onclick=()=>formMaestro(ent,o);
    l.appendChild(it);
  });
  d.appendChild(l);return d;
}
function formMaestro(ent,it){
  const s=SCH[ent];it=it||{};const b=el('div');
  let h='<div class="gf">';
  for(const f of s.f){
    let inner='';
    if(f.type==='ref')inner='<select id="m_'+f.k+'">'+(S.mae[f.src]||[]).map(o=>'<option value="'+o.id+'"'+(o.id===it[f.k]?' selected':'')+'>'+esc(o.nombre||o.placa)+'</option>').join('')+'</select>';
    else if(f.type==='opt')inner='<select id="m_'+f.k+'">'+f.opts.map(o=>'<option'+(o===(it[f.k]||f.def)?' selected':'')+'>'+o+'</option>').join('')+'</select>';
    else if(f.type==='bool')inner='<span style="display:flex;align-items:center;gap:8px;height:40px"><input type="checkbox" id="m_'+f.k+'" style="width:auto"'+((it[f.k]!==undefined?it[f.k]:f.def)!==false?' checked':'')+'> Sí</span>';
    else if(f.type==='num')inner='<input type="number" inputmode="decimal" id="m_'+f.k+'" step="any" min="0" value="'+(it[f.k]!=null?it[f.k]:'')+'">';
    else inner='<input id="m_'+f.k+'" value="'+esc(it[f.k]||'')+'">';
    h+=fld(f.l,inner);
  }
  h+='</div>';
  if(ent==='conductores')h+='<div class="card" style="margin-top:14px"><h3>Acceso a la app</h3><div class="pad" id="acc"></div></div>';
  h+='<div class="row" style="margin-top:14px"><button class="btn acc" id="mOk" style="flex:1">Guardar</button><button class="btn sec" id="mC">Cancelar</button>'+
    (it.id?'<button class="btn bad" id="mD">Eliminar</button>':'')+'</div>';
  b.innerHTML=h;

  // credenciales del conductor: se generan aquí y se guardan con el botón Guardar
  let clave=it.clave||'', claveSal=it.claveSal||'', claveVisible='';
  if(ent==='conductores'){
    const pintarAcc=()=>{
      const z=$('#acc',b);
      const usr=($('#m_usuario',b).value||'').trim();
      let x='';
      if(claveVisible){
        x='<div class="note"><b>Clave nueva:</b> <span class="mono" style="font-size:16px">'+esc(claveVisible)+'</span><br>'+
          'Anótala o cópiala ahora: después ya no se puede ver, solo generar otra.</div>'+
          '<div class="row" style="margin-top:10px"><button class="btn sm acc" id="accCopy" type="button">Copiar mensaje para el conductor</button></div>';
      }else{
        x='<p style="margin:0 0 10px;color:var(--muted);font-size:13px">'+
          (clave?'Este conductor entra con el usuario <b>'+esc(usr||it.usuario||'—')+'</b> y su clave.'
                :'Todavía no tiene clave, así que no puede entrar a la app.')+'</p>';
      }
      x+='<div class="row" style="margin-top:8px">'+
         '<button class="btn sm sec" id="accGen" type="button">'+(clave?'Generar clave nueva':'Crear usuario y clave')+'</button>'+
         (clave?'<button class="btn sm bad" id="accDel" type="button">Quitar acceso</button>':'')+'</div>';
      z.innerHTML=x;
      const g=$('#accGen',z);
      g.onclick=async()=>{
        let u=($('#m_usuario',b).value||'').trim();
        if(!u){
          u=normUsr(($('#m_nombre',b).value||'').split(' ')[0]).replace(/[^a-z0-9]/g,'');
          $('#m_usuario',b).value=u;
        }
        if(!u){toast('Escribe primero el nombre o el usuario');return}
        const otro=(S.mae.conductores||[]).find(c=>c.id!==it.id&&normUsr(c.usuario)===normUsr(u));
        if(otro){toast('Ese usuario ya lo tiene '+otro.nombre);return}
        claveVisible=claveNueva();claveSal=salAlAzar();clave=await huella(claveSal,claveVisible);
        pintarAcc();
      };
      const d=$('#accDel',z);
      if(d)d.onclick=()=>{clave='';claveSal='';claveVisible='';pintarAcc()};
      const cp=$('#accCopy',z);
      if(cp)cp.onclick=async()=>{
        const msg='App de volquetas\nUsuario: '+(($('#m_usuario',b).value||'').trim())+'\nClave: '+claveVisible;
        try{await navigator.clipboard.writeText(msg);toast('Mensaje copiado')}catch(e){toast('Anota: '+claveVisible)}
      };
    };
    pintarAcc();
  }

  $('#mC',b).onclick=cerrar;
  const dl=$('#mD',b);
  if(dl)dl.onclick=async()=>{S.mae[ent]=S.mae[ent].filter(x=>x.id!==it.id);await guardarMae();cerrar();render();toast('Eliminado')};
  $('#mOk',b).onclick=async()=>{
    const o=Object.assign({},it,{id:it.id||uid(ent[0])});
    for(const f of s.f){const n=$('#m_'+f.k,b);
      o[f.k]=f.type==='bool'?n.checked:f.type==='num'?(n.value===''?null:+n.value):n.value.trim()}
    const req=s.f.find(f=>f.req&&!o[f.k]);
    if(req){toast('Falta: '+req.l);return}
    if(ent==='conductores'){
      o.usuario=normUsr(o.usuario);
      o.clave=clave;o.claveSal=claveSal;
      if(o.clave&&!o.usuario){toast('Escribe el usuario con el que va a entrar');return}
      const otro=(S.mae.conductores||[]).find(c=>c.id!==o.id&&o.usuario&&normUsr(c.usuario)===o.usuario);
      if(otro){toast('Ese usuario ya lo tiene '+otro.nombre);return}
    }
    const arr=S.mae[ent]||(S.mae[ent]=[]);
    const i=arr.findIndex(x=>x.id===o.id);
    if(i<0)arr.push(o);else arr[i]=o;
    await guardarMae();cerrar();render();toast('Guardado');
  };
  abrir((it.id?'Editar ':'Nuevo ')+s.sing,b);
}

/* ===================== actualizaciones de la app ===================== */
let regSW=null, recargando=false;
async function vigilarActualizaciones(){
  if(!('serviceWorker' in navigator))return;
  try{
    regSW=await navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(recargando)return;recargando=true;location.reload();
    });
    regSW.addEventListener('updatefound',()=>{
      const w=regSW.installing;if(!w)return;
      w.addEventListener('statechange',()=>{
        if(w.state==='installed'&&navigator.serviceWorker.controller){
          toast('Hay una versión nueva, actualizando…');
          w.postMessage({t:'actualizar'});
        }
      });
    });
    // Al volver a abrir la app se revisa si la oficina publicó una versión nueva.
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'&&regSW)regSW.update().catch(()=>{});
    });
    setTimeout(()=>{if(regSW)regSW.update().catch(()=>{})},3000);
  }catch(e){}
}
async function buscarActualizacion(){
  toast('Buscando versión nueva…');
  try{
    if(regSW){await regSW.update();
      if(regSW.waiting){regSW.waiting.postMessage({t:'actualizar'});return}}
    const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)));
  }catch(e){}
  setTimeout(()=>location.reload(),600);
}

/* ===================== arranque ===================== */
async function boot(){
  mesActual();
  S.cfg=Object.assign({},CFG0,(await dbGet('kv','config'))||{});
  S.cfg.empresa=Object.assign({},CFG0.empresa,S.cfg.empresa||{});
  S.mae=Object.assign({},MAE0,(await dbGet('kv','maestros'))||{});
  ['clientes','obras','volquetas','conductores'].forEach(k=>{if(!Array.isArray(S.mae[k]))S.mae[k]=[]});
  S.viajes=await dbAll('viajes');S.costos=await dbAll('costos');S.facturas=await dbAll('facturas');
  // Si la oficina ya creó credenciales, el conductor tiene que entrar con las suyas.
  if(!S.cfg.rol)pintarGate(conectado()&&hayCredenciales()&&!S.cfg.pin?'con2':'rol');
  else if(S.cfg.rol==='conductor'&&hayCredenciales()&&!S.cfg.auth)pintarGate('con2');
  else iniciar();
  pintarSync();
  $('#instalaOk').onclick=lanzarInstalacion;
  $('#instalaNo').onclick=()=>{instalaOculto=true;pintarInstalar()};
  pintarInstalar();
  vigilarActualizaciones();
}
boot();
})();
