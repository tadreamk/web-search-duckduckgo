/**
 * DuckDuckGo web search provider for DeepSeek Harness (DSH).
 * Registers on ctx.web; uses the public HTML results page (no API key).
 */

import Schema from '@deepseek-ai/schemastery'
import { WebError } from '@deepseek-ai/dsh-web'

export const name = 'web-search-duckduckgo'
export const inject = ['web']

export const DUCKDUCKGO_PROVIDER_ID = 'duckduckgo'
export const DUCKDUCKGO_DEFAULT_BASE_URL = 'https://html.duckduckgo.com'

export const CAPTCHA_RETRY_LABEL = "I've completed verification"
export const CAPTCHA_CANCEL_LABEL = 'Cancel search'

const USER_AGENT = 'deepseek-harness/0.0.1'
const RESULT_LINK = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
const RESULT_SNIPPET = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|span)/i

const CAPTCHA_MARKERS = [
  'anomaly-modal__',
  'anomaly_modal',
  'src="anomaly.js"',
  '/anomaly.js',
  'unfortunately, bots use duckduckgo',
  'id="challenge-form"',
]

export const Config = Schema.object({
  baseURL: Schema.string().description('DuckDuckGo HTML search origin; /html/ is appended.'),
})

export function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
}

export function stripHtml(value) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim()
}

export function resolveResultUrl(href) {
  const absolute = href.startsWith('//') ? `https:${href}` : href
  let parsed
  try {
    parsed = new URL(absolute)
  } catch {
    return undefined
  }
  const uddg = parsed.searchParams.get('uddg')
  if (uddg !== null && uddg.length > 0) {
    try {
      const destination = new URL(uddg)
      if (destination.protocol === 'http:' || destination.protocol === 'https:') return destination.href
    } catch {
      // fall through
    }
    return undefined
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href
  return undefined
}

export function parseDuckDuckGoHtml(html) {
  const results = []
  const seen = new Set()
  for (const match of html.matchAll(RESULT_LINK)) {
    const href = decodeHtmlEntities(match[1] ?? '')
    const title = stripHtml(match[2] ?? '')
    const url = resolveResultUrl(href)
    if (url === undefined || title.length === 0) continue
    if (seen.has(url)) continue
    seen.add(url)
    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 1200)
    const snippetMatch = RESULT_SNIPPET.exec(after)
    const snippet = snippetMatch !== null ? stripHtml(snippetMatch[1] ?? '') : ''
    results.push({
      url,
      title,
      ...(snippet.length > 0 ? { snippet } : {}),
    })
  }
  return results
}

export function mapDuckDuckGoResult(result) {
  return {
    url: result.url,
    title: result.title,
    ...(result.snippet !== undefined && result.snippet.length > 0 ? { snippet: result.snippet } : {}),
  }
}

export function mapDuckDuckGoResponse(results) {
  return {
    sources: results.map(mapDuckDuckGoResult),
    truncated: false,
  }
}

export function hasCaptchaMarker(html) {
  const lowered = html.toLowerCase()
  return CAPTCHA_MARKERS.some(marker => lowered.includes(marker.toLowerCase()))
}

export function isDuckDuckGoCaptcha(status, html) {
  if (status === 202) return true
  if (hasCaptchaMarker(html)) return true
  return false
}

export function buildChallengeUrl(baseURL, query) {
  const url = new URL(`${trimTrailingSlash(baseURL)}/html/`)
  url.searchParams.set('q', query)
  return url.href
}

export class DuckDuckGoSearchProvider {
  id = DUCKDUCKGO_PROVIDER_ID

  constructor(options) {
    this.options = options
  }

  available() {
    return URL.canParse(this.options.baseURL)
  }

  async search(request, signal) {
    const outcome = await this.dispatchSearch(request.query, signal)
    if (!outcome.captcha) return outcome.result

    const challengeUrl = buildChallengeUrl(this.options.baseURL, request.query)
    const decision = await this.resolveCaptcha(challengeUrl, request.query, signal)
    if (decision !== 'retry') {
      throw captchaError(challengeUrl)
    }

    const retry = await this.dispatchSearch(request.query, signal)
    if (retry.captcha) throw captchaError(challengeUrl)
    return retry.result
  }

  async resolveCaptcha(challengeUrl, query, signal) {
    const askCaptcha = this.options.askCaptcha
    if (askCaptcha === undefined) return 'unavailable'
    try {
      return await askCaptcha({ challengeUrl, query, signal })
    } catch {
      return 'unavailable'
    }
  }

  async dispatchSearch(query, signal) {
    const endpoint = `${trimTrailingSlash(this.options.baseURL)}/html/`
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'text/html',
          'user-agent': USER_AGENT,
        },
        body: new URLSearchParams({ q: query }).toString(),
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch (error) {
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`DuckDuckGo search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    let html
    try {
      html = await response.text()
    } catch (error) {
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(
        `DuckDuckGo returned an unprocessable response body: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    if (isDuckDuckGoCaptcha(response.status, html)) {
      return { captcha: true }
    }

    if (!response.ok) {
      throw new WebError(`DuckDuckGo API error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    }

    try {
      return { captcha: false, result: mapDuckDuckGoResponse(parseDuckDuckGoHtml(html)) }
    } catch (error) {
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(
        `DuckDuckGo returned an unprocessable response body: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
  }
}

export function apply(ctx, config) {
  ctx.web.registerSearchProvider(new DuckDuckGoSearchProvider({
    baseURL: config.baseURL ?? DUCKDUCKGO_DEFAULT_BASE_URL,
    askCaptcha: createAskCaptcha(ctx),
  }))
}

function createAskCaptcha(ctx) {
  return async ({ challengeUrl, signal }) => {
    const userQuestions = ctx.get('userQuestions')
    if (userQuestions === undefined) return 'unavailable'
    const agents = ctx.get('agents')
    const agent = agents?.currentInitiator?.()
    try {
      const answer = await userQuestions.ask({
        questions: [{
          id: 'ddg-captcha',
          header: 'DuckDuckGo verification',
          question:
            'DuckDuckGo blocked this search with a human verification challenge. Open the link below in your browser, complete the check, then choose an option.',
          detail: challengeUrl,
          options: [
            { label: CAPTCHA_RETRY_LABEL, description: 'Retry the search from DSH.' },
            { label: CAPTCHA_CANCEL_LABEL, description: 'Stop and return an error.' },
          ],
        }],
        ...(agent !== undefined ? { agent } : {}),
        ...(signal !== undefined ? { signal } : {}),
      })
      const selected = answer.answers?.[0]?.selected?.[0]
      if (selected === CAPTCHA_RETRY_LABEL) return 'retry'
      return 'cancel'
    } catch (error) {
      if (error?.code === 'ASK_CANCELLED') return 'cancel'
      return 'unavailable'
    }
  }
}

function captchaError(challengeUrl) {
  return new WebError(
    `DuckDuckGo blocked this search with a human verification challenge (not empty results). Open ${challengeUrl} in a browser, complete the duck puzzle, then retry the search from DSH.`,
    'WEB_PROVIDER_CAPTCHA',
  )
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
}
