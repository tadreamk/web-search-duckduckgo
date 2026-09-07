# DSH DuckDuckGo Web Search

DuckDuckGo-backed `web_search` provider for DeepSeek Harness. No API key.

Published on npm: [dsh-web-search-duckduckgo](https://www.npmjs.com/package/dsh-web-search-duckduckgo)

## Install

If you run DSH with `npx`:

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-web-search-duckduckgo@latest
npx @deepseek-ai/dsh web
```

If `dsh` is on your PATH (global install):

```sh
dsh plugin --profile web add dsh-web-search-duckduckgo@latest
dsh web
```

`pnpm` must be on your PATH (the plugin command forwards to pnpm).

Then ask the agent to search the web as usual.

This plugin has no native build scripts, so you do **not** need `pnpm approve-builds` (that step is only for packages like `dsh-better-sidebar` that ship `node-pty`).

## Install (from a local checkout)

1. Open a terminal in this folder (`web-search-duckduckgo`).
2. Run:

```sh
npx @deepseek-ai/dsh plugin --profile web add .
```

Or with a global `dsh`:

```sh
dsh plugin --profile web add .
```

3. Restart with `npx @deepseek-ai/dsh web` or `dsh web`.

## Remove

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-web-search-duckduckgo
```

Or with a global `dsh`:

```sh
dsh plugin --profile web remove dsh-web-search-duckduckgo
```

## Release (maintainers)

Bump `version` in `package.json`, then from this folder:

```sh
npm publish --access public
```

Repo: [tadreamk/web-search-duckduckgo](https://github.com/tadreamk/web-search-duckduckgo)

## Config

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://html.duckduckgo.com` | HTML search origin; `/html/` is appended |

## Notes

- Uses DuckDuckGo’s public HTML results page (not Instant Answer).
- No API key or Settings credential is required.
