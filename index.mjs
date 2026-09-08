/**
 * DuckDuckGo web search provider for DeepSeek Harness (DSH).
 * Registers on ctx.web; uses the public HTML results page (no API key).
 */

import { randomUUID } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { WebError } from '@deepseek-ai/dsh-web'

export const name = 'web-search-duckduckgo'
export const inject = ['web']

export const DUCKDUCKGO_PROVIDER_ID = 'duckduckgo'
export const DUCKDUCKGO_DEFAULT_BASE_URL = 'https://html.duckduckgo.com'

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

const BRIDGE_SCRIPT = `(function(){
if(globalThis.__DSH_DDG_CAPTCHA_BRIDGE__)return;
globalThis.__DSH_DDG_CAPTCHA_BRIDGE__=true;
var root=null;
function closeOverlay(id){
if(!root)return;
if(id&&root.getAttribute("data-id")!==id)return;
root.remove();
root=null;
}
function openOverlay(id,url){
closeOverlay();
root=document.createElement("div");
root.setAttribute("data-id",id);
root.setAttribute("style","position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;");
var panel=document.createElement("div");
panel.setAttribute("style","position:relative;width:min(560px,100%);height:min(720px,92vh);background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.35);display:flex;flex-direction:column;");
var bar=document.createElement("div");
bar.setAttribute("style","display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;font:600 14px/1.3 system-ui,sans-serif;border-bottom:1px solid #e5e5e5;color:#111;");
var title=document.createElement("span");
title.textContent="DuckDuckGo verification";
var cancel=document.createElement("button");
cancel.type="button";
cancel.textContent="Cancel";
cancel.setAttribute("style","font:500 13px system-ui,sans-serif;padding:6px 10px;cursor:pointer;");
cancel.onclick=function(){
fetch("/ddg-captcha/"+id+"/cancel",{method:"POST"}).catch(function(){});
closeOverlay(id);
};
bar.appendChild(title);
bar.appendChild(cancel);
var iframe=document.createElement("iframe");
iframe.src=url;
iframe.setAttribute("title","DuckDuckGo verification");
iframe.setAttribute("style","flex:1;border:0;width:100%;background:#fff;");
panel.appendChild(bar);
panel.appendChild(iframe);
root.appendChild(panel);
document.documentElement.appendChild(root);
}
function connect(){
var es=new EventSource("/ddg-captcha/events");
es.onmessage=function(ev){
try{
var msg=JSON.parse(ev.data);
if(msg.type==="open")openOverlay(msg.id,msg.url);
if(msg.type==="close")closeOverlay(msg.id);
}catch(e){}
};
es.onerror=function(){
es.close();
setTimeout(connect,2000);
};
}
connect();
})();`

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

export function extractAnomalySubmitUrl(html) {
  const match = html.match(/action=(["'])((?:https?:)?\/\/[^"']*anomaly\.js[^"']*)\1/i)
    ?? html.match(/action=(["'])([^"']*anomaly\.js[^"']*)\1/i)
  if (match === null) return undefined
  const href = match[2]
  if (href.startsWith('//')) return `https:${href}`
  if (href.startsWith('http://') || href.startsWith('https://')) return href
  return `https://duckduckgo.com${href.startsWith('/') ? href : `/${href}`}`
}

