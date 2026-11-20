# Checks and scoring

sitehp.app looks at a site from the outside, the way a visitor, a search engine and an AI crawler see it. It never logs in, never sends a form and never probes for vulnerabilities. This page lists every check and explains how their results become the HP score. The same rules are explained in plain language on the site's methodology page.

## How a scan runs

1. **The address is checked.** Only `http` and `https` are accepted, and the host must resolve to public addresses only: an address on a private or internal network is refused, and so is every redirect that leads to one. Some top-level domains and domains can be blocked by configuration (see [Configuration](CONFIGURATION.md)).
2. **The site is fetched once, plus a few files.** The page itself (following up to 5 redirects, at most 1 MB, 10 seconds), its TLS certificate, a probe of the plain `http://` address, `robots.txt`, the sitemap and a small sample of its addresses, a made-up address to see how missing pages answer, and the well-known files that AI agents look for. No cookies, no credentials, a fixed User-Agent.
3. **Every check runs on what came back.** A check is a pure function: it reads the fetched page and files and returns a result. One check failing to run never fails the scan; it is marked `skipped` with a reason.
4. **The score is computed** from the results, and updated live after every check.

When the same address was scanned in the last 10 minutes, that report is returned instead of a new scan; **Scan again** asks for a fresh one.

## Results

Every check ends in one of four states:

| Status    | Meaning                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `pass`    | The site does what it should.                                                                             |
| `warn`    | It works, but something should be improved. Loses half of the check's points.                             |
| `fail`    | The problem is there. Loses all of the check's points.                                                    |
| `skipped` | The check could not run or does not apply (no certificate to read, a page cut off). It does not count.    |

Every result carries its **evidence** (the header, value or element it judged), a **severity** and an **effort** (minutes, hours or days), so the report can rank the fixes by how many HP each one brings back for the work it takes.

## How the score works

The HP is a number from 0 to 100, computed in one pure function (`packages/core/src/scan/score.ts`).

1. **Each severity has a weight**: critical 8, high 5, medium 3, low 1.
2. **Each category gets a score** from 0 to 100: the share of its weighted points that were kept. A failure loses all of a check's weight, a warning half. Skipped checks are left out.
3. **The categories are averaged by weight**: security 40, SEO 30, speed 15, agent readiness 10. A category with no check that ran is left out and the others share its weight, so an area that could not be judged never lowers the score.
4. **A failed critical check holds the HP at 59 at most**, the top of the "poor" band, however well the rest does. The critical checks are: the page answers with an error, the site is on plain http only, the certificate is not trusted, or the page is kept out of search (`noindex` or blocked in `robots.txt`).
5. **A site that turns the scanner away** (401, 403 or 429 on the page itself) gets no score at all: what ran would say nothing about the site.

While a scan runs, the score is marked as preliminary. Every stored report keeps the version of the score model it was computed with (`SCORE_MODEL_VERSION`), and scores compare only within one version.

| HP     | Band      |
| ------ | --------- |
| 95–100 | Excellent |
| 80–94  | Good      |
| 60–79  | Fair      |
| 40–59  | Poor      |
| 0–39   | Critical  |

## Every check

There are 57 checks in four categories. Each one has a full plain-language explanation and a fix guide in the report.

### Security (16)

