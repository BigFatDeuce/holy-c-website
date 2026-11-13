# Holy-C website

Static showcase for holy-c.men, deployed by Cloudflare Pages (project `holy-c-website`) on every push to `main`
of github.com/BigFatDeuce/holy-c-website. No build step.

- All content lives in `data/projects.json`; README.md documents every field and the workflows.
- Updating versions: `node tools/sync-releases.mjs`, then commit and push.
- Adding a project: `node tools/new-project.mjs Owner/Repo --region <zone>`, rewrite the texts from the repo README,
  download logo + screenshots from the repo into `assets/projects/<id>/`, run `python -I tools/optimize_images.py assets/projects/<id>`.
- Check locally with the `site` preview (`.claude/launch.json`, port 8765) on desktop 1440x900 and mobile before pushing.
- Site texts are in English. Display font Bricolage Grotesque at 84% width (font-stretch on html), zone titles Instrument Serif italic, body text Inter. The intro portrait is assets/intro/portrait.webp, a circle-masked transparent image.
- After editing css/js, bump the `?v=` on their links in index.html: the holy-c.men zone cache otherwise serves stale files.
