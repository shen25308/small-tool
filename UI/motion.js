'use strict';
/* Motion layer: springs, completion, sliding pills, glass morph, view zoom, marker magnetism.
   Every effect is skipped when Reduce Motion is on (html.rm, set by theme.js); state then changes instantly. */
(()=>{
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const reduce=()=>document.documentElement.classList.contains('rm');

/* Real spring physics -> CSS linear() easing (same model as SwiftUI .spring(response:dampingFraction:)) */
function spring(response=.45,damping=.72){
  const w=2*Math.PI/response,z=damping,wd=w*Math.sqrt(Math.max(1e-4,1-z*z));
  const x=t=>z<1?1-Math.exp(-z*w*t)*(Math.cos(wd*t)+z*w/wd*Math.sin(wd*t)):1-Math.exp(-w*t)*(1+w*t);
  let T=0;while(T<3&&!(Math.abs(1-x(T))<.001&&Math.abs(1-x(T+.05))<.001))T+=.01;   // settle time
  const n=48,pts=[];for(let i=0;i<=n;i++)pts.push(+x(T*i/n).toFixed(4));pts[n]=1;
  const ok=window.CSS&&CSS.supports&&CSS.supports('animation-timing-function','linear(0, 1)');
  return {easing:ok?`linear(${pts.join(',')})`:(damping<.7?'cubic-bezier(.34,1.56,.64,1)':'cubic-bezier(.34,1.2,.64,1)'),duration:Math.round(T*1000)};
}
const S={snappy:spring(.38,.68),smooth:spring(.5,.86),bouncy:spring(.45,.6),glass:spring(.42,.74)};
window.MotionTokens=S;

/* pointer position for the specular highlight */
document.addEventListener('pointermove',e=>{const g=e.target.closest&&e.target.closest('.btn,.fchip,.icon-btn,.seg button,.edge-zone,.tb-group button');if(!g)return;const r=g.getBoundingClientRect();g.style.setProperty('--mx',(e.clientX-r.left)+'px');g.style.setProperty('--my',(e.clientY-r.top)+'px')},{passive:true});
document.addEventListener('pointerdown',e=>{const g=e.target.closest&&e.target.closest('.btn,.fchip,.icon-btn,.seg button,.edge-zone,.tb-group button');if(!g)return;const r=g.getBoundingClientRect();g.style.setProperty('--mx',(e.clientX-r.left)+'px');g.style.setProperty('--my',(e.clientY-r.top)+'px')},{passive:true});

const M={};window.Motion=M;
const dense=!!$('#bandWrap');

/* ---------- sliding pills (filters, segmented control) ---------- */
let lastF=null;
M.pill=()=>{
  const f=$('#filters');if(!f)return;const on=f.querySelector('.fchip.on');
  f.querySelector('.fpill')?.remove();
  if(!on){lastF=null;f.classList.remove('pilled');return}
  const p=document.createElement('span');p.className='fpill';f.prepend(p);f.classList.add('pilled');
  const fr=f.getBoundingClientRect(),r=on.getBoundingClientRect();
  const to={x:r.left-fr.left,y:r.top-fr.top,w:r.width};
  p.style.cssText=`transform:translate(${to.x}px,${to.y}px);width:${to.w}px`;
  if(lastF&&!reduce()&&Math.abs(lastF.x-to.x)>1){
    const d=Math.sign(to.x-lastF.x);
    p.animate([{transform:`translate(${lastF.x}px,${to.y}px)`,width:lastF.w+'px'},
               {transform:`translate(${d>0?lastF.x+4:to.x-4}px,${to.y}px)`,width:Math.abs(to.x-lastF.x)*.55+Math.max(lastF.w,to.w)+'px',offset:.35},
               {transform:`translate(${to.x}px,${to.y}px)`,width:to.w+'px'}],{duration:S.snappy.duration+80,easing:S.snappy.easing});
  }
  lastF=to;
};
let lastS=null;
M.seg=()=>{
  const g=$('.seg.scale');if(!g)return;const on=g.querySelector('button.on');if(!on)return;
  let p=g.querySelector('.spill');if(!p){p=document.createElement('span');p.className='spill';g.prepend(p);g.classList.add('pilled')}
  const gr=g.getBoundingClientRect(),r=on.getBoundingClientRect();const to={x:r.left-gr.left,y:r.top-gr.top,w:r.width};
  p.style.transform=`translate(${to.x}px,${to.y}px)`;p.style.width=to.w+'px';
  if(lastS&&!reduce()&&lastS.x!==to.x)p.animate([{transform:`translate(${lastS.x}px,${to.y}px)`,width:lastS.w+'px'},{transform:`translate(${to.x}px,${to.y}px)`,width:to.w+'px'}],{duration:S.glass.duration,easing:S.glass.easing});
  lastS=to;
};

/* ---------- completion: draw-on + burst + star flies into the band ---------- */
const STAR='<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.5c.6 4.9 2.6 8.9 10.5 10.5-7.9 1.6-9.9 5.6-10.5 10.5C11.4 17.6 9.4 13.6 1.5 12 9.4 10.4 11.4 6.4 12 1.5z"/></svg>';
function burst(x,y){const b=document.createElement('span');b.className='burst';b.style.left=x+'px';b.style.top=y+'px';
  b.innerHTML='<span class="ring"></span>'+Array.from({length:8},(_,i)=>`<span class="p" style="--a:${i*45+22}deg"></span>`).join('');document.body.append(b);setTimeout(()=>b.remove(),800)}
function fly(x0,y0,x1,y1,done){
  const cx=(x0+x1)/2+(x1-x0)*.1,cy=Math.min(y0,y1)-90;
  const kf=(o,sc)=>{const k=[];for(let i=0;i<=20;i++){const t=i/20,u=1-t;const x=u*u*x0+2*u*t*cx+t*t*x1,y=u*u*y0+2*u*t*cy+t*t*y1;
    k.push({transform:`translate(${x}px,${y}px) rotate(${t*220}deg) scale(${sc*(.7+.6*Math.sin(Math.PI*t)-.3*t)})`,opacity:(t>.9?0:1)*o})}return k};
  // head + 4 ghosts = comet trail
  [0,1,2,3,4].forEach(g=>{const s=document.createElement('span');s.className='star'+(g?' ghost':'');s.innerHTML=STAR;document.body.append(s);
    const a=s.animate(kf(g?.5-g*.1:1,g?1-g*.15:1),{duration:720,easing:'cubic-bezier(.45,.05,.3,1)',delay:140+g*28,fill:'both'});
    a.onfinish=()=>{s.remove();if(!g){const l=document.createElement('span');l.className='land';l.style.left=x1+'px';l.style.top=y1+'px';document.body.append(l);setTimeout(()=>l.remove(),650);done&&done()}}});
}
M.complete=(r,ck)=>{
  const id=r.dataset.id,task=byId(id);
  r.classList.add('done');ck.setAttribute('aria-checked','true');
  if(reduce()){if(task){setTimeout(()=>A.complete(id),150)}return}
  r.classList.add('completing');
  const c=ck.getBoundingClientRect(),cx=c.left+c.width/2,cy=c.top+c.height/2;
  burst(cx,cy);
  const bw=$('#bw');let target=null;
  if(bw&&task&&task.day===st.day){const b=bw.getBoundingClientRect(),h=task.time??st.now;target=[b.left+(h-H0)/(H1-H0)*b.width,b.top+(task.time!=null?100:80)]}
  const commit=()=>{
    const h=r.offsetHeight;
    const a=r.animate([{height:h+'px',opacity:1,transform:'none'},{height:h+'px',opacity:.6,transform:'translateY(4px)',offset:.3},{height:'0px',opacity:0,transform:'translateY(10px)'}],{duration:360,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
    a.onfinish=()=>{if(task){M.freshTime=task.time;A.complete(id)}};
  };
  if(target)fly(cx,cy,target[0],target[1]);
  setTimeout(commit,900);
};

/* ---------- glass morph for popovers (cluster + quota) ---------- */
function morphOpen(pop,from,radius=18){
  const m=from.getBoundingClientRect(),pr=pop.getBoundingClientRect();
  const sx=Math.max(.06,m.width/pr.width),sy=Math.max(.06,m.height/pr.height);
  const tx=m.left+m.width/2-(pr.left+pr.width/2),ty=m.top+m.height/2-(pr.top+pr.height/2);
  pop.style.transformOrigin='50% 50%';
  pop.animate([{transform:`translate(${tx}px,${ty}px) scale(${sx},${sy})`,borderRadius:'999px',opacity:0,filter:'blur(6px)'},
               {opacity:1,filter:'blur(0px)',offset:.3},
               {transform:'none',borderRadius:radius+'px',opacity:1,filter:'blur(0px)'}],{duration:S.glass.duration,easing:S.glass.easing});
  [...pop.children].forEach((ch,i)=>ch.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:320,delay:90+i*35,easing:'cubic-bezier(.22,1,.36,1)',fill:'backwards'}));
}
function morphClose(pop,to,done){
  if(!to){done();return}
  const m=to.getBoundingClientRect(),pr=pop.getBoundingClientRect();
  const tx=m.left+m.width/2-(pr.left+pr.width/2),ty=m.top+m.height/2-(pr.top+pr.height/2);
  const a=pop.animate([{transform:'none',opacity:1,filter:'blur(0px)'},{transform:`translate(${tx}px,${ty}px) scale(${m.width/pr.width},${m.height/pr.height})`,borderRadius:'999px',opacity:0,filter:'blur(4px)'}],{duration:220,easing:'cubic-bezier(.4,0,1,1)'});
  a.onfinish=done;
}
if(dense&&typeof openCluster==='function'){
  const oc=window.openCluster;
  window.openCluster=function(i){
    const pop=$('#cpop'),open=!pop.classList.contains('hidden');
    if(i==null){
      if(open&&!reduce()&&!M.closing){const mk=$(`.bm[data-c="${st.cluster}"]`);M.closing=1;morphClose(pop,mk,()=>{M.closing=0;oc(null)})}
      else if(!M.closing)oc(null);
      return}
    oc(i);
    if(!reduce()){const mk=$(`.bm[data-c="${i}"]`);if(mk){morphOpen(pop,mk,18);mk.animate([{scale:1},{scale:1.35},{scale:1}],{duration:360,easing:S.bouncy.easing})}}
  };
}
/* quota popover */
const qp=$('#qpop');
if(qp){let was=qp.classList.contains('hidden');new MutationObserver(()=>{const hid=qp.classList.contains('hidden');if(was&&!hid&&!reduce()){
    const trig=qp.dataset.anchor?document.getElementById(qp.dataset.anchor):null;
    qp.style.transition='none';if(trig)morphOpen(qp,trig,22);requestAnimationFrame(()=>qp.style.transition='');
    qp.querySelectorAll('.bar i').forEach((b,i)=>b.animate([{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration:700,delay:140+i*60,easing:S.smooth.easing,fill:'backwards'}));
    qp.querySelectorAll('.bar i').forEach(b=>b.style.transformOrigin='left');
  }was=hid}).observe(qp,{attributes:true,attributeFilter:['class']})}

/* ---------- hooks after each render ---------- */
if(dense&&typeof render==='function'){
  const r0=window.render;
  window.render=function(){r0.apply(this,arguments);M.after()};
}
M.after=()=>{
  M.pill();M.seg();
  if(M.freshTime!=null&&$('#bw')){const W=$('#bw').clientWidth,x=(M.freshTime-H0)/(H1-H0)*W;
    $$('.bdone').forEach(d=>{if(Math.abs(parseFloat(d.style.left)-x)<1)d.classList.add('pop')});
    $$('.collapsed-row[data-expand="done"]').forEach(c=>c.classList.add('bump'));
    M.freshTime=null}
};

/* ---------- hover magnetism on band markers ---------- */
document.addEventListener('pointermove',e=>{
  const bw=e.target.closest&&e.target.closest('#bw');
  $$('.bm').forEach(m=>{if(!bw||reduce()){m.style.translate='';return}
    const r=m.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),d=Math.hypot(dx,dy),R=30;
    if(d<R){const k=(1-d/R)*5/Math.max(d,1);m.style.translate=`${dx*k}px ${dy*k}px`}else m.style.translate=''});
},{passive:true});

/* ---------- zoom day / 3-day / week with View Transitions + shared element ---------- */
const ORDER={day:0,'3':1,week:2};
document.addEventListener('click',e=>{
  if(!dense||M.inVT||!document.startViewTransition||reduce())return;
  const t=e.target.closest('[data-scale],.wday');if(!t||t.getAttribute('aria-disabled')==='true')return;
  const to=t.dataset.scale?ORDER[t.dataset.scale]:t.classList.contains('wday')?0:1,from=ORDER[st.scale];if(to===from)return;
  e.stopPropagation();e.preventDefault();
  document.documentElement.dataset.zoom=to>from?'out':'in';
  const bandEl=$('#bandWrap');
  // shared element: the clicked/today column <-> the day band
  if(t.classList.contains('wday')){bandEl.style.viewTransitionName='none';t.style.viewTransitionName='band'}
  M.inVT=true;
  const vt=document.startViewTransition(()=>{
    t.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    bandEl.style.viewTransitionName='';
    if(to>from&&from===0){const today=$('.wday.today');if(today){bandEl.style.viewTransitionName='none';today.style.viewTransitionName='band'}}
  });
  vt.finished.finally(()=>{M.inVT=false;bandEl.style.viewTransitionName='';$$('.wday').forEach(w=>w.style.viewTransitionName='')});
},true);

/* ---------- sidebar selection pill slides between rows ---------- */
document.addEventListener('click',e=>{
  const n=e.target.closest&&e.target.closest('.side .nav-row[data-nav]');if(!n||n.classList.contains('sel'))return;
  const old=$('.side .nav-row.sel');if(!old){n.classList.add('sel');return}
  const a=old.getBoundingClientRect(),b=n.getBoundingClientRect();old.classList.remove('sel');
  if(reduce()){n.classList.add('sel');return}
  const p=document.createElement('span');p.className='navpill';Object.assign(p.style,{left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px'});document.body.append(p);
  n.style.background='transparent';n.classList.add('sel');
  p.animate([{transform:`translateY(${a.top-b.top}px)`},{transform:'none'}],{duration:S.glass.duration,easing:S.glass.easing}).onfinish=()=>{p.remove();n.style.background=''};
},true);

if(dense&&typeof render==='function')M.after();
})();
