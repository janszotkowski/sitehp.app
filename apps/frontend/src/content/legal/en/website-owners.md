## 1. What visited your site {#what}

A person entered the address of your site on sitehp.app, and the sitehp.app scanner looked at it once from the outside, to give it a score. Every request it makes carries this user agent:

- `{{userAgent}}`

## 2. What it requests {#requests}

A scan makes about twenty ordinary requests, the kind a browser or a search engine makes:

- the page that was entered, and the same page once more asking for a Markdown version,
- the plain http address, to see that it redirects to https, and the variant with or without www,
- `/robots.txt`, `/llms.txt` and the sitemap (for a sitemap index, the first sitemap it lists), and up to three pages the sitemap lists,
- up to three scripts and stylesheets the page links on its own site, to see whether they are compressed and cached,
- five small files under `/.well-known/` (an API catalog, OAuth and OpenID metadata, an agent card), to see whether the site describes itself to AI agents,
- one made-up address, to see that a missing page answers with 404,
- the TLS certificate, by opening a secure connection.

## 3. What it never does {#never}

It does not log in, submit forms, run your scripts, follow links other than redirects and the ones above, or try to break in. It reads at most 1 MB of each answer and gives up after 10 seconds. It sends no cookies and stores none of yours.

## 4. How often {#limits}

One domain can be scanned at most 10 times an hour, from everyone together. If the same address was scanned in the last few minutes, the report already made is shown again and your site is not contacted.

## 5. robots.txt {#robots}

A scan is a single visit asked for by a person, not crawling, so the scanner does not follow `Disallow` rules; it reads your robots.txt to report on it. If you would rather not be scanned at all, ask for an exclusion below.

## 6. Excluding your site {#exclusion}

Write to me on {{contact}} and tell me how I can confirm you run it (for example a file or a DNS record I name), and I will stop scanning it, including its subdomains. Scans already made stay readable by their link until they expire after 30 days, unless you ask me to delete them too.

## 7. Something went wrong {#problems}

If the scanner caused you a problem, or a finding about your site is wrong, write to me on {{contact}} with the address and the time, and I will look at it.
