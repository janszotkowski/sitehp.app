## 1. Who is responsible {#controller}

sitehp.app is run by {{controller}}, the controller of the personal data described here. Write to me on {{contact}} about anything on this page.

## 2. In short {#summary}

sitehp.app needs no account and sets no cookies. It uses no analytics, advertising or tracking tools and loads nothing from other companies’ servers. What I keep is about websites, not about you:

- a report of each scan, readable by anyone who has its link, deleted after 30 days,
- a list of the domains people have asked me to scan, with counts and the latest score, kept for good,
- your IP address only briefly, for the rate limits that stop the scanner from being misused.

## 3. When you scan a website {#scan}

I store the address you entered and the report: the score, the findings and what the scanner observed on that site, including the response headers it received (without cookies) and short excerpts of the page: its title, description, main heading, viewport setting and canonical address. Cookies the scanned site sends are judged, but their values are never stored. Values in the query part of the address (after `?`) are replaced with `…` before anything is stored, because they can contain tokens.

A report is reachable by anyone who has its link, and kept out of search engines. It is deleted together with its log 30 days after the scan.

Separately, I keep a list of the domains people have asked me to scan: the domain name only (no page address, no query, nothing about who asked), when it was first and last asked for, how many requests and scans there were, and the latest score. I keep it for good, to understand how the service is used and to protect it and the scanned sites from misuse. A domain name is usually not personal data; if yours names you and you want it removed, write to me.

The legal basis is my legitimate interest in providing the service you asked for and in keeping it safe (Art. 6(1)(f) GDPR).

## 4. Your IP address {#ip-address}

Each scan makes my server visit somebody else’s website, so I limit how many scans one address can start. To count them, your IP address (for IPv6, also the /64 and /48 networks it belongs to) is the key of a counter in my rate-limit store, kept for the length of the limit window, one hour, and then deleted. While a live report is open, I also count the open connections per address.

A scan request you repeat within ten minutes is recognised by your address, the address you scanned and a random key your browser sends, kept for those ten minutes.

Your IP address is not written to my logs and is never stored with a report. The legal basis is my legitimate interest in protecting the service and the websites it scans from abuse (Art. 6(1)(f) GDPR).

## 5. Operational logs {#logs}

To run and secure the service, the server logs each request: the time, the kind of request, which part of the site was asked for (report links shortened so they cannot be reused), the result and how long it took, and the browser’s self-description (user agent). For a scan, only the name of the scanned site and the length of the address are logged, never the full address or what you typed.

Logs are kept only as long as needed to run and secure the service, and no longer than 30 days.

## 6. When you write to me {#email}

If you write to me, I use your contact details and message only to answer you and deal with your request. The legal basis is my legitimate interest in answering you, or steps you ask for before a contract (Art. 6(1)(b) and (f) GDPR). I keep the conversation for as long as it takes to handle it, and no longer than 12 months after the last contact unless a contract follows.

## 7. Who else handles the data {#recipients}

I do not sell data or pass it to anyone for their own purposes. My hosting provider processes it on my behalf under a contract, as a processor. I prefer providers in the European Economic Area; if a provider is outside it, I rely on a lawful transfer mechanism such as the European Commission’s standard contractual clauses.

The service is hosted by Hetzner Online GmbH (Germany, [hetzner.com](https://www.hetzner.com)). The service’s server, database and logs run in its data centre in the European Union, so no data leaves the European Economic Area.

## 8. No decisions about you {#decisions}

The score describes a website, not a person. I make no automated decisions about you and build no profile of you.

## 9. Your rights {#rights}

You have the right to access the personal data I hold about you, to have it corrected or erased, to restrict its processing, to data portability, and to object to processing based on my legitimate interest. Send a request on {{contact}}; I answer within one month.

If you believe I break the rules, you can lodge a complaint with the Czech Office for Personal Data Protection (Úřad pro ochranu osobních údajů, Pplk. Sochora 27, 170 00 Prague 7, [uoou.gov.cz](https://uoou.gov.cz)).

## 10. Changes {#changes}

When this policy changes in substance, I update the date at the top of the page.
