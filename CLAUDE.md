# Holy-C website

Static showcase for holy-c.men, deployed by Cloudflare Pages (project `holy-c-website`) on every push to `main`
of github.com/BigFatDeuce/holy-c-website. No build step.

- All content lives in `data/projects.json`; README.md documents every field and the workflows.
- Updating versions: `node tools/sync-releases.mjs`, then commit and push. A GitHub Action does this every 15 minutes (GitHub often delays or skips scheduled runs)
  and pushes as github-actions[bot], so always `git pull` before working.
- New public repos with a release are added by the same Action (`tools/auto-add.mjs`) with `"auto": true`.
  At the start of a session, run `gh issue list`: the issue "New public repos not on the site" lists those
  entries to polish (English texts, `facts`, images, `logoWide`, nudge) and repos without a release.
  After polishing, remove `"auto": true`. For a fan game from a new franchise, add a notice to `site.legal`.
- Adding a project by hand: `node tools/new-project.mjs Owner/Repo --region <zone>`, rewrite the texts from the repo README,
  download logo + screenshots from the repo into `assets/projects/<id>/`, run `python -I tools/optimize_images.py assets/projects/<id>`.
- Check locally with the `site` preview (`.claude/launch.json`, port 8765) on desktop 1440x900 and mobile before pushing.
- Site texts are in English. Display font Bricolage Grotesque at 84% width (font-stretch on html), zone titles Chakra Petch (glitch bursts from glitchLoop in main.js), body text Inter. The intro portrait is assets/intro/portrait.webp, a circle-masked transparent image.
- `links/index.html` (holy-c.men/links/) is a plain list of the projects from the same JSON, with inline CSS/JS; keep link rules in sync with linksOf() in main.js.
- After editing css/js, bump the `?v=` on their links in index.html: the holy-c.men zone cache otherwise serves stale files.
