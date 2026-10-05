# Privacy policy — proposed changes (draft, 2026-09-29)

Not published. `app/privacy/page.tsx` is unchanged until Nate approves this text.
Why: the apply page scan found the policy describing a site without analytics,
fingerprinting or third-party processors, while the site used all three. The
code now matches the cookies page (analytics and fingerprinting only after
"Accept all"); these edits make the privacy policy say the same, and name
every processor that sees applicant or member data.

Each block: the current text, then the proposed replacement.

---

## Section 2 — What we collect (technical data)

**Current**

> - Browser type and device information (from standard HTTP headers)
>
> We do **not** use tracking pixels, advertising cookies, or third-party analytics scripts. We operate an internal analytics dashboard for operational purposes (e.g. event attendance trends) — this data is never shared externally.

**Proposed**

> - Browser type and device information (from standard HTTP headers)
> - Your browser's timezone, and — only if you accept all cookies — a device identifier derived from your browser's characteristics, used to spot duplicate or fraudulent applications
>
> We do **not** use tracking pixels or advertising cookies. If you choose "Accept all" on the cookie banner, we use PostHog (hosted in the EU) to understand how pages are used, including session recordings with everything you type masked. If you choose "Essential only", none of this runs. We also operate an internal analytics dashboard for operational purposes (e.g. event attendance trends) — this data is never shared externally.

## Section 3/4 — Automated decisions (keep, now true)

> We do **not** use your data for targeted advertising, profiling for commercial purposes, or automated decision-making that has legal or significant effects on you.

No change needed: the application form no longer auto-rejects anyone (the
same-network rule is now a flag a person reviews). Optionally add:

> Every membership application is decided by a person. To help our team review applications consistently, we may use an AI model (OpenAI) to summarise the answers you give; it never sees your name, email, phone number or photo, and it does not make the decision.

## Section 6 — Sharing your data (service providers)

**Current**

> - **Service providers:** We use Resend to deliver transactional emails. They process your email address solely to deliver messages on our behalf and are bound by data processing agreements.

**Proposed**

> - **Service providers**, each processing only what its job needs, under data processing terms:
>   - **Resend** — delivers our emails (your email address and the message).
>   - **Cloudflare Turnstile** — checks that an application or form is sent by a person, not a bot (your IP address and browser signals, at the moment you submit).
>   - **OpenAI** — helps our team review applications (your application answers, without your name, contact details or photo).
>   - **PostHog** (EU) — site analytics and session recordings, only if you accept all cookies.
>   - **FingerprintJS** (open-source library, runs in your browser; nothing is sent to FingerprintJS) — the device identifier described in section 2, only if you accept all cookies.

## Section 7 — Data retention

**Current**

> Application data from rejected or withdrawn applications is deleted after 12 months.
> Server logs containing IP addresses are retained for a maximum of 90 days for security purposes.

**Proposed**

> Rejected applications are deleted 12 months after the decision, together with the photo you uploaded.
> The IP address, browser details and device identifier recorded with an application are deleted 90 days after you apply. Server logs containing IP addresses are retained for a maximum of 90 days for security purposes.

⚠️ This is true only once the retention job runs (`app/api/cron/sweep-application-retention`,
built dry-run and not yet scheduled). Publish this section together with
scheduling it.

## Section 9 — Cookies

**Current**

> We use one essential cookie: a secure, httpOnly session cookie (`smileys_session`) … We do not use advertising cookies, social media tracking cookies, or third-party analytics cookies.

**Proposed**

> We use one essential cookie: a secure, httpOnly session cookie (`smileys_session`) that keeps you logged in for up to 7 days (renewed while you use the site). This cookie is strictly necessary for the platform to function and does not track you across other websites.
>
> If you choose "Accept all" on the cookie banner, PostHog also stores an analytics identifier in a cookie and your browser's storage. If you choose "Essential only", it doesn't. We do not use advertising or social media tracking cookies. Your choice is remembered in your browser; clear this site's data to see the banner again.

Also bump `LAST_UPDATED` when publishing.

## Section 2 — Application data (small correction)

**Current**: "time living in Istanbul" → **Proposed**: "time living in the city you apply to".