export function rewriteCaptchaHtml(html, assetOrigin = DUCKDUCKGO_DEFAULT_BASE_URL, submitPath) {
  const origin = trimTrailingSlash(assetOrigin)
  let out = html
  out = out.replace(/(href|src|action)=(["'])\/\//gi, '$1=$2https://')
  out = out.replace(/(href|src)=(["'])\.\.\//gi, `$1=$2${origin}/`)
  out = out.replace(/(href|src)=(["'])\/(?!\/)/gi, `$1=$2${origin}/`)
  if (submitPath !== undefined) {
    out = out.replace(/action=(["'])[^"']*anomaly\.js[^"']*\1/gi, `action=$1${submitPath}$1`)
  }
  if (!/<base\s/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/html/">`)
  }
  return out
}

export function parseSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = headers.get('set-cookie')
  return single === null ? [] : [single]
}

export function mergeCookieJar(jar, setCookieHeaders) {
  const next = new Map(jar)
  for (const header of setCookieHeaders) {
    const pair = header.split(';', 1)[0] ?? ''
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (name.length === 0) continue
    next.set(name, value)
  }
  return next
}

export function serializeCookieJar(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

export async function proxyAnomalySubmit(targetUrl, body, cookieHeader, signal) {
  let url = targetUrl
  let method = 'POST'
  let currentBody = body
  let jar = new Map()
  if (cookieHeader !== undefined && cookieHeader.length > 0) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=')
      if (eq <= 0) continue
      jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
    }
  }

  for (let hop = 0; hop < 6; hop += 1) {
    const cookie = serializeCookieJar(jar)
    let response
    try {
      response = await fetch(url, {
        method,
        redirect: 'manual',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...(cookie.length > 0 ? { cookie } : {}),
        },
        ...(method === 'POST' ? { body: currentBody } : {}),
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch (error) {
      if (isAbortError(error)) throw error
      throw new WebError(`DuckDuckGo captcha submit failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    jar = mergeCookieJar(jar, parseSetCookieHeaders(response.headers))

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location === null || location.length === 0) break
      url = new URL(location, url).href
      method = 'GET'
      currentBody = undefined
      continue
    }

    const html = await response.text()
    return {
      status: response.status,
      html,
      cookieHeader: serializeCookieJar(jar),
    }
  }

  throw new WebError('DuckDuckGo captcha submit redirected too many times', 'WEB_PROVIDER_ERROR')
}

export function cookieJarFromHeader(header) {
  const jar = new Map()
  if (header === undefined || header.length === 0) return jar
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
  }
  return jar
}

export function createCaptchaHost(webServer, { onIndexInject } = {}) {
  if (webServer === undefined || webServer === null) return undefined

  const sessions = new Map()
  const sseClients = new Set()
  let cookieJar = new Map()
  const disposers = []

  const broadcast = (message) => {
    const payload = `data: ${JSON.stringify(message)}\n\n`
    for (const client of sseClients) {
      try {
        client.write(payload)
      } catch {
        sseClients.delete(client)
      }
    }
  }

  const publicOrigin = () => {
    const host = webServer.host === '0.0.0.0' ? '127.0.0.1' : webServer.host
    return `http://${host}:${webServer.port}`
  }

  try {
    disposers.push(webServer.register({
      kind: 'prefix',
      path: '/ddg-captcha',
      handler(req, res) {
        void handleCaptchaHttp(req, res)
      },
    }))
  } catch {
    return undefined
  }

  if (typeof onIndexInject === 'function') {
    disposers.push(onIndexInject((table) => {
      table.push({ kind: 'script', placement: 'body', text: BRIDGE_SCRIPT })
    }))
  }

  async function readRequestBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    return Buffer.concat(chunks)
  }

  async function handleCaptchaHttp(req, res) {
    const url = new URL(req.url ?? '/', 'http://dsh.local')
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts.length === 2 && parts[1] === 'events' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.write(': connected\n\n')
      sseClients.add(res)
      req.on('close', () => { sseClients.delete(res) })
      return
    }

    const id = parts[1]
    const action = parts[2]
    const session = id !== undefined ? sessions.get(id) : undefined

    if (session === undefined || id === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }

    if (action === undefined && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': session.body.length,
      })
      res.end(session.body)
      return
    }

    if (action === 'cancel' && req.method === 'POST') {
      session.reject(captchaCancelledError())
      res.writeHead(204)
      res.end()
      return
    }

    if (action === 'submit' && req.method === 'POST') {
      try {
        const body = await readRequestBody(req)
        const proxied = await proxyAnomalySubmit(
          session.targetUrl,
          body.toString('utf8'),
          serializeCookieJar(cookieJar),
          session.signal,
        )
        cookieJar = cookieJarFromHeader(proxied.cookieHeader)

        session.resolve({
          cookieHeader: serializeCookieJar(cookieJar),
          resultHtml: proxied.html,
          status: proxied.status,
        })
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end('<!doctype html><html><body style="font:14px system-ui;padding:24px">Verification submitted. You can close this panel.</body></html>')
      } catch (error) {
        session.reject(error)
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('captcha submit failed')
      }
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }

  return {
    getCookieHeader() {
      return serializeCookieJar(cookieJar)
    },
    ingestSetCookies(headers) {
      cookieJar = mergeCookieJar(cookieJar, headers)
    },
    async awaitChallenge({ html, signal, assetOrigin = DUCKDUCKGO_DEFAULT_BASE_URL }) {
      const targetUrl = extractAnomalySubmitUrl(html)
      if (targetUrl === undefined) throw captchaBlockedError()

      const id = randomUUID()
      const submitPath = `/ddg-captcha/${id}/submit`
      const pageHtml = rewriteCaptchaHtml(html, assetOrigin, submitPath)
      const body = Buffer.from(pageHtml, 'utf8')
      const pageUrl = `${publicOrigin()}/ddg-captcha/${id}`

      const completion = Promise.withResolvers()
      const session = {
        body,
        targetUrl,
        signal,
        resolve: completion.resolve,
        reject: completion.reject,
      }
      sessions.set(id, session)
      broadcast({ type: 'open', id, url: pageUrl })

      const onAbort = () => {
        completion.reject(new DOMException('aborted', 'AbortError'))
      }
      if (signal !== undefined) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }

      try {
        return await completion.promise
      } finally {
        if (signal !== undefined) signal.removeEventListener('abort', onAbort)
        sessions.delete(id)
        broadcast({ type: 'close', id })
      }
    },
    dispose() {
      for (const dispose of disposers.splice(0)) {
        try { dispose() } catch { /* ignore */ }
      }
      for (const client of sseClients) {
        try { client.end() } catch { /* ignore */ }
      }
      sseClients.clear()
      for (const session of sessions.values()) {
        try { session.reject(captchaCancelledError()) } catch { /* ignore */ }
      }
      sessions.clear()
    },
  }
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

    const captchaHost = resolveCaptchaHost(this.options)
    if (captchaHost === undefined) throw captchaBlockedError()

    let completion
    try {
      completion = await captchaHost.awaitChallenge({
        html: outcome.html,
        signal,
        assetOrigin: this.options.baseURL,
      })
    } catch (error) {
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      if (error instanceof WebError) throw error
      throw captchaBlockedError()
    }

    if (
      completion.resultHtml !== undefined
      && !isDuckDuckGoCaptcha(completion.status ?? 200, completion.resultHtml)
    ) {
      const parsed = parseDuckDuckGoHtml(completion.resultHtml)
      if (parsed.length > 0) return mapDuckDuckGoResponse(parsed)
    }

    const retry = await this.dispatchSearch(request.query, signal)
    if (retry.captcha) throw captchaBlockedError()
    return retry.result
  }

  async dispatchSearch(query, signal) {
    const endpoint = `${trimTrailingSlash(this.options.baseURL)}/html/`
    const cookie = resolveCaptchaHost(this.options)?.getCookieHeader?.() ?? ''
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'text/html',
          'user-agent': USER_AGENT,
          ...(cookie.length > 0 ? { cookie } : {}),
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

    const setCookies = parseSetCookieHeaders(response.headers)
    const host = resolveCaptchaHost(this.options)
    if (setCookies.length > 0 && host?.ingestSetCookies !== undefined) {
      host.ingestSetCookies(setCookies)
    }

    if (isDuckDuckGoCaptcha(response.status, html)) {
      return { captcha: true, html }
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
  const baseURL = config.baseURL ?? DUCKDUCKGO_DEFAULT_BASE_URL
  const hostSlot = { host: undefined }

  ctx.web.registerSearchProvider(new DuckDuckGoSearchProvider({
    baseURL,
    getCaptchaHost: () => hostSlot.host,
  }))

  ctx.inject(['webServer'], (webCtx) => {
    const captchaHost = createCaptchaHost(webCtx.webServer, {
      onIndexInject: (push) => webCtx.on('webserver/index-inject', push),
    })
    if (captchaHost === undefined) return
    hostSlot.host = captchaHost
    webCtx.effect(() => () => {
      if (hostSlot.host === captchaHost) hostSlot.host = undefined
      captchaHost.dispose()
    }, 'web-search-duckduckgo: captcha host')
  })
}

function resolveCaptchaHost(options) {
  if (typeof options.getCaptchaHost === 'function') return options.getCaptchaHost()
  return options.captchaHost
}

function captchaBlockedError() {
  return new WebError(
    'DuckDuckGo blocked this search with a human verification challenge.',
    'WEB_PROVIDER_CAPTCHA',
  )
}

function captchaCancelledError() {
  return new WebError(
    'DuckDuckGo verification was cancelled.',
    'WEB_PROVIDER_CAPTCHA',
  )
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
}
