const RELEASES_API = 'https://api.github.com/repos/PhyberApex/hibiki/releases/latest'

const platformMatchers = [
  {
    id: 'mac',
    test: name => /\.dmg$/i.test(name),
  },
  {
    id: 'mac-zip',
    test: name => /darwin.*\.zip$/i.test(name),
  },
  {
    id: 'win',
    test: name => /\.exe$/i.test(name),
  },
  {
    id: 'win-zip',
    test: name => /win32.*\.zip$/i.test(name),
  },
  {
    id: 'deb',
    test: name => /\.deb$/i.test(name),
  },
  {
    id: 'linux-zip',
    test: name => /linux.*\.zip$/i.test(name),
  },
]

function fillDownloads(release) {
  const version = document.querySelector('[data-release-version]')
  if (version && release.tag_name)
    version.textContent = release.tag_name

  const assets = release.assets || []
  platformMatchers.forEach((matcher) => {
    const link = document.querySelector(`[data-asset="${matcher.id}"]`)
    if (!link)
      return
    const asset = assets.find(a => matcher.test(a.name))
    if (asset)
      link.href = asset.browser_download_url
  })
}

if (document.querySelector('[data-asset]') && window.fetch) {
  fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
  })
    .then(r => (r.ok
      ? r.json()
      : null))
    .then((release) => {
      if (release)
        fillDownloads(release)
    })
    .catch(() => {})
}

const tocLinks = Array.from(document.querySelectorAll('.toc a[href^="#"]'))
if (tocLinks.length && 'IntersectionObserver' in window) {
  const byId = Object.fromEntries(tocLinks.map(a => [
    a.getAttribute('href').slice(1),
    a,
  ]))
  const headings = Object.keys(byId).map(id => document.getElementById(id)).filter(Boolean)
  let current = null
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting)
        current = entry.target.id
    })
    if (!current)
      return
    tocLinks.forEach((a) => {
      a.classList.toggle('is-active', a.getAttribute('href') === `#${current}`)
    })
  }, { rootMargin: '-15% 0px -70% 0px' })
  headings.forEach(h => observer.observe(h))
}
