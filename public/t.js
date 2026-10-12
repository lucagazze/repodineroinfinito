/* Seguimiento: view, heartbeat (20s a la vista), cta_click y leave a /api/ev. Checkout en otro dominio: ?vid=&sid=
   Clarity de la landing: identify(visitor_id) + tags vid/step, para encontrar la grabación desde el panel. */
(function(W,D,L,N){
var s=D.currentScript||D.querySelector('script[src$="/t.js"]'),d=(s&&s.dataset)||{};
function r(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36)}
function id(n,k){try{var st=W[n],v=st.getItem(k);if(!v)st.setItem(k,v=r());return v}catch(e){return r()}}
var vid=id("localStorage","algd_vid"),sid=id("sessionStorage","algd_sid"),pv=r(),t0=Date.now(),last=0,gone=0,utm={},n=0;
new URLSearchParams(L.search).forEach(function(v,k){if(/^utm_|^fbclid$/.test(k)&&n++<8)utm[k]=v.slice(0,200)});
/* ¿Hay una persona? Primer toque, puntero, rueda o tecla (el scroll solo no: una página lo dispara sola al cargar): queda anotado en la pestaña (h=1 en cada evento). Sin eso, el panel la trata como posible robot. */
var hum=0;try{hum=sessionStorage.getItem("algd_h")=="1"?1:0}catch(e){}
function human(){if(hum)return;hum=1;try{sessionStorage.setItem("algd_h","1")}catch(e){}}
["pointerdown","pointermove","touchstart","keydown","wheel"].forEach(function(t){W.addEventListener(t,human,{passive:true,capture:true})});
try{var C=W.clarity=W.clarity||function(){(C.q=C.q||[]).push(arguments)};C("identify",vid,sid,"landing",vid);C("set","vid",vid);C("set","step","landing");if(d.funnel)C("set","funnel",d.funnel)}catch(e){}
function send(ev,data){
  var b={page:"landing",event:ev,vid:vid,sid:sid,pv:pv,path:L.pathname.slice(0,300)};
  if(d.store)b.store=d.store;
  if(d.funnel)b.funnel=d.funnel;
  if(ev!="heartbeat"&&ev!="leave")b.utm=utm;
  if(ev=="view"&&D.referrer)b.ref=D.referrer.slice(0,500);
  var dd=data||{};dd.hv=1;if(hum)dd.h=1;b.data=dd;
  if(N.webdriver)b.wd=1;
  var j=JSON.stringify(b);
  try{if(N.sendBeacon&&N.sendBeacon("/api/ev",j))return}catch(e){}
  try{fetch("/api/ev",{method:"POST",body:j,keepalive:true})["catch"](function(){})}catch(e){}
}
function beat(ev){last=Date.now();gone=0;send(ev)}
beat("view");
setInterval(function(){if(D.visibilityState=="visible")beat("heartbeat")},20000);
D.addEventListener("visibilitychange",function(){if(D.visibilityState=="visible"&&Date.now()-last>10000)beat("heartbeat")});
W.addEventListener("pagehide",function(){if(!gone){gone=1;send("leave",{s:Math.round((Date.now()-t0)/1000)})}});
W.addEventListener("pageshow",function(e){if(e.persisted)beat("view")});
D.addEventListener("click",function(e){
  var a=e.target&&e.target.closest&&e.target.closest("a[data-checkout]");
  if(!a)return;
  send("cta_click",{i:[].indexOf.call(D.querySelectorAll("a[data-checkout]"),a),t:(a.textContent||"").trim().slice(0,60)});
  try{var u=new URL(a.href);if(u.host!=L.host){u.searchParams.set("vid",vid);u.searchParams.set("sid",sid);a.href=u.href}}catch(e){}
},true);
/* Grabación para ver en vivo desde el panel (rrweb → /api/rec): después de cargar y con la página quieta, campos y emails tapados. */
function rec(){try{
  if(N.webdriver||/bot\b|bot\/|crawler|spider|HeadlessChrome|headless|Lighthouse|Playwright|Puppeteer/i.test(N.userAgent))return;
  var q=new URLSearchParams(L.search);if(q.get("preview")=="1"||q.has("norec"))return;
  var w=(d.store?"&store="+encodeURIComponent(d.store):"")+(d.funnel?"&funnel="+encodeURIComponent(d.funnel):"");
  fetch("/api/rec?c=1"+w,{cache:"no-store"}).then(function(x){return x.ok?x.json():null}).then(function(c){
    if(!c||!c.on)return;
    /* import() dentro de Function: un navegador viejo no lo entiende y no tiene que romper este archivo */
    return new Function("u","return import(u)")("https://cdn.jsdelivr.net/npm/@rrweb/record@2.1.7/+esm").then(function(m){start(m.record,w)});
  })["catch"](function(){});
}catch(e){}}
function start(record,w){
  var buf=[],seq=0,stop,iv,E=/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  function end(){try{stop&&stop()}catch(e){}clearInterval(iv);buf=[]}
  function url(z){return "/api/rec?s="+sid+"&v="+vid+"&p="+pv+"&q="+(seq++)+"&pg=landing&z="+z+"&path="+encodeURIComponent(L.pathname.slice(0,200))+w}
  function chk(x){if(x&&(x.status==409||x.status==403))end()}
  function flush(fin){
    if(!buf.length)return;var j=JSON.stringify(buf);buf=[];
    if(fin||!W.CompressionStream){
      if(j.length<60000&&N.sendBeacon&&N.sendBeacon(url(0),new Blob([j],{type:"text/plain"})))return;
      try{fetch(url(0),{method:"POST",body:j,keepalive:j.length<60000}).then(chk)["catch"](function(){})}catch(e){}return}
    new Response(new Blob([j]).stream().pipeThrough(new CompressionStream("gzip"))).blob()
      .then(function(z){return fetch(url(1),{method:"POST",body:z,keepalive:z.size<60000})}).then(chk)["catch"](function(){});
  }
  stop=record({emit:function(e){buf.push(e);if(buf.length>500)flush()},maskAllInputs:true,maskTextSelector:"*",
    maskTextFn:function(t){return t.indexOf("@")<0?t:t.replace(E,function(m){return m.replace(/[^@.]/g,"*")})},
    sampling:{mousemove:80,scroll:150,media:800,input:"last"},slimDOMOptions:"all",recordCanvas:false,collectFonts:false});
  setTimeout(flush,1000);iv=setInterval(flush,3000);
  D.addEventListener("visibilitychange",function(){if(D.visibilityState=="hidden")flush()});
  W.addEventListener("pagehide",function(){flush(1)});
}
function idle(){if(W.requestIdleCallback)W.requestIdleCallback(rec,{timeout:4000});else setTimeout(rec,1500)}
if(D.readyState=="complete")idle();else W.addEventListener("load",idle);
})(window,document,location,navigator);
