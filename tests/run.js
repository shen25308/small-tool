/* node tests/run.js [suite...]  ·  SHISHI_BROWSER=webkit node tests/run.js  ·  VERBOSE=1 prints every step */
const lib=require('./lib');const {launch,save,BROWSER}=lib;
const ALL=['p1-pm','p2-dev','p3-morning','p4-planner','p5-keyboard','p6-night','p7-panel','p8-inbox','p9-features','p10-english','deadclick'];
(async()=>{
  const pick=process.argv.slice(2);const list=pick.length?pick:ALL;
  const b=await launch();let P=0,F=0;const sum=[];
  for(const n of list){process.stdout.write(`▶ ${n} (${BROWSER})\n`);const t0=Date.now();
    let r;try{r=await require('./'+n)(b)}catch(e){r=lib.current&&lib.current.name===n?lib.current:{name:n,browser:BROWSER,pass:0,fail:0,steps:[]};r.fail++;r.steps.push({ok:false,msg:'crash: '+e.message});console.log('   ✗ crash',e.stack.split('\n').slice(0,4).join(' | '))}
    await save(r);P+=r.pass;F+=r.fail;sum.push(`${n.padEnd(12)} ${String(r.pass).padStart(3)} passed  ${String(r.fail).padStart(2)} failed  ${((Date.now()-t0)/1000).toFixed(1)}s`)}
  await b.close();console.log('\n'+sum.join('\n')+`\nTotal ${P} passed / ${F} failed (${BROWSER})`);process.exit(F?1:0);
})();
