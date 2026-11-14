'use strict';
/* Follows the Mac's appearance and accessibility settings.
   html.dark swaps the colour tokens; html.rm turns motion off; html.opaque replaces glass with solid surfaces. */
window.Theme=(()=>{
  const root=document.documentElement;
  const dark=matchMedia('(prefers-color-scheme: dark)');
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const clear=matchMedia('(prefers-reduced-transparency: reduce)');
  let userReduce=false;
  function apply(){
    root.classList.toggle('dark',dark.matches);
    root.classList.toggle('rm',motion.matches||userReduce);
    root.classList.toggle('opaque',clear.matches);
    window.dispatchEvent(new Event('shishi-theme'));
  }
  for(const q of [dark,motion,clear])q.addEventListener('change',apply);
  apply();
  return {
    get dark(){return root.classList.contains('dark')},
    get reduceMotion(){return root.classList.contains('rm')},
    get systemReduceMotion(){return motion.matches},
    setReduceMotion(v){userReduce=!!v;apply()},
  };
})();
