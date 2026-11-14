'use strict';
/* The only link to the Swift host. native(op, fields) resolves with the host's reply or rejects with its message.
   The web view keeps no storage of its own, so preferences also travel through here (UserDefaults). */
const native=(()=>{
  const waiting=new Map();
  window.hostReply=(id,ok,value)=>{
    const call=waiting.get(id);if(!call)return;
    waiting.delete(id);
    if(ok)call.resolve(value);else call.reject(Error(String(value)));
  };
  return (op,fields={})=>{
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      waiting.set(id,{resolve,reject});
      try{window.webkit.messageHandlers.host.postMessage({id,op,...fields})}
      catch(error){waiting.delete(id);reject(error)}
    });
  };
})();

const Prefs=(()=>{
  let values={};
  return {
    async load(){try{values=await native('prefs')||{}}catch(e){values={}}return values},
    get:(key,fallback=null)=>key in values?values[key]:fallback,
    set(key,value){
      if(values[key]===value)return;
      if(value==null)delete values[key];else values[key]=value;
      native('prefs',{set:{[key]:value}}).catch(()=>{});
    },
  };
})();
