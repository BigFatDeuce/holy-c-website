# holy-c.men

Showcase of GigaChud's projects, presented as an explorable map. Static site, no build step,
deployed by Cloudflare Pages on every push to `main`.

Everything shown on the map comes from [`data/projects.json`](data/projects.json):
zones, projects, texts, links and versions. The code places the projects by itself, so adding,
removing or reordering entries never requires touching HTML, CSS or JavaScript.

## Update the versions of existing projects

```bash
node tools/sync-releases.mjs
```

It reads the newest GitHub release of each project's `repo` and updates `version`, `prerelease`
and `released`, and sets `license` to the licence GitHub detects in the repo (e.g. `GPL-3.0`; left as is
when GitHub detects none). Add `--dry-run` to only see what would change. Then commit and push.

This also runs by itself every 15 minutes (`.github/workflows/sync-releases.yml`; GitHub may delay
or skip scheduled runs): new versions are committed and pushed automatically. Run it on demand from
the Actions tab, or with `gh workflow run sync-releases.yml`.

## New projects are added automatically

The same Action runs `tools/auto-add.mjs`: every public repo of the owner that is not on the site yet
and has at least one published release is added by itself. It guesses the zone (game or software),
the name, tagline and description from the README (badge images are ignored), the platforms from the release
files, the play link from the repo's homepage or a "Play" link at the top of the README, and takes the logo
and first screenshot referenced by the README (kept as downloaded if the WebP conversion fails).
Those entries get `"auto": true` and are listed in the issue "New public repos not on the site",
together with public repos that have no release yet. Review them (texts, `facts`, images), then remove
`"auto": true`; the issue closes by itself once nothing is left. Repos listed in `IGNORE_REPOS` in the
workflow are never added. Try it locally with `node tools/auto-add.mjs --dry-run`.

## Add a project by hand

1. Create the entry, pre-filled from GitHub:

   ```bash
   node tools/new-project.mjs Owner/Repo --region software
   ```

   Options: `--region <zone id>`, `--id <slug>`, `--name "Display name"`.
2. Rewrite `tagline`, `description` and `facts` in `data/projects.json`, check `platforms`, `stack` and `links`.
3. Put the images in `assets/projects/<id>/` (a `logo.*` and one or more screenshots), then shrink them:

   ```bash
   python tools/optimize_images.py assets/projects/<id>
   ```
4. Open the site locally (`python -m http.server 8765`) and check the new marker.

The order of projects in the file is the order on the map and in the index.

## Add a zone

Add an object to `regions`, in the order zones should appear from left to right:

```json
{ "id": "tools", "title": "Tools", "singular": "Tool", "color": "#8fd6b4", "tint": 0 }
```

`color` tints the zone outline, links, markers and buttons. `tint` sets the background mood
(`0` blue, `1` amber, anything in between mixes them). A bridge with a "Next zone" sign is drawn
automatically between consecutive zones. Zones without projects are hidden.

## Project fields

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Slug used in the URL (`holy-c.men/#id`) and the assets folder |
| `name` | yes | Name shown on the map |
| `region` | yes | One of the zone ids |
| `repo` | no | `Owner/Repo`; gives the GitHub and Download buttons and feeds the version sync |
| `tagline`, `description` | yes | Short line and paragraph in the project panel |
| `platforms` | yes | List shown under the name |
| `stack`, `license` | no | Shown in the facts grid and the About page; `license` follows the repo's licence (version sync) |
| `facts` | no | Up to four short highlights |
| `logo`, `logoWide` | no | `logoWide: true` for a horizontal logo |
| `shots`, `portrait` | no | Screenshots; `portrait: true` shows the first two side by side (phone apps) |
| `links` | no | `play`, `website`, `discord`, or `download` / `github` to override the defaults (`false` hides them) |
| `nudge` | no | `{ "x": 0, "y": 0 }` to move a marker by hand if two names collide |
| `version`, `prerelease`, `released` | no | Filled by `tools/sync-releases.mjs` |
| `auto` | no | `true` on entries added by `tools/auto-add.mjs` that still need a review; not shown anywhere |

`site.about` is the first paragraph of the About page; `{software}` and `{games}` (any zone id)
are replaced by the number of projects in that zone, written in words.

`site.legal` is a list of notices shown at the bottom of the About page and of the links page,
one per franchise of fan games (who owns the trademarks, and that the games are not affiliated with them).
Update it whenever a fan game from a new franchise is added.

## Caching

The domain's Cloudflare cache keeps CSS, JS and images for hours. After changing `css/style.css`,
`js/main.js` or `js/world.js`, bump the `?v=` number on their links in `index.html` (same number for all three).
Replacing an image under the same name has the same problem: give the new file a new name instead.
`index.html` and `data/projects.json` are not cached, so content updates show up right away.

## Files

- `index.html`, `css/style.css` — page and styles (display font: Bricolage Grotesque, narrowed with font-stretch; zone titles: Chakra Petch with a periodic glitch; text: Inter)
- `js/main.js` — layout, camera, markers, zones, panels
- `js/world.js` — WebGL background
- `assets/fonts/` — self-hosted fonts (SIL Open Font License, see `OFL.txt`), so visitors never contact Google
- `links/index.html` — "Just the links, bro": a plain list of every project, built from the same JSON (self-contained CSS and JS, not cached)
- `_headers` — Cloudflare Pages cache headers
