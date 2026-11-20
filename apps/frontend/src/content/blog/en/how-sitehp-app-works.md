sitehp.app takes the address of a website and, a few seconds later, gives it a score from 0 to 100 with a short list of what to fix first. This post walks through what happens in between, for anyone who wants to know what the number is made of before trusting it.

## What a scan looks at

A scan looks at a site from the outside, the way a visitor, a search engine or an AI agent meets it. It does not log in, run the site's scripts or touch anything that is not public. Every check is small and answers one question, such as "does the site redirect plain `http` to `https`?" or "does the page have exactly one main heading?".

The checks fall into four areas today:

| Area      | What it asks                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------ |
| Security  | HTTPS and its certificate, security headers, cookie flags, mixed content                         |
| Speed     | Time to first byte, compression, caching, page weight, render-blocking resources                 |
| SEO       | Titles and descriptions, headings, canonical address, `robots.txt`, the sitemap, social previews |
| AI agents | Whether AI crawlers may read the site, and whether it offers them clean text such as `llms.txt`  |

Each check ends as a pass, a warning, a failure or skipped. Skipped is not a failure: a site without a sitemap is not judged on the sitemap's contents.

## From the address to the report

When you press Scan, the browser sends the address to the API:

```http
POST /v1/scans
Content-Type: application/json

{ "url": "https://example.com" }
```

The API checks the address, applies the rate limits (below), stores a new scan and puts it on a queue. It answers at once with the report's link, without waiting for the scan to run.

A separate worker process takes the scan from the queue. It fetches the page once, along with a few small files around it (`robots.txt`, the sitemap, a sample of scripts and stylesheets), and then runs every check on what it fetched. The page you watch fills in live: each finished check is sent to your browser as it happens, through a stream of server-sent events.

If the same address was scanned in the last ten minutes, you get that result back instead of a new scan. That keeps a popular site from being fetched again and again.

## How the score is made

Each check has a severity (critical, high, medium or low), and each area has a weight. A failure costs points in proportion to its severity, a warning costs less, and the area scores are combined by their weights into the HP score.

One rule overrides the arithmetic. A failed critical check, such as an untrusted certificate or a page that tells search engines not to index it, holds the score at 59 at most, however well the rest does. A site with a broken certificate is not "mostly fine".

The exact weights and every check are listed on the [How scoring works](/en/methodology) page, and the model has a version number that changes whenever the scoring does.

## Keeping the scanner safe

A tool that fetches any address a stranger types is a tempting thing to misuse. Three rules keep it honest:

- **Only the public internet.** Before every connection, and again after every redirect, the scanner checks that the address it is about to reach is public. Private networks, the machine's own address and cloud metadata services are refused.
- **Rate limits.** One address can start 20 scans an hour, and one domain can be scanned 10 times an hour, whoever asks. That stops anyone from using sitehp.app to flood a site.
- **A scanner that says what it is.** Every request carries the user agent `sitehp.app-scanner/1.0`, and the [website owners](/en/website-owners) page explains how to ask to be left out.

## What I keep

A report is reachable by anyone who has its link and is kept out of search engines. It is deleted 30 days after the scan. The query part of an address is hidden before anything is stored, because it can carry tokens. The details are in the [privacy policy](/en/privacy).

## What comes next

More checks are on the way: email and domain settings, privacy (trackers and consent banners) and a deeper speed measurement. Each one lands in the report and on the How scoring works page when it ships, never before.
