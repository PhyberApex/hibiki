# Docs site (Jekyll)

The docs are built with **Jekyll** and published by **GitHub Pages** when you use **Settings → Pages** → source **Deploy from a branch** → branch **main** → folder **/docs**.

## How it works

1. **Source files** (what you edit):
   - **`index.md`** — Homepage content in Markdown (setup, features, Scenes, volume, E2E). The front matter (`layout: default`, `title: ...`) tells Jekyll to wrap it in the default layout.
   - **`_layouts/default.html`** — Shared layout: simple text header (title + tagline, no banner), main content area, footer. All CSS lives here.
   - **`_config.yml`** — Site title, description (tagline), and `baseurl` (e.g. `/hibiki` so links work when the site is at `https://<user>.github.io/hibiki/`).
   - **Assets** — `logo.png` and `banner.png` in `docs/` (favicon uses logo; layout shows banner at top and logo in header). Copy from repo root if you replace them.

2. **Build (on GitHub)**  
   When you push to `main`, GitHub Pages runs Jekyll on the `docs/` folder. Jekyll:
   - Reads `_config.yml`.
   - Renders `index.md` with the `default` layout into HTML.
   - Outputs the site (e.g. to a temporary `_site`). GitHub serves that at `https://<owner>.github.io/hibiki/`.

3. **No local build required**  
   You can edit `index.md` (and the layout or config) and push; GitHub builds and publishes. You don’t need to run Jekyll on your machine unless you want to preview.

## Editing content

- **Change the homepage:** Edit **`index.md`**. Use normal Markdown: `##` headings, `**bold**`, `[text](url)`, `` `code` ``, fenced code blocks (triple backticks), and lists. The layout wraps content in a single `.container`; use `##` for sections so headings and paragraphs render correctly.
- **Change the look (header, footer, styles):** Edit **`_layouts/default.html`** (and keep `{{ content }}` so the page body still appears).
- **Change site title/description or base URL:** Edit **`_config.yml`**. If the repo is under a different path (e.g. different org or repo name), set `baseurl` to match (e.g. `"/my-repo"`).

## Adding more pages

1. Create e.g. **`docs/setup.md`** with front matter and content:
   ```yaml
   ---
   layout: default
   title: Setup guide
   ---
   Your Markdown here...
   ```
2. Jekyll will generate `setup.html`. Link to it from `index.md` as `[Setup guide]({{ site.baseurl }}/setup)` or `[Setup guide](/hibiki/setup)` (depending on how you’re viewing the site).
3. The same layout and styles apply to every page that uses `layout: default`.

## Preview locally (optional)

You need **Ruby** and **Bundler** to run `bundle` and Jekyll locally:

- **Ruby** — Check with `ruby -v`. macOS often has a system Ruby; if it’s missing or too old, install via [Homebrew](https://brew.sh/) (`brew install ruby`) or use [rbenv](https://github.com/rbenv/rbenv) / [rvm](https://rvm.io/).
- **Bundler** — Install with `gem install bundler`. Then run `bundle install` (or the commands below) in the directory that has a `Gemfile`.

From the repo root:

```bash
cd docs
bundle init
bundle add jekyll github-pages
bundle exec jekyll serve --lazy
```

Then open **http://localhost:4000/hibiki/** (the path includes `baseurl`). To test without a base path: `bundle exec jekyll serve --baseurl ""` and open http://localhost:4000.

The built site is in `docs/_site/`; that folder is in `.gitignore` and is not committed.

## Summary

| What            | Where                |
|-----------------|----------------------|
| Homepage text   | `index.md` (D&D-focused intro, setup, volume, known issues) |
| Layout + CSS    | `_layouts/default.html` (simple header, no banner) |
| Site settings   | `_config.yml` (title, tagline “Echoes of Adventure…”, baseurl) |
| Logo & banner   | `docs/logo.png`, `docs/banner.png` (layout uses both) |
| Build           | Done by GitHub Pages on push to `main` (folder `/docs`) |
