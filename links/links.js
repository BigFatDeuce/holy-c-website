// "Just the links, bro": renders every project from /data/projects.json as a plain list.
(function () {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  // Paths in projects.json are relative to the site root.
  var url = function (p) { return /^(https?:)?\//.test(p) ? p : '/' + p; };

  // Same rules as linksOf() in js/main.js.
  function linksOf(p) {
    var L = p.links || {}, out = [];
    if (L.play) out.push(['Play in browser', L.play]);
    if (L.download !== false && (L.download || p.repo)) out.push(['Download', L.download || 'https://github.com/' + p.repo + '/releases' + (p.prerelease ? '' : '/latest')]);
    if (L.website) out.push(['Website', L.website]);
    if (L.github !== false && (L.github || p.repo)) out.push(['GitHub', L.github || 'https://github.com/' + p.repo]);
    if (L.discord) out.push(['Discord', L.discord]);
    return out;
  }

  function card(p) {
    var meta = (p.version ? 'v' + p.version + (p.prerelease ? ' preview' : '') + ' · ' : '') + (p.platforms || []).join(' · ');
    var links = linksOf(p).map(function (l, i) {
      return '<a' + (i === 0 ? ' class="main"' : '') + ' href="' + esc(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + '</a>';
    }).join('');
    return '<li class="item">' +
      '<div class="logo' + (p.logoWide ? ' wide' : '') + '">' + (p.logo ? '<img src="' + esc(url(p.logo)) + '" alt="" width="76" height="76" decoding="async">' : '') + '</div>' +
      '<div><h3 class="name">' + esc(p.name) + '</h3>' +
      '<p class="meta">' + esc(meta) + '</p>' +
      '<p class="desc">' + esc(p.tagline) + '</p>' +
      '<div class="links">' + links + '</div></div></li>';
  }

  fetch('/data/projects.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      var html = (d.regions || []).map(function (r) {
        var items = d.projects.filter(function (p) { return p.region === r.id; });
        if (!items.length) return '';
        return '<section style="--zone:' + esc(r.color) + '"><h2>' + esc(r.title) + ' <small>' + items.length + '</small></h2>' +
          '<ul class="list">' + items.map(card).join('') + '</ul></section>';
      }).join('');
      document.getElementById('list').innerHTML = html;

      document.getElementById('legal').textContent = ((d.site && d.site.legal) || []).join(' ');
    })
    .catch(function () {
      document.getElementById('list').innerHTML = '<p class="msg">Could not load the list. Everything is on <a href="https://github.com/BigFatDeuce">github.com/BigFatDeuce</a>.</p>';
    });
})();
