'use strict';
/* Time-of-day sky model shared by the time band, the mini band and the results panel.
   Sunrise and sunset are computed on this Mac from the date and a representative point for the
   system time zone (NOAA solar equations). No location permission and no network are involved. */
window.Sky=(()=>{
  // The palettes were drawn for a day that runs 06:35–16:52. Other days are stretched onto it.
  const REF_RISE=6+35/60, REF_SET=16+52/60;
  let RISE=REF_RISE, SET=REF_SET;
  // [hour, top, bottom, accent]. The accent must keep white text readable all day.
  const PAL={
    pearl:{sun:'#fff1c9',K:[
      [0,'#1e2650','#2c3563','#8a8cff'],[5.6,'#2f3a6e','#5f6a9e','#7f7ff0'],[6.6,'#dddcf4','#f4ecf1','#6a5ae0'],
      [8.5,'#d6e5f9','#f2f6fc','#0a7aff'],[12,'#c4dcfb','#ebf4fe','#0a7aff'],[15.6,'#d4e0f4','#f2f2f5','#2f72f0'],
      [16.6,'#dcdcf2','#f5efee','#5a5ad8'],[17.45,'#93b2e2','#cfdcf2','#2f6fd6'],[18.1,'#4c5b98','#7d86c0','#6a6cf0'],
      [20,'#232c5a','#343f70','#8a8cff'],[24,'#1e2650','#2c3563','#8a8cff']]},
    rose:{sun:'#ffd7e6',K:[
      [0,'#232a52','#323a66','#7f80ea'],[5.6,'#343c70','#6d6aa3','#8a7fe6'],[6.6,'#dcd9f3','#f7dae6','#c2508a'],
      [8.5,'#d8e5f9','#f1f5fc','#0a7aff'],[12,'#c3dcfb','#eaf3fe','#0a7aff'],[15.6,'#d6dff5','#f2e8f3','#3f6ee6'],
      [16.6,'#dcd3f3','#f6d9e8','#b84f8e'],[17.45,'#aeaadf','#efc7dc','#9154c6'],[18.1,'#5e5f9f','#9b8cc4','#7464ea'],
      [20,'#2c3566','#3f4a7d','#7f80ea'],[24,'#232a52','#323a66','#7f80ea']]},
    pastel:{sun:'#fff3c4',K:[
      [0,'#1b2442','#26315a','#6e8cff'],[5.6,'#2a3a64','#4f6a8f','#3f8fc8'],[6.6,'#d2ebe8','#ebf7f1','#178f7c'],
      [8.5,'#d4e8f8','#f0f6fb','#0a7aff'],[12,'#c2dcfa','#eaf3fe','#0a7aff'],[15.6,'#cfdcf5','#e9eefb','#3d6fe6'],
      [16.6,'#cbd1f4','#e5e5fa','#5156d0'],[17.45,'#a2aae2','#cbc8ef','#5a54c8'],[18.1,'#4a5791','#7b86bd','#6a70e8'],
      [20,'#1f2a52','#2f3b6a','#6e8cff'],[24,'#1b2442','#26315a','#6e8cff']]},
    mono:{sun:'#ffe6a0',K:[
      [0,'#1f2a44','#2a3756','#6f93ff'],[5.6,'#2f3d5e','#4c5d80','#5b85ee'],[6.6,'#d6e1f2','#edf2f9','#2f6fe0'],
      [12,'#c6dcf7','#ecf4fd','#0a7aff'],[16.6,'#cad6ec','#e7edf7','#2f62d6'],[17.45,'#97a9cc','#c3cfe4','#3b64cc'],
      [18.1,'#56688f','#8293b5','#5b82f0'],[20,'#232e4a','#33405e','#6f93ff'],[24,'#1f2a44','#2a3756','#6f93ff']]},
  };
  let cur='pearl', K=PAL[cur].K;
  function setPalette(k){if(!PAL[k])return false;cur=k;K=PAL[k].K;return true}

  /* ---------- sunrise / sunset ---------- */
  // A representative point per time zone: [latitude, longitude].
  const ZONES={
    'America/Los_Angeles':[34.05,-118.24],'America/Vancouver':[49.28,-123.12],'America/Denver':[39.74,-104.99],'America/Phoenix':[33.45,-112.07],
    'America/Chicago':[41.88,-87.63],'America/Mexico_City':[19.43,-99.13],'America/New_York':[40.71,-74.01],'America/Toronto':[43.65,-79.38],
    'America/Bogota':[4.71,-74.07],'America/Lima':[-12.05,-77.04],'America/Sao_Paulo':[-23.55,-46.63],'America/Argentina/Buenos_Aires':[-34.6,-58.38],
    'America/Santiago':[-33.45,-70.67],'America/Anchorage':[61.22,-149.9],'Pacific/Honolulu':[21.31,-157.86],
    'Europe/London':[51.51,-0.13],'Europe/Dublin':[53.35,-6.26],'Europe/Lisbon':[38.72,-9.14],'Europe/Madrid':[40.42,-3.7],'Europe/Paris':[48.86,2.35],
    'Europe/Amsterdam':[52.37,4.9],'Europe/Berlin':[52.52,13.4],'Europe/Zurich':[47.38,8.54],'Europe/Rome':[41.9,12.5],'Europe/Stockholm':[59.33,18.07],
    'Europe/Warsaw':[52.23,21.01],'Europe/Athens':[37.98,23.73],'Europe/Helsinki':[60.17,24.94],'Europe/Istanbul':[41.01,28.98],'Europe/Moscow':[55.76,37.62],
    'Africa/Cairo':[30.04,31.24],'Africa/Lagos':[6.52,3.38],'Africa/Johannesburg':[-26.2,28.05],'Africa/Nairobi':[-1.29,36.82],
    'Asia/Dubai':[25.2,55.27],'Asia/Tehran':[35.69,51.39],'Asia/Karachi':[24.86,67.01],'Asia/Kolkata':[19.08,72.88],'Asia/Dhaka':[23.81,90.41],
    'Asia/Bangkok':[13.76,100.5],'Asia/Jakarta':[-6.21,106.85],'Asia/Singapore':[1.35,103.82],'Asia/Hong_Kong':[22.32,114.17],'Asia/Shanghai':[31.23,121.47],
    'Asia/Taipei':[25.03,121.57],'Asia/Manila':[14.6,120.98],'Asia/Seoul':[37.57,126.98],'Asia/Tokyo':[35.68,139.69],
    'Australia/Perth':[-31.95,115.86],'Australia/Adelaide':[-34.93,138.6],'Australia/Brisbane':[-27.47,153.03],'Australia/Sydney':[-33.87,151.21],
    'Australia/Melbourne':[-37.81,144.96],'Pacific/Auckland':[-36.85,174.76],
  };
  function place(tz,date){
    if(ZONES[tz])return ZONES[tz];
    // Unknown zone: the standard UTC offset gives the longitude; assume a mid latitude.
    const y=date.getFullYear(),jan=new Date(y,0,1).getTimezoneOffset(),jul=new Date(y,6,1).getTimezoneOffset();
    const south=/^(Australia|Antarctica)\//.test(tz||'')||jul>jan;
    return [south?-34:38,-Math.max(jan,jul)/4];
  }
  function solar(date,lat,lon){
    const day=Math.floor((Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-Date.UTC(date.getFullYear(),0,0))/864e5);
    const g=2*Math.PI/365*(day-1), rad=Math.PI/180;
    const eq=229.18*(0.000075+0.001868*Math.cos(g)-0.032077*Math.sin(g)-0.014615*Math.cos(2*g)-0.040849*Math.sin(2*g));
    const decl=0.006918-0.399912*Math.cos(g)+0.070257*Math.sin(g)-0.006758*Math.cos(2*g)+0.000907*Math.sin(2*g)-0.002697*Math.cos(3*g)+0.00148*Math.sin(3*g);
    const cosH=Math.cos(90.833*rad)/(Math.cos(lat*rad)*Math.cos(decl))-Math.tan(lat*rad)*Math.tan(decl);
    if(!(cosH>-1&&cosH<1))return null;                       // polar day or night
    const ha=Math.acos(cosH)/rad, noon=720-4*lon-eq-date.getTimezoneOffset();
    return {rise:(noon-4*ha)/60,set:(noon+4*ha)/60};
  }
  /* Recompute for a date. Call once at start and again when the day changes. */
  function setDay(date=new Date(),tz){
    let zone=tz;
    if(!zone){try{zone=Intl.DateTimeFormat().resolvedOptions().timeZone}catch(e){zone=''}}
    const [lat,lon]=place(zone,date), s=solar(date,lat,lon);
    if(s&&s.rise>2&&s.rise<11&&s.set>13&&s.set<23.5){RISE=s.rise;SET=s.set}else{RISE=REF_RISE;SET=REF_SET}
  }
  // Real clock hour -> the hour with the same light on the reference day.
  function warp(t){
    if(t<=RISE)return t/RISE*REF_RISE;
    if(t<=SET)return REF_RISE+(t-RISE)/(SET-RISE)*(REF_SET-REF_RISE);
    return REF_SET+(t-SET)/(24-SET)*(24-REF_SET);
  }

  const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
  const toHex=a=>'#'+a.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
  const mix=(a,b,t)=>toHex(hex(a).map((v,i)=>v+(hex(b)[i]-v)*t));
  const lum=h=>{const [r,g,b]=hex(h);return (0.299*r+0.587*g+0.114*b)/255};
  function at(t,dark=false){
    t=((t%24)+24)%24;
    const w=warp(t);
    let i=K.findIndex(k=>k[0]>w)-1; if(i<0)i=K.length-2;
    const [h0,a0,b0,c0]=K[i],[h1,a1,b1,c1]=K[i+1];const f=(w-h0)/(h1-h0);
    let top=mix(a0,a1,f),bottom=mix(b0,b1,f),accent=mix(c0,c1,f);
    if(dark){top=mix(top,'#0e0e16',.4);bottom=mix(bottom,'#0e0e16',.5);accent=mix(accent,'#ffffff',.15)}
    else{const n=lum(mix(top,bottom,.5));if(n<.5){top=mix(top,'#ffffff',.22);bottom=mix(bottom,'#ffffff',.22)}}
    const day=t>=RISE&&t<=SET, p=day?(t-RISE)/(SET-RISE):null;
    // warm amount near sunrise and sunset, cool at night
    const edge=day?Math.max(0,1-Math.min(t-RISE,SET-t)/1.6):0;
    const night=!day?Math.min(1,Math.min(Math.abs(t-SET),Math.abs(t+24-SET),Math.abs(t-RISE),Math.abs(RISE+24-t))/1.2):0;
    return {t,top,bottom,accent,day,p,alt:day?Math.sin(Math.PI*p):0,az:day?p:null,warm:edge,night,dim:dark||lum(mix(top,bottom,.5))<.5};
  }
  const fmt=t=>{const m=Math.round(t*60),h=Math.floor(m/60);return String(h%24).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
  /* Write the sky colours for hour t onto the document: the whole app's accent follows the sky. */
  function paint(t,dark){
    const s=at(t,dark),R=document.documentElement.style;
    R.setProperty('--sky-top',s.top);R.setProperty('--sky-bottom',s.bottom);R.setProperty('--sky-accent',s.accent);
    R.setProperty('--accent',s.accent);R.setProperty('--accent-soft',s.accent+(dark?'38':'1f'));R.setProperty('--sun',PAL[cur].sun);
    return s;
  }
  /* Keep the document's sky colours on the real clock; sunrise and sunset are recomputed when the date changes. */
  let followDay='';
  function follow(onTick){
    const run=()=>{const d=new Date(),key=d.toDateString();if(key!==followDay){followDay=key;setDay(d)}
      paint(d.getHours()+d.getMinutes()/60,document.documentElement.classList.contains('dark'));if(onTick)onTick(d)};
    run();setInterval(run,20000);window.addEventListener('shishi-theme',run);
  }
  setDay();
  return {at,fmt,mix,paint,follow,setDay,setPalette,solar,palettes:Object.keys(PAL),
    get RISE(){return RISE},get SET(){return SET},get palette(){return cur},get sun(){return PAL[cur].sun}};
})();
