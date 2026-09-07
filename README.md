# DSH DuckDuckGo Web Search

DuckDuckGo-backed `web_search` provider for DeepSeek Harness.

## Install

1. Open a terminal in the `web-search-duckduckgo` folder (this repo’s root).
2. Add the plugin:

```sh
dsh plugin --profile web add .
```

3. Restart DSH:

```sh
dsh web
```

Then ask the agent to search the web as usual.

## Remove

```sh
dsh plugin --profile web remove dsh-web-search-duckduckgo
```

## Config

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://html.duckduckgo.com` | HTML search origin; `/html/` is appended |

## Notes

- Uses DuckDuckGo’s public HTML results page (not Instant Answer).
- No API key or Settings credential is required.
# web-search-duckduckgo