| Check | Id | Group | Severity | Effort | What it looks at |
| --- | --- | --- | --- | --- | --- |
| HTTPS | `https_scheme` | HTTPS and certificate | critical | hours | HTTPS locks the connection between your visitors and your site, shown as the padlock in the address bar. |
| Redirect to HTTPS | `http_redirect` | HTTPS and certificate | high | minutes | Someone who types your address without https, or follows an old link, should be sent to the secure version automatically. |
| Certificate | `cert_valid` | HTTPS and certificate | critical | hours | The certificate proves to browsers that the site really is yours and keeps the connection private. |
| Certificate expiry | `cert_expiry` | HTTPS and certificate | high | minutes | Certificates have to be renewed before they run out. |
| HSTS | `hsts` | Security headers | high | minutes | This tells browsers to always open your site over the secure connection, even if someone types or clicks a plain http link. |
| Content Security Policy | `csp` | Security headers | medium | hours | A content security policy lists the places your site may load scripts from, so a script an attacker slips in, for example through a plugin, does not run. |
| Clickjacking protection | `x_frame_options` | Security headers | medium | minutes | This stops other websites from showing your site inside an invisible frame, by an X-Frame-Options header or a frame-ancestors rule in the content security policy. |
| Content type sniffing | `x_content_type_options` | Security headers | low | minutes | This tells browsers to treat each file exactly as the type your server says it is. |
| Referrer policy | `referrer_policy` | Security headers | low | minutes | When a visitor clicks a link to another site, the browser tells that site which page they came from. |
| Permissions policy | `permissions_policy` | Security headers | low | minutes | This switches off browser features your site does not use, such as the camera, microphone or location. |
| Cross-Origin Opener Policy | `coop` | Security headers | low | minutes | This keeps a page that another site opened from reaching back into yours. |
| Software disclosure | `info_leak` | Security headers | low | minutes | Some servers announce which software and version they run in every response. |
| Cookies: Secure | `cookie_secure` | Cookies | high | minutes | Cookies remember things such as a logged-in customer, and the Secure flag keeps them off unencrypted connections. |
| Cookies: HttpOnly | `cookie_httponly` | Cookies | medium | minutes | The HttpOnly flag hides a cookie from scripts running on the page. |
| Cookies: SameSite | `cookie_samesite` | Cookies | low | minutes | The SameSite flag stops other websites from sending your cookies along with their own requests. |
| Mixed content | `mixed_content` | Page content | high | hours | A secure page that loads a script, style or frame over plain http is only as safe as that one file. |

### SEO (25)

| Check | Id | Group | Severity | Effort | What it looks at |
| --- | --- | --- | --- | --- | --- |
| Page status | `http_status` | Page basics | critical | hours | The page should answer with a success code. |
| Page title | `seo_title` | Page basics | high | minutes | The page title is the clickable headline in search results and the text on the browser tab. |
| Meta description | `meta_description` | Page basics | medium | minutes | This is the short text shown under your title in search results, your two-line advert. |
| Main heading (H1) | `h1` | Page basics | medium | minutes | The main heading tells visitors and search engines what the page is about, at a glance. |
| Mobile viewport | `viewport` | Page basics | high | minutes | This tells phones to fit the page to the screen. |
| Page language | `html_lang` | Page basics | low | minutes | This states the language the page is written in. |
| Canonical address | `canonical` | Search visibility | medium | minutes | This names the one official address of a page. |
| Allowed in search | `noindex` | Search visibility | critical | minutes | A noindex instruction tells Google not to list the page at all. |
| Social sharing preview | `open_graph` | Social sharing | medium | minutes | These tags set the title, text and picture shown when someone shares your link on Facebook, LinkedIn, WhatsApp or Slack. |
| Social sharing details | `open_graph_quality` | Social sharing | low | minutes | Beyond the title, text and picture, a few more tags make a shared link look finished: what kind of page it is, your site's name, its language, a description of the picture for people who cannot see it, and a picture address starting with https:// that apps can fetch. |
| X (Twitter) card | `twitter_card` | Social sharing | low | minutes | This controls how your link looks when it is shared on X. |
| Heading order | `heading_order` | Page basics | low | minutes | Headings should step down one level at a time, like chapters and sections in a book. |
| Image descriptions | `img_alt` | Page basics | medium | minutes | Each image needs a short text description. |
| Image sizes | `img_dimensions` | Page basics | low | minutes | When an image says how wide and tall it is, the browser keeps space for it before it loads. |
| Favicon | `favicon` | Page basics | low | minutes | The favicon is the small icon on browser tabs, in bookmarks and next to your site in some search results. |
| Structured data | `json_ld` | Page basics | low | minutes | Structured data describes the page in a form search engines read directly, such as a product with its price or your company, and can earn richer search results. |
| Language versions | `hreflang` | Search visibility | low | minutes | If your site exists in several languages, these links tell search engines which version to show to whom, for example Czech to people in Czechia. |
| robots.txt | `robots_txt` | Site files | medium | minutes | robots.txt is a small file that tells search engines which parts of the site they may visit. |
| Page allowed in robots.txt | `robots_allows_page` | Search visibility | critical | minutes | The rules in robots.txt must let search engines fetch this page. |
| Sitemap | `sitemap_xml` | Site files | medium | minutes | A sitemap is a list of the pages you want search engines to find. |
| Sitemap in robots.txt | `sitemap_in_robots` | Site files | low | minutes | Naming your sitemap in robots.txt is the one place every search engine looks for it, with no account or setup needed. |
| Sitemap addresses | `sitemap_urls` | Site files | medium | minutes | The pages your sitemap lists should open normally. |
| Redirects | `redirect_chain` | Search visibility | medium | minutes | An old address should lead to the page in one or two jumps, such as from http to https and then to the www or bare name. |
| Missing pages return 404 | `soft_404` | Search visibility | medium | minutes | A page that does not exist should say so with the error code 404. |
| One address for the site | `canonical_host` | Search visibility | medium | minutes | Your site should open under one name only, for example always with www or always without, with the other sending visitors over. |

