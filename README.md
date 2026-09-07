# DSH DuckDuckGo Web Search

DuckDuckGo-backed `web_search` provider for DeepSeek Harness. No API key.

## Install (from npm)

After this package is published to npm:

```sh
dsh plugin --profile web add dsh-web-search-duckduckgo@latest
```

Restart:

```sh
dsh web
```

Then ask the agent to search the web as usual.

This plugin has no native build scripts, so you do **not** need `pnpm approve-builds` (that step is only for packages like `dsh-better-sidebar` that ship `node-pty`).

## Install (from a local checkout)

1. Open a terminal in this folder (`web-search-duckduckgo`).
2. Run:

```sh
dsh plugin --profile web add .
```

3. Restart with `dsh web`.

## Remove

```sh
dsh plugin --profile web remove dsh-web-search-duckduckgo
```

## Publish (maintainers)

So others can use the npm install command above:

1. Push this folder to GitHub.
2. Log in to npm: `npm login`
3. From this folder, publish:

```sh
npm publish --access public
```

4. Bump `version` in `package.json` for later releases, then publish again.

Optional: add a GitHub Action that runs `npm publish` on tagged releases.

## Config

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://html.duckduckgo.com` | HTML search origin; `/html/` is appended |

## Notes

- Uses DuckDuckGo’s public HTML results page (not Instant Answer).
- No API key or Settings credential is required.
