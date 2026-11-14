'use strict';
// Icon sprite shared by the main window and the results panel. Provider glyphs are simplified
// neutral marks, not official logos. Use as <svg class="i"><use href="#name"/></svg>.
(() => {
  const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  holder.setAttribute('width', '0'); holder.setAttribute('height', '0'); holder.setAttribute('aria-hidden', 'true');
  holder.style.position = 'absolute';
  holder.innerHTML = `
<symbol id="star" viewBox="0 0 24 24"><path d="M12 3.6l2.55 5.3 5.8.8-4.2 4.05 1 5.75L12 16.8l-5.15 2.7 1-5.75L3.65 9.7l5.8-.8z"/></symbol>
<symbol id="moon" viewBox="0 0 24 24"><path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.3 6.3 0 0 0 10.1 10.1z"/></symbol>
<symbol id="tray" viewBox="0 0 24 24"><path d="M3.8 13.5 6.4 6.4a1.5 1.5 0 0 1 1.4-1h8.4a1.5 1.5 0 0 1 1.4 1l2.6 7.1v4.6a1.5 1.5 0 0 1-1.5 1.5H5.3a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M3.8 13.5h4.6l1.1 2.2h5l1.1-2.2h4.6"/></symbol>
<symbol id="search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.8 4.8"/></symbol>
<symbol id="ellipsis" viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/></symbol>
<symbol id="chev-left" viewBox="0 0 24 24"><path d="M14.5 5.5 8 12l6.5 6.5"/></symbol>
<symbol id="chev-down" viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6"/></symbol>
<symbol id="chev-right" viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5"/></symbol>
<symbol id="folder" viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></symbol>
<symbol id="calendar" viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5"/></symbol>
<symbol id="pv-codex" viewBox="0 0 24 24"><path d="M12 2.6 20.2 7.3v9.4L12 21.4 3.8 16.7V7.3Z"/><path d="M8.7 9.5l2.7 2.5-2.7 2.5M13.2 14.7h2.8"/></symbol>
<symbol id="pv-claude" viewBox="0 0 24 24"><path d="M12.00 9.60L12.00 3.20M13.70 10.30L16.81 7.19M14.40 12.00L20.80 12.00M13.70 13.70L16.81 16.81M12.00 14.40L12.00 20.80M10.30 13.70L7.19 16.81M9.60 12.00L3.20 12.00M10.30 10.30L7.19 7.19" stroke-width="2"/></symbol>
<symbol id="pv-grok" viewBox="0 0 24 24"><path d="M17.1 7.6A6.7 6.7 0 1 0 18.6 13.4"/><path d="M4.6 19.4 19.4 4.6"/></symbol>
<symbol id="pv-qwen" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2.2"/><path d="M10 3.8v3.2M14 3.8v3.2M10 17v3.2M14 17v3.2M3.8 10H7M3.8 14H7M17 10h3.2M17 14h3.2"/></symbol>
<symbol id="pv-ci" viewBox="0 0 24 24"><circle cx="7" cy="5.8" r="2.2"/><circle cx="7" cy="18.2" r="2.2"/><circle cx="17" cy="8.5" r="2.2"/><path d="M7 8v8M17 10.7c0 3.4-4.6 3.6-8.6 5.6"/></symbol>
<symbol id="pv-mail" viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="12" rx="2.6"/><path d="M4.6 7.6 12 13.4l7.4-5.8"/></symbol>
<symbol id="pv-bell" viewBox="0 0 24 24"><path d="M6.4 16.6h11.2l-1.4-2.2V10.2a4.2 4.2 0 0 0-8.4 0v4.2zM10.2 19.2a1.9 1.9 0 0 0 3.6 0"/></symbol>
<symbol id="star4" viewBox="0 0 24 24"><path d="M12 1.5c.6 4.9 2.6 8.9 10.5 10.5-7.9 1.6-9.9 5.6-10.5 10.5C11.4 17.6 9.4 13.6 1.5 12 9.4 10.4 11.4 6.4 12 1.5z" fill="currentColor" stroke="none"/></symbol>
<symbol id="check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
<symbol id="check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.7 2.7L16 9.6"/></symbol>
<symbol id="list" viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1" fill="currentColor"/><circle cx="4.8" cy="12" r="1" fill="currentColor"/><circle cx="4.8" cy="17.5" r="1" fill="currentColor"/></symbol>
<symbol id="clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol>
<symbol id="sparkles" viewBox="0 0 24 24"><path d="M10 4l1.6 4.6L16 10.2l-4.4 1.6L10 16.4l-1.6-4.6L4 10.2l4.4-1.6zM17.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></symbol>
<symbol id="plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="sidebar" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M9.5 5v14"/></symbol>
<symbol id="gauge" viewBox="0 0 24 24"><path d="M4.5 16.5a7.5 7.5 0 1 1 15 0"/><path d="M12 16.5l3.6-4.6"/></symbol>
<symbol id="doc" viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M13.5 3.5V7.5h4"/></symbol>
<symbol id="warn" viewBox="0 0 24 24"><path d="M12 4.5 20.5 19h-17z"/><path d="M12 10v4M12 16.6v.2"/></symbol>
<symbol id="sort" viewBox="0 0 24 24"><path d="M8 4.5v15M4.5 8 8 4.5 11.5 8M16 19.5v-15M12.5 16 16 19.5 19.5 16"/></symbol>
<symbol id="flag" viewBox="0 0 24 24"><path d="M5.5 20.5V4.5M5.5 5h11l-2 4 2 4h-11"/></symbol>
<symbol id="number" viewBox="0 0 24 24"><path d="M9.8 4 7.8 20M16.2 4l-2 16M4.5 9h15M4 15h15"/></symbol>
<symbol id="open" viewBox="0 0 24 24"><path d="M13.5 4.5h6v6M19.5 4.5 11 13M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></symbol>
<symbol id="quote" viewBox="0 0 24 24"><path d="M4 6.5h16M4 12h16M4 17.5h10"/></symbol>
<symbol id="bell-off" viewBox="0 0 24 24"><path d="M6.4 16.6h11.2l-1.4-2.2V10.2a4.2 4.2 0 0 0-7.2-3M7.8 10.2v4.2l-1.4 2.2M10.2 19.2a1.9 1.9 0 0 0 3.6 0M4.5 4.5l15 15"/></symbol>
`;
  (document.body || document.documentElement).prepend(holder);
})();
