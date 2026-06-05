# JSON Pretty Print

A free, **100% client-side** JSON pretty-printer, minifier and validator. No data ever leaves your browser — there is no backend.

**Live site:** https://www.jsonpretty.co.uk/
**Source:** https://github.com/i-am-shodan/JSONPrettyPrintSite

## Features

- Pretty-print with 2-space, 4-space, or Tab indentation
- Minify
- Validate with line/column error reporting (the offending character is auto-selected in the input)
- Optional alphabetical key sorting (recursive, stable)
- Load from file (drag-and-drop supported) up to 20 MB
- Paste from clipboard, copy result, download as `.json`
- Light/dark theme (auto-detects system preference, remembers your choice)
- Keyboard shortcut: **Ctrl/Cmd + Enter** in the input area to format

No dependencies, no build step — three static files: [index.html](index.html), [styles.css](styles.css), [app.js](app.js).

## Run locally

Just open [index.html](index.html) in any modern browser. Or serve it with anything, e.g.:

```powershell
# Python (any version with http.server)
python -m http.server 8080
# then open http://localhost:8080
```

## Deploy to Azure Static Web Apps (Free)

[Azure Static Web Apps](https://azure.microsoft.com/products/app-service/static) has a permanent **Free** tier that's a great fit for a static site like this (100 GB bandwidth/month, free SSL, custom domain, global CDN — no credit card charges on the Free plan).

### One-time setup

1. **Push this repo to GitHub** (it already lives at `JSONPrettyPrintSite`).

2. **Create the Static Web App resource** (Azure Portal → "Create a resource" → "Static Web App"):
    - **Plan type:** `Free`
    - **Source:** `GitHub` → authorize → pick this repo, branch `main`
    - **Build presets:** `Custom`
    - **App location:** `/`
    - **Api location:** *(leave blank)*
    - **Output location:** *(leave blank)*

    Azure will:
    - Create a `*.azurestaticapps.net` URL with HTTPS
    - Commit a workflow file under `.github/workflows/` (named for your resource, e.g. [azure-static-web-apps-purple-rock-02cdd1e03.yml](.github/workflows/azure-static-web-apps-purple-rock-02cdd1e03.yml))
    - Add a matching `AZURE_STATIC_WEB_APPS_API_TOKEN_*` secret to the GitHub repo.

3. **If Azure didn't add the secret automatically**, grab it from the Portal:
    - Open your Static Web App → **Overview** → **Manage deployment token** → copy.
    - In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
        - Name: the `AZURE_STATIC_WEB_APPS_API_TOKEN_*` name referenced in the workflow file Azure committed.
        - Value: *(paste the token)*

4. **Push to `main`.** The GitHub Action will deploy and your site goes live in ~1 minute.

### Alternative: deploy via SWA CLI (no GitHub Actions)

```powershell
npm install -g @azure/static-web-apps-cli
swa login
swa deploy . --env production
```

### Cost

The **Free** plan is $0/month. You only get charged if you switch to the **Standard** plan, which you don't need for this site.

## Project layout

```
.
├── index.html                  # markup + UI
├── styles.css                  # theming + layout
├── app.js                      # all logic (parse / format / minify / theme / clipboard / file IO)
├── staticwebapp.config.json    # SWA routing + security headers (CSP, X-Frame-Options, etc.)
├── .github/workflows/
│   └── azure-static-web-apps-*.yml   # generated and maintained by Azure
└── LICENSE
```

## Security notes

- Strict `Content-Security-Policy` in [staticwebapp.config.json](staticwebapp.config.json) disallows external scripts, inline scripts/styles, and framing.
- Everything runs in the browser — no telemetry, no network calls.

## License

See [LICENSE](LICENSE).
