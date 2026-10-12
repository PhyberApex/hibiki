(function () {
  var RELEASES_API = 'https://api.github.com/repos/PhyberApex/hibiki/releases/latest';

  var platformMatchers = [
    { id: 'mac', test: function (n) { return /\.dmg$/i.test(n); } },
    { id: 'mac-zip', test: function (n) { return /darwin.*\.zip$/i.test(n); } },
    { id: 'win', test: function (n) { return /\.exe$/i.test(n); } },
    { id: 'win-zip', test: function (n) { return /win32.*\.zip$/i.test(n); } },
    { id: 'deb', test: function (n) { return /\.deb$/i.test(n); } },
    { id: 'linux-zip', test: function (n) { return /linux.*\.zip$/i.test(n); } }
  ];

  function fillDownloads(release) {
    var version = document.querySelector('[data-release-version]');
    if (version && release.tag_name) version.textContent = release.tag_name;
    var assets = release.assets || [];
    platformMatchers.forEach(function (m) {
      var link = document.querySelector('[data-asset="' + m.id + '"]');
      if (!link) return;
      var asset = assets.filter(function (a) { return m.test(a.name); })[0];
      if (asset) link.href = asset.browser_download_url;
    });
  }

  if (document.querySelector('[data-asset]') && window.fetch) {
    fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (release) { if (release) fillDownloads(release); })
      .catch(function () {});
  }

  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    tocLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var headings = Object.keys(byId).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var current = null;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) current = e.target.id; });
      if (!current) return;
      tocLinks.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + current); });
    }, { rootMargin: '-15% 0px -70% 0px' });
    headings.forEach(function (h) { observer.observe(h); });
  }
})();
