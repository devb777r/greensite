# GreenSite

Interactive priority map for tree-planting campaigns in Baghdad. Team SiTouch, Green Code Hackathon.

Static site, with no build step and no server.

```
index.html            landing page and map
assets/style.css      styles
assets/app.js         map logic (Leaflet)
assets/vendor/        Leaflet 1.9.4, bundled so the site doesn't depend on a CDN
data/cells.json       6,011 cells from the final notebook (GreenSite_AI_Baghdad_Greening_MVP_clean)
```

## Run locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly as a file won't work, because the browser blocks loading the data that way.

## Deploy (free)

1. Push this folder to a GitHub repository.
2. On vercel.com, sign in with GitHub, then choose **Add New → Project** and import the repository.
3. Leave every setting at its default and click **Deploy**. You'll get a link like `greensite.vercel.app`.

From then on, every push to GitHub updates the site automatically.

## How the top 20 are chosen

This uses the same logic as Step 10A in the notebook:

- Eligible cells are everything except built-up and water.
- Eligible cells are sorted by `rank`.
- The site walks down that list and keeps a cell only if it is at least 5 km from every cell already kept, stopping at 20.
- The distance filter keeps only cells at least N km from the centre. The centre is the median of all cells: 33.2708 N, 44.3720 E.

The results were checked against the notebook at 0, 20, 30 and 40 km, and all four match exactly.

## Team

Edit the `#team-grid` section in `index.html`.
