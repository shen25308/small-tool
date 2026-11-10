'use strict';
const host=(op,fields={})=>window.webkit.messageHandlers.edge.postMessage({op,...fields});
const mount=document.getElementById('edgeResult');
const newer=document.getElementById('newer');
const back=document.getElementById('edgeBack');
let latest=null, current=null, mode='preview';

function sizeTo(next){
  if(next===mode)return;
  mode=next;
  back.hidden=next==='preview';
  back.textContent=next==='original'?'Back to summary':'Hide details';
  host('resize',{mode:next});
}
function paint(note) {
  current=note;
  const card=ResultUI.card(note,{edge:true,preview:true,
    read:n=>host('read',{key:n.id,channel:n.channel}),
    expanded:open=>sizeTo(open?'original':'details'),
    previewChanged:open=>{
      sizeTo(open?'details':'preview');
      if(!open && latest && latest.id!==current.id)paint(latest);
    }
  });
  mount.replaceChildren(card);mount.scrollTop=0;newer.hidden=true;
}
window.forgetDisplayedResult=()=>{
  sizeTo('preview');
  current=null;latest=null;mount.replaceChildren();newer.hidden=true;ResultUI.retain(new Set());
};
window.setEdgeInbox=snapshot=>{
  latest=snapshot.items?.[0]||null;
  ResultUI.retain(new Set([latest?.id,current?.id]));
  if(mode!=='preview'){newer.hidden=!latest||latest.id===current?.id;return}
  if(!latest){
    current=null;
    const empty=document.createElement('p');empty.className='edge-empty';empty.textContent='Waiting for results…';
    mount.replaceChildren(empty);return;
  }
  if(current?.id!==latest.id)paint(latest);
  else mount.querySelector('article')?.classList.toggle('unread',!latest.read);
};
newer.onclick=()=>{sizeTo('preview');if(latest)paint(latest)};
back.onclick=()=>{
  if(mode==='original')document.getElementById('edgeExpand')?.click();
  else mount.querySelector('.result-preview')?.click();
};
document.getElementById('workspace').onclick=()=>host('workspace');
document.getElementById('history').onclick=()=>host('history');
host('ready');
