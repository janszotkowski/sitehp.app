# Security policy

This policy is about vulnerabilities **in sitehp.app itself**: the code in this repository and the service built from it.

A problem that sitehp.app finds on a site you scanned is not a sitehp.app issue: it belongs to the owner of that site. If a check judged a site wrongly, open a [wrong result issue](https://github.com/janszotkowski/sitehp.app/issues/new?template=wrong_result.yml).

## Supported versions

Only the latest commit on `main` is supported; there are no maintained release branches. Fixes land on `main` and are deployed from there.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub instead: on the repository page, open **Security → Report a vulnerability** ([direct link](https://github.com/janszotkowski/sitehp.app/security/advisories/new)). Please include:

- what is affected (an endpoint, a page, the scanner, the worker, the Docker images)
- steps or a proof of concept that reproduces it
- the impact you expect, and anything you know about a fix

## What to expect

- An acknowledgement within 7 days.
- An assessment, and a plan or a question, within 14 days.
- A fix as soon as it is ready, then a published advisory that credits you, unless you prefer not to be named.

This is a volunteer project without a bug bounty. Good-faith research that respects users' privacy, does not degrade the service for others (no load testing or denial of service against a public deployment) and gives us reasonable time to fix the problem before disclosure is welcome. We will not pursue it.

## Scope notes

- **The scanner fetches addresses that people type in, so server-side request forgery is the main risk and the most valuable finding.** Only public addresses may be reached: the address is checked inside the connection's own DNS lookup (no gap for DNS rebinding), a host with even one internal address is refused, and every redirect hop is checked again. A way past any of this is in scope.
- Scans are passive: about twenty ordinary `GET` requests per site (the page, a few site and well-known files, a sample of the sitemap), with no cookies or credentials and a fixed User-Agent. The site's "For website owners" page lists them. The scanner never probes for vulnerabilities, so a report about a site being scanned at all is not a finding.
- A report is public to anyone who has its link; its id is 128 random bits. Reports are `noindex` and hold no cookie values or response bodies. Reading a report you have the link to is not a finding; guessing or listing other people's reports is.
- `POST /v1/scans` is rate limited per caller and per domain. A way around the limits that lets one caller make the service flood a third-party site is in scope.
- Dependencies are pinned exactly and must be at least 7 days old before they can be installed (`minimumReleaseAge` in `pnpm-workspace.yaml`). Reports about a vulnerable dependency are welcome when the vulnerable code path is reachable here.
