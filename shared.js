/* Crypto Asia — shared nav, footer and light/dark theme. Edit LINKS to add or remove pages. */
(function(){
  var LINKS = [
    ['News','index.html'],
    ['Jobs','jobs.html'],
    ['NFT Studio','nft-studio.html'],
    ['Airdrop Calc','airdrop-calculator.html'],
    ['Perp Rankings','perps.html'],
    ['Tier List','tierlist.html'],
    ['Inheritance','inheritance.html'],
    ['Fortune','fortune.html'],
    ['About','about.html']
  ];
  var root = document.documentElement;
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  /* ---- theme ---- */
  function getTheme(){ try { return localStorage.getItem('ca-theme') || 'dark'; } catch(e){ return 'dark'; } }
  function setTheme(t){
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('ca-theme', t); } catch(e){}
    var b = document.getElementById('themeBtn');
    if (b){ b.textContent = t === 'dark' ? '☀' : '☾'; b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); b.title = b.getAttribute('aria-label'); }
  }
  root.setAttribute('data-theme', getTheme());

  /* ---- favicon (in case a page forgot it) ---- */
  if (!document.querySelector('link[rel="icon"]')){
    var l = document.createElement('link'); l.rel = 'icon'; l.type = 'image/png'; l.href = 'logos/favicon-32.png'; document.head.appendChild(l);
  }

  /* ---- nav ---- */
  var navHost = document.getElementById('site-nav');
  if(navHost){
    var items = LINKS.map(function(l){
      return '<li><a href="'+l[1]+'"'+(l[1]===page?' class="on"':'')+'>'+l[0]+'</a></li>';
    }).join('');
    navHost.outerHTML =
      '<nav class="nav">'+
        '<a class="nav-logo" href="index.html" aria-label="Crypto Asia news home">'+
          '<img src="logos/ca-icon.png" alt="Crypto Asia logo" width="46" height="46"><b>CRYPTO ASIA</b></a>'+
        '<ul class="nav-links" id="navLinks">'+items+
          '<li><a class="btn" href="https://www.x.com/CryptoAsiaBTC" target="_blank" rel="noopener">&#120143; Follow</a></li>'+
          '<li><button class="theme-btn" id="themeBtn" type="button"></button></li>'+
        '</ul>'+
        '<button class="nav-toggle" id="navToggle" type="button" aria-label="Menu">Menu</button>'+
      '</nav>';
    document.getElementById('navToggle').addEventListener('click', function(){
      document.getElementById('navLinks').classList.toggle('open');
    });
    document.getElementById('themeBtn').addEventListener('click', function(){
      setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    setTheme(getTheme());
  }

  /* ---- footer ---- */
  var footHost = document.getElementById('site-foot');
  if(footHost){
    footHost.outerHTML =
      '<footer class="foot"><img class="foot-logo" src="logos/ca-round.png" alt="Crypto Asia" loading="lazy">'+
      '&copy; 2026 <a href="index.html">CRYPTO ASIA</a> &mdash; CRYPTOASIABTC.COM &middot; <a href="about.html#privacy">About &amp; Privacy</a> &middot; <a href="https://www.x.com/CryptoAsiaBTC" target="_blank" rel="noopener">@CryptoAsiaBTC</a>'+
      '<div class="disc">For information and entertainment only. Nothing on this site is financial, legal or tax advice. Crypto is volatile and you can lose money. Do your own research.</div></footer>';
  }

  /* ---- visit counting (Umami, cookie-less). Paste your Website ID below to switch it on; leave empty to keep it off. ---- */
  var UMAMI_ID = '';
  if(UMAMI_ID){
    var loadUmami = function(){
      var u = document.createElement('script');
      u.defer = true; u.src = 'https://cloud.umami.is/script.js';
      u.setAttribute('data-website-id', UMAMI_ID);
      u.setAttribute('data-domains', 'cryptoasiabtc.com');
      u.setAttribute('data-do-not-track', 'true');
      document.head.appendChild(u);
    };
    var later = function(){ (window.requestIdleCallback || function(f){ setTimeout(f, 800); })(loadUmami); };
    if(document.readyState === 'complete') later(); else window.addEventListener('load', later);
  }
  /* click events: any element with data-track="name" */
  document.addEventListener('click', function(e){
    var el = e.target.closest && e.target.closest('[data-track]');
    if(el && window.umami && umami.track) { try { umami.track(el.getAttribute('data-track')); } catch(x){} }
  });

  /* ---- one-time notice (we use no cookies) ---- */
  try {
    if (localStorage.getItem('ca-cookie') !== '1') {
      var cb = document.createElement('div');
      cb.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:200;background:#080807;color:#FFF3C4;border-top:2px solid #F5C518;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:.9rem 1.5rem;font-size:1rem';
      cb.innerHTML = '<span>We count visits with a cookie-free tool. <a href="about.html#privacy" style="color:#F5C518">Details</a></span><button type="button" style="font-family:\'Share Tech Mono\',monospace;font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;background:#F5C518;color:#080807;border:none;padding:.55rem 1.4rem;cursor:pointer;font-weight:700">OK</button>';
      cb.querySelector('button').onclick = function(){ cb.remove(); try { localStorage.setItem('ca-cookie','1'); } catch(e){} };
      document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(cb); });
    }
  } catch(e){}

  /* ---- scroll reveal ---- */
  if('IntersectionObserver' in window){
    var obs = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting) e.target.classList.add('visible'); });
    },{threshold:.08});
    document.querySelectorAll('.reveal').forEach(function(el){ obs.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function(el){ el.classList.add('visible'); });
  }
})();
