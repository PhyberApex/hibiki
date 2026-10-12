# Docs site (Jekyll)

The site is built with **Jekyll** and published by **GitHub Pages** from **Settings → Pages** → source **Deploy from a branch** → branch **main** → folder **/docs**. It is served at `https://phyberapex.github.io/hibiki/`, so `_config.yml` sets `baseurl: /hibiki`.

## Files

- **`index.md`** — the landing page. Mostly hand-written HTML inside the Markdown file: hero with the sound-radii illustration, the scene board illustration, the feature legend, the three-step bot setup, and the scene pack list.
- **`scene-sharing.md`** — the Scene Sharing guide, written in Markdown inside a `.read-layout` wrapper with a table of contents. Section ids (`{: #install}` and friends) feed the TOC.
- **`_layouts/default.html`** — the shared shell: header, nav, footer, font loading. The first comment in `<body>` is the design direction contract for the site.
- **`assets/css/site.css`** — all styles. The page background draws the battle-map grid; the three category colours (`--music`, `--ambience`, `--effects`) mirror the app's palette in `frontend/src/assets/base.css`.
- **`assets/js/site.js`** — progressive enhancement only: fills the download links from the latest GitHub release and highlights the current section in the guide's TOC. The site works without it.
- **`logo.png`**, **`social.png`** — brand art, both rendered from `frontend/public/logo.svg` (the echo mark). The logo is the favicon, the header token, and the party token in the hero; `social.png` is the Open Graph image.
- **`DESIGN.md`** (repo root) — the recorded design system for the site; read it before changing the look.

## Previewing locally

GitHub builds the site on push, so no local build is required. To preview:

```bash
gem install --user-install jekyll kramdown-parser-gfm
cd docs
jekyll serve --baseurl /hibiki
```

Then open `http://127.0.0.1:4000/hibiki/`.

## Editing

- **Copy on the landing page:** edit the HTML in `index.md`. Keep real facts only (release formats, permissions, scene names); the scene board is labelled as an illustration and must stay that way until real screenshots replace it.
- **The guide:** normal Markdown in `scene-sharing.md`. Use `##` for sections that should appear in the TOC and add a matching `<li>` in the `.toc` list.
- **Adding a page:** create `docs/<name>.md` with `layout: default` front matter, wrap the body in `<div class="read-layout">` + `<article class="prose" markdown="1">` to get the reading layout, and link it from the nav in `_layouts/default.html`.