### Agent readiness (8)

| Check | Id | Group | Severity | Effort | What it looks at |
| --- | --- | --- | --- | --- | --- |
| llms.txt for AI agents | `llms_txt` | Readable by agents | low | minutes | llms.txt is a short file that gives AI assistants such as ChatGPT or Claude an overview of your site and links to its most useful pages. |
| Markdown version of your pages | `markdown_negotiation` | Readable by agents | low | hours | Web pages carry menus, scripts and styling that AI agents have to wade through. |
| AI crawlers allowed in robots.txt | `ai_crawlers` | AI crawler access | medium | minutes | AI search tools and assistants send their own robots to read your pages when someone asks about you. |
| Content in the HTML | `content_in_html` | Readable by agents | high | days | Most AI agents, and some search robots, read the page your server sends without running its scripts. |
| Agent links in the Link header | `link_headers` | Agent discovery | low | minutes | The Link header of a page can point an agent to your API catalog, your service description or your documentation (RFC 8288). |
| API catalog | `api_catalog` | Agent discovery | low | hours | An API catalog at /.well-known/api-catalog (RFC 9727) is a JSON list that tells an agent which APIs your site offers and where they are described. |
| OAuth protected resource metadata | `oauth_resource` | Agent discovery | low | hours | A protected resource can say which authorization server an agent should use to get access to it, at /.well-known/oauth-protected-resource (RFC 9728). |
| A2A agent card | `a2a_agent_card` | Agent discovery | low | hours | An Agent Card at /.well-known/agent-card.json tells other agents what your own agent can do, using the A2A protocol. |

### Speed (8)

| Check | Id | Group | Severity | Effort | What it looks at |
| --- | --- | --- | --- | --- | --- |
| Server response time | `ttfb` | Server speed | medium | hours | How long the server takes to start sending the page, measured from the sitehp.app server. |
| Text compression | `compression` | Server speed | medium | minutes | Servers can shrink HTML, CSS and JavaScript before sending them, usually to a quarter of their size. |
| Browser caching of files | `cache_headers` | Server speed | low | minutes | Stylesheets and scripts rarely change, so a browser can keep them instead of downloading them on every visit. |
| HTTP version | `http_version` | Server speed | low | minutes | HTTP/2 and HTTP/3 send many files at once over one connection, while HTTP/1.1 makes the browser wait in line or open several. |
| Page weight | `page_weight` | Page weight | low | hours | A heavy page takes long to load on a phone. |
| Render-blocking files | `render_blocking` | Page weight | low | hours | A script in the head without async or defer makes the browser stop and download it before showing anything. |
| Modern image formats | `image_formats` | Page weight | low | hours | WebP and AVIF pictures are often less than half the size of the same JPEG or PNG. |
| Lazy loading of images | `lazy_loading` | Page weight | low | minutes | Images far down the page need not load until the visitor scrolls near them; loading="lazy" does that with one attribute. |

## What is not checked

- **Nothing active.** No vulnerability scanning, no guessing of passwords or paths, no forms, no load. A check reads only what any visitor's browser would receive.
- **No JavaScript is run.** The scanner reads the HTML the server sends. A site that draws its content in the browser is judged on what arrives before that (which is also what most AI agents and some search robots see).
- **One page.** The scan judges the address you enter and the site-wide files around it, not every page of the site.
