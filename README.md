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
and `released`. Add `--dry-run` to only see what would change. Then commit and push.

This also runs by itself every 6 hours (`.github/workflows/sync-releases.yml`): new versions are committed
and pushed automatically, and public repos missing from the site are listed in an open issue
("New public repos not on the site"). Run it on demand from the Actions tab, or with
`gh workflow run sync-releases.yml`.

## Add a project

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
| `stack`, `license` | no | Shown in the facts grid and the About page |
| `facts` | no | Up to four short highlights |
| `logo`, `logoWide` | no | `logoWide: true` for a horizontal logo |
| `shots`, `portrait` | no | Screenshots; `portrait: true` shows the first two side by side (phone apps) |
| `links` | no | `play`, `website`, `discord`, or `download` / `github` to override the defaults (`false` hides them) |
| `nudge` | no | `{ "x": 0, "y": 0 }` to move a marker by hand if two names collide |
| `version`, `prerelease`, `released` | no | Filled by `tools/sync-releases.mjs` |

`site.about` is the first paragraph of the About page; `{software}` and `{games}` (any zone id)
are replaced by the number of projects in that zone, written in words.

## Caching

The domain's Cloudflare cache keeps CSS, JS and images for hours. After changing `css/style.css`,
`js/main.js` or `js/world.js`, bump the `?v=` number on their links in `index.html` (same number for all three).
Replacing an image under the same name has the same problem: give the new file a new name instead.
`index.html` and `data/projects.json` are not cached, so content updates show up right away.

## Files

- `index.html`, `css/style.css` — page and styles (display font: Bricolage Grotesque, narrowed with font-stretch; zone titles: Chakra Petch with a periodic glitch; text: Inter)
- `js/main.js` — layout, camera, markers, zones, panels
- `js/world.js` — WebGL background
- `_headers` — Cloudflare Pages cache headers
