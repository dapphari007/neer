# Deploying the hosted dashboard

The public site is the dashboard built in **static mode**: no API, no database, the exported JSON
under `apps/web/public/data/` served as plain files. It costs nothing and never sleeps.

## Vercel (free tier)

1. Push the repository to GitHub.
2. In Vercel, **Add New → Project → Import** the repository. Leave every setting at its default;
   `vercel.json` at the root supplies the install command, the build command
   (`pnpm turbo run build --filter=@neer/web...`), the output directory (`apps/web/dist`), the
   single-page-app rewrite and the cache headers.
3. Do **not** set `VITE_API_BASE_URL`. Unset, the build uses the static adapter; set, it would try
   to reach an API that is not there.
4. Optional: set `VITE_REPO_URL` if the repository lives somewhere other than the default in
   `apps/web/src/lib/links.ts`.

Every push to the default branch redeploys. Pull requests get preview URLs.

## Refreshing the data

The hosted site shows whatever was exported last. To refresh it from a running stack:

```bash
pnpm export:demo      # ClickHouse → apps/web/public/data/*.json
git add apps/web/public/data && git commit -m "Refresh hosted dataset"
git push
```

The export includes every active site — the Coimbra sample dataset and the Environment Agency
sensor sites with their real readings as of the export.

## What the hosted build leaves out

Everything that needs a server: the live event stream and its indicator, sensor polling, weather
refresh, CSV import and the simulated field crew. All of it runs with `docker compose up` from a
clone, which the site's _How it works_ page links to.
