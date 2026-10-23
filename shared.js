/* Crypto Asia — shared nav + footer. Edit LINKS to add or remove pages. */
(function(){
  var LINKS = [
    ['Home','index.html'],
    ['News','news.html'],
    ['Fortune','fortune.html'],
    ['Inheritance','inheritance.html'],
    ['Jobs','jobs.html'],
    ['Airdrop Calc','airdrop-calculator.html']
  ];
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  var navHost = document.getElementById('site-nav');
  if(navHost){
    var items = LINKS.map(function(l){
      return '<li><a href="'+l[1]+'"'+(l[1]===page?' class="on"':'')+'>'+l[0]+'</a></li>';
    }).join('');
    navHost.outerHTML =
      '<nav class="nav">'+
        '<a class="nav-logo" href="index.html">'+
          '<img src="CRYPTO_ASIA_PAVIA.png" alt="Crypto Asia" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'">'+
          '<span>CRYPTO ASIA</span></a>'+
        '<ul class="nav-links" id="navLinks">'+items+
          '<li><a class="btn" style="color:#080807;border:none" href="https://www.x.com/CryptoAsiaBTC" target="_blank" rel="noopener">&#120143; Follow</a></li>'+
        '</ul>'+
        '<button class="nav-toggle" id="navToggle" type="button" aria-label="Menu">Menu</button>'+
      '</nav>';
    document.getElementById('navToggle').addEventListener('click', function(){
      document.getElementById('navLinks').classList.toggle('open');
    });
  }

  var footHost = document.getElementById('site-foot');
  if(footHost){
    footHost.outerHTML =
      '<footer class="foot">&copy; 2026 <a href="index.html">CRYPTO ASIA</a> &mdash; CRYPTOASIA.NET'+
      '<div class="disc">For information and entertainment only. Nothing on this site is financial, legal or tax advice. Crypto is volatile and you can lose money. Do your own research.</div></footer>';
  }

  // scroll reveal
  if('IntersectionObserver' in window){
    var obs = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting) e.target.classList.add('visible'); });
    },{threshold:.08});
    document.querySelectorAll('.reveal').forEach(function(el){ obs.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function(el){ el.classList.add('visible'); });
  }
})();
