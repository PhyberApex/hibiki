# Docs site (Jekyll)

The docs are built with **Jekyll** and published by **GitHub Pages** when you use **Settings → Pages** → source **Deploy from a branch** → branch **main** → folder **/docs**.

## How it works

1. **Source files** (what you edit):
   - **`index.md`** — Homepage content in Markdown. The front matter (`layout: default`, `title: ...`) tells Jekyll to wrap it in the default layout.
   - **`_layouts/default.html`** — Shared layout: header (hero + logo), main area where `{{ content }}` is replaced by the rendered page, footer. All CSS lives here so the look is consistent.
   - **`_config.yml`** — Site title, description, and `baseurl` (e.g. `/hibiki` so links work when the site is at `https://<user>.github.io/hibiki/`).
   - **Assets** — Put `logo.jpg`, `banner.jpg`, `favicon.jpg` (and any other images) in `docs/`. Reference them in Markdown or the layout as `{{ site.baseurl }}/logo.jpg` so they work on GitHub Pages.

2. **Build (on GitHub)**  
   When you push to `main`, GitHub Pages runs Jekyll on the `docs/` folder. Jekyll:
   - Reads `_config.yml`.
   - Renders `index.md` with the `default` layout into HTML.
   - Outputs the site (e.g. to a temporary `_site`). GitHub serves that at `https://<owner>.github.io/hibiki/`.

3. **No local build required**  
   You can edit `index.md` (and the layout or config) and push; GitHub builds and publishes. You don’t need to run Jekyll on your machine unless you want to preview.

## Editing content

- **Change the homepage:** Edit **`index.md`**. Use normal Markdown: `**bold**`, `[text](url)`, `code`, fenced code blocks, lists. Section structure uses `<section>` and `<div class="container">` so the layout’s CSS applies.
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

If you have Ruby and Bundler:

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
| Homepage text   | `index.md`           |
| Layout + CSS    | `_layouts/default.html` |
| Site settings   | `_config.yml`        |
| Images          | `docs/*.jpg` (and reference via `{{ site.baseurl }}/...`) |
| Build           | Done by GitHub Pages on push to `main` (folder `/docs`)   |
