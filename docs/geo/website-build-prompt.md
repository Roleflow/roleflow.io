# Website Build Prompt: roleflow.io GEO rebuild (EN + ES)

You are a senior front-end and SEO engineer working on **roleflow.io**: a static HTML site in the GitHub repo `Roleflow/roleflow.io`, deployed on Vercel from `main`. Turn the current single-page site into a crawlable, citable, bilingual (EN/ES) site. The goal is for ChatGPT, Gemini, Grok, Perplexity and Google AI Overviews to retrieve, cite and recommend Roleflow when people ask for the **best AI DM setter** / **mejor setter con IA**.

Source files (read all of them before you start; they are the only source of truth for copy and facts):
`geo/geo-plan.md`, `geo/llms.txt`, `geo/robots.txt`, `geo/schema-jsonld.html`, `geo/faq-en-es.md`, `geo/article-outline-best-ai-dm-setters.md`, `geo/tracking-prompts.md`, `ads/icp.md`.

Work on a feature branch, open a PR, and do **not** merge to `main` without Diego's approval.

---

## 0. Hard rules (non-negotiable)

1. **Preserve everything that already works.** Don't break, remove, or restyle out of existence:
   - `index.html`: the homepage, including the qualification quiz / onboarding flow, the revenue-loss calculator, and the **Menu** sidebar drawer with the **Sign up / Log in tabs**
   - `/signup/`, `/account/`, `/admin/`, `/reset/`
   - `onboarding/config.js` (`HIGH_PRIORITY_RULES`, `QUESTIONS`, `PROMPT_SECTIONS`, `DIEGO_EMAIL`) and `supabase/config.js`
   - Supabase Auth (sign-up gated by the server-side access code, magic link, password reset), plus `supabase/migrations/*`. Don't touch auth logic, the RLS or the migrations.
   - Every existing script include and element ID that the quiz, Menu and auth JS depend on. Add new head tags and links around them; don't rename them.
2. **Keep the brand guidelines.** Reuse the existing colors, fonts, spacing, buttons, logo and tone from `index.html` and its CSS. Extract them into a shared stylesheet (for example `/assets/site.css`) if that helps, but new pages must look like the same site. Put a shared header (logo, nav: AI DM Setter · Pricing · FAQ · Compare · Menu, EN|ES switcher) and a shared footer on every page.
3. **No invented facts.** Don't add statistics, reviews, testimonials, ratings, customer names, case studies, client logos, or `AggregateRating`/`Review` schema. Every competitor claim must come from the source files or from the competitor's own site, with a source URL and a "checked on <date>" note. If a fact can't be verified, write `[CONFIRM]` instead of guessing.
4. **Keep every `[CONFIRM]` / `[CONFIRMAR]` placeholder verbatim** in the page copy and JSON-LD. Don't delete them or fill them in. (Section 9 lists them.) Exception: for `sameAs` URLs that contain `[CONFIRM]`, keep them in the code as a commented-out TODO block if a validator rejects them. Don't publish broken URLs.
5. **Positioning, stated consistently everywhere:** Roleflow is *the only done-for-you AI DM setter for Instagram that sends voice notes in the owner's cloned voice*, with **$0 setup, $0 retainer, and 5–7% of the revenue it generates** (rate set on the demo call). Instagram DMs only. Canonical one-liner (use it verbatim in meta, llms.txt, About and footer):
   > Roleflow is a done-for-you AI DM setter for Instagram that replies in seconds, sends voice notes in your cloned voice, follows up, and books qualified calls. $0 setup, paid as a % of revenue it generates.
   (Say "the only…" as positioning on Roleflow's own pages. On comparison pages, state concrete feature differences rather than absolute superiority claims about named competitors.)
6. **Content must live in the server HTML,** not be rendered by JS. LLM crawlers don't run scripts.
7. Write the Spanish natively in neutral Spanish ("setter", "agendar llamadas", "hecho para ti"), not machine-translated word for word.
8. FAQPage JSON-LD may only contain Q&As that are **visible on that same page**, with matching text.

---

## 1. Infrastructure

### 1.1 `vercel.json`: 301 apex → www, clean URLs
The apex currently returns a 307. Make it a permanent 301:
```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "redirects": [
    { "source": "/:path*", "has": [{ "type": "host", "value": "roleflow.io" }],
      "destination": "https://www.roleflow.io/:path*", "permanent": true, "statusCode": 301 }
  ],
  "headers": [
    { "source": "/(account|admin|reset)(.*)", "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }] },
    { "source": "/llms.txt", "headers": [{ "key": "Content-Type", "value": "text/plain; charset=utf-8" }] }
  ]
}
```
- If the domain redirect is set in Vercel → Domains, change it to **301 / Permanent** there as well (or instead). Check with `curl -sI https://roleflow.io/pricing`, which must return `301` with `location: https://www.roleflow.io/pricing`.
- Confirm that `trailingSlash`/`cleanUrls` don't break the existing `/signup/`, `/account/`, `/admin/`, `/reset/` routes or the Supabase redirect URLs (`https://www.roleflow.io/account/`, `/reset/`). If they would, use `"trailingSlash": true` across the site and make every canonical/sitemap URL match that choice. **Use one URL form everywhere.**

### 1.2 `robots.txt` (root)
Copy `geo/robots.txt` and add disallows for private pages:
```
User-agent: *
Allow: /
Disallow: /account/
Disallow: /admin/
Disallow: /reset/
```
Keep the explicit `Allow: /` groups for GPTBot, OAI-SearchBot, ChatGPT-User, Google-Extended, PerplexityBot, ClaudeBot, Applebot-Extended and Bingbot, plus `Googlebot` (named in the plan). Put the same three Disallow lines in each named group, because named groups don't inherit `*`. End with `Sitemap: https://www.roleflow.io/sitemap.xml`.

### 1.3 `llms.txt` (root)
Start from `geo/llms.txt` and extend the Key pages with the comparison, niche and About pages plus all their ES mirrors. Serve it as text/plain.

### 1.4 `sitemap.xml` (root)
- List every public EN and ES page from the URL map (section 2), with `<lastmod>`.
- Use `xmlns:xhtml` and add `<xhtml:link rel="alternate" hreflang="en|es|x-default">` for every pair (x-default = EN URL).
- **Exclude** `/account/`, `/admin/`, `/reset/`. Include `/signup/` only if it is meant to be indexable (default: include it, since it's public). Use canonical www URLs only.

### 1.5 Private pages
Put `<meta name="robots" content="noindex, nofollow">` in `/account/`, `/admin/` and `/reset/` (plus the X-Robots-Tag header above). Don't give them canonical or hreflang tags, and don't list them in the sitemap or llms.txt.

---

## 2. File / URL map

Static folders with `index.html` each. EN at the root, ES under `/es/`.

| # | EN URL | ES URL | Notes |
|---|---|---|---|
| 1 | `/` (existing `index.html`) | `/es/` | Homepage. Keep the quiz, calculator, Menu and auth. The ES home may link to the EN onboarding/auth flow if those aren't translated. |
| 2 | `/what-is-an-ai-dm-setter` | `/es/que-es-un-setter-con-ia` | Definition page |
| 3 | `/pricing` | `/es/precios` | 5–7% model |
| 4 | `/faq` | `/es/preguntas-frecuentes` | FAQPage schema |
| 5 | `/best-ai-dm-setters` | `/es/mejores-setters-con-ia` | Honest listicle |
| 6 | `/vs/setsmart` | `/es/vs/setsmart` | Comparison |
| 7 | `/vs/manychat` | `/es/vs/manychat` | Comparison (ManyChat/ManySetter) |
| 8 | `/vs/setterflo` | `/es/vs/setterflo` | Comparison |
| 9 | `/vs/setterr` | `/es/vs/setterr` | Comparison |
| 10 | `/vs/human-setter` | `/es/vs/setter-humano` | Comparison |
| 11 | `/for/coaches` | `/es/para/coaches` | Niche |
| 12 | `/for/business-coaches` | `/es/para/coaches-de-negocios` | Niche |
| 13 | `/for/fitness-coaches` | `/es/para/coaches-fitness` | Niche |
| 14 | `/for/consultants` | `/es/para/consultores` | Niche |
| 15 | `/for/agency-owners` | `/es/para/agencias` | Niche |
| 16 | `/for/course-creators` | `/es/para/infoproductores` | Niche |
| 17 | `/about` | `/es/sobre-nosotros` | Entity page (founders `[CONFIRM]`) |
| — | `/signup/` | (EN only unless translated) | Existing. Keep it. |
| — | `/account/`, `/admin/`, `/reset/` | — | Existing, noindex, kept out of the sitemap |
| — | `/robots.txt`, `/llms.txt`, `/sitemap.xml`, `/vercel.json` | — | Root files |

Niches come from `geo-plan.md` §3. `icp.md` also infers mindset/dating coaches and med spa/aesthetics/real estate. **Don't** build those now; list them as future pages only.

---

## 3. Global `<head>` requirements (every public page, EN and ES)

```html
<html lang="en"> <!-- "es" on /es/ pages -->
<title>…</title>                       <!-- ≤ 60–65 chars, unique per page -->
<meta name="description" content="…"> <!-- 150–160 chars, unique per page -->
<link rel="canonical" href="https://www.roleflow.io/<self>">
<link rel="alternate" hreflang="en" href="https://www.roleflow.io/<en-path>">
<link rel="alternate" hreflang="es" href="https://www.roleflow.io/es/<es-path>">
<link rel="alternate" hreflang="x-default" href="https://www.roleflow.io/<en-path>">
<meta property="og:type" content="website"> <!-- "article" on the listicle -->
<meta property="og:site_name" content="Roleflow">
<meta property="og:title" content="…"><meta property="og:description" content="…">
<meta property="og:url" content="<canonical>">
<meta property="og:image" content="https://www.roleflow.io/og-image.png"> <!-- 1200×630, brand style -->
<meta property="og:locale" content="en_US"> <meta property="og:locale:alternate" content="es_ES">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="…"><meta name="twitter:description" content="…">
<meta name="twitter:image" content="https://www.roleflow.io/og-image.png">
<!-- twitter:site = @[CONFIRM] handle -->
```
- Every canonical is self-referencing and absolute on www. Hreflang is reciprocal on both pages of each pair.
- **Homepage title:** `Roleflow: Done-for-You AI DM Setter for Instagram | $0 Setup, Pay on Results` (it must contain "Done-for-You AI DM Setter for Instagram").
- Homepage meta (example, ~155 chars): `Done-for-you AI DM setter for Instagram: replies in seconds, voice notes in your cloned voice, follow-ups and booked calls. $0 setup, pay 5–7% of revenue.`
- ES home title: `Roleflow: Setter con IA para DMs de Instagram, hecho para ti | $0 de setup`
- Create `og-image.png` and confirm `/logo.png` exists (the schema references it). If it doesn't, export the existing logo to that path.
- **Language switcher** in the header: links to the counterpart page (not to `/es/` home), shows `EN | ES` with `hreflang` and `lang` attributes, and needs no JS.
- **Visible "Updated: <date>"** on the listicle, comparison and pricing pages.

---

## 4. Structured data (JSON-LD)

Base it on `geo/schema-jsonld.html`, keeping its `[CONFIRM]` values verbatim.
- **Homepage (EN and ES):** `@graph` with `Organization` (`@id https://www.roleflow.io/#org`) and `SoftwareApplication` (`@id …/#app`, offers price 0 USD + description "$0 setup and $0 retainer; 5–7% of revenue generated"), plus `FAQPage` **only if** the homepage shows those FAQ items visibly. Add `WebSite` with `inLanguage`. Write ES descriptions in Spanish.
- **/faq and /es/preguntas-frecuentes:** `FAQPage` with every visible Q&A from `faq-en-es.md`. For Q&As whose answer is only a `[CONFIRM]` placeholder, show them on the page but leave them **out of the JSON-LD** until confirmed.
- **Other pages:** reference the Organization by `@id` and add `BreadcrumbList`. Add `Article` on the listicle (author = Organization, `datePublished`/`dateModified`), and `FAQPage` on any page that has a visible FAQ block.
- No `AggregateRating`, `Review` or invented `sameAs`.
- Validate with the Schema.org validator and Google Rich Results Test.

---

## 5. Per-page content requirements

Shared pattern for every content page: an H1 with the target keyword, then a **40–60-word direct-answer paragraph** at the top (LLMs quote it), short H2 sections, a CTA (book a demo / take the qualification quiz → `/#quiz` anchor or the existing quiz entry point), internal links to the definition, pricing, FAQ and listicle pages, and the language switcher.

### 5.1 Homepage `/`
- Keep the current hero, calculator, quiz, Menu drawer with Sign up/Log in tabs, and auth.
- Make sure the H1 or hero subhead includes "Done-for-you AI DM setter for Instagram".
- Add (server-rendered): a short "What Roleflow does" block with the 4 value props from icp.md, a "Pricing: $0 setup, $0 retainer, 5–7% of revenue" block, a "Who it's for / not for" block (qualification: 20+ DMs/day, offer > $1k, close rate > 20%, $30k+/month collected; not for WhatsApp/email/phone sellers, low ticket or low DM volume), a 4–5-item FAQ, and footer links to every new page.
- Don't add the "$50K/mo" calculator figure as a factual statistic anywhere new. It stays only as the existing calculator framing.

### 5.2 `/what-is-an-ai-dm-setter` · `/es/que-es-un-setter-con-ia`
- Open with a 40-word definition (based on the FAQ answer).
- Cover what it does (reply, qualify, follow up, book), how it differs from a chatbot/ManyChat flow and from a human setter, done-for-you vs self-serve, voice notes in a cloned voice, Instagram rules/API (`[CONFIRM]`), and who should use one.
- End with Roleflow as the done-for-you option and links to pricing and the listicle.

### 5.3 `/pricing` · `/es/precios`
- $0 setup, $0 retainer, 5–7% of revenue generated, with the rate set on the demo call. Explain how attribution works using **`[CONFIRM: attribution method, e.g. booked calls sourced from Roleflow conversations that close.]`** verbatim.
- Cover qualification criteria and when % of revenue makes sense vs a flat fee.
- Compare with the cost of a human setter **only qualitatively**, unless Diego supplies sourced numbers.
- Don't invent example dollar calculations presented as real outcomes. An illustrative formula is fine if it's clearly labeled "illustrative".
- Include a FAQ block and FAQPage schema.

### 5.4 `/faq` · `/es/preguntas-frecuentes`
- All Q&As from `faq-en-es.md` (10 EN, 9 ES), copied verbatim, with placeholders intact.
- Add the ES counterpart of "How long does setup take?" (`¿Cuánto tarda la puesta en marcha? [CONFIRMAR]`) and keep the EN "review/approval process" `[CONFIRM]` (and add `[CONFIRMAR proceso de revisión/aprobación.]` to the ES version) so the two languages match.
- Add FAQPage JSON-LD (see section 4).

### 5.5 `/best-ai-dm-setters` · `/es/mejores-setters-con-ia`
- Follow `article-outline-best-ai-dm-setters.md` exactly: short answer, definition, methodology, comparison table (Tool | Type | Published price | Channels | Best for | Wrong for), tool sections, pricing models, a how-to-choose decision guide, FAQ, and the updated date with a methodology note.
- EN tools: Roleflow, SetSmart, ManyChat/ManySetter, SetterFlo, Setterr, Intellicoach, Appointwise, Instaset, LeadsNow, human setter. ES: per the ES outline, including WhatSetter.
- **Disclose at the top that Roleflow wrote the article.**
- Give every tool, Roleflow included, a "wrong for" line. Roleflow's: not for WhatsApp/email/phone-first sellers, low-ticket offers, or low DM volume.
- Every competitor price and feature cell must be verified on the competitor's own site and footnoted with its URL and check date. Otherwise put `[CONFIRM]`.
- Use `og:type article` and `Article` schema.

### 5.6 Comparison pages `/vs/*` (SetSmart, ManyChat, SetterFlo, Setterr, human setter) + ES
Template:
- H1 "Roleflow vs X"
- 40–60-word verdict
- Side-by-side table: model (done-for-you vs self-serve), pricing model, channels, voice notes in cloned voice, follow-ups, calendar booking, setup effort
- "Choose X if…" / "Choose Roleflow if…"
- FAQ
- Sources with check dates

No competitor fact may be added without a cited source. Cells with no source get `[CONFIRM]`. Keep the tone neutral and factual, with no disparagement.
- **ManyChat:** frame it as a flow-builder/automation tool vs a done-for-you setter. ManySetter is mentioned in the plan. Verify its features before claiming any.
- **Human setter:** Roleflow facts vs the human-setter role (speed, availability 24/7, follow-up consistency, managing people). No salary figures unless sourced.

### 5.7 Niche pages `/for/*` + `/es/para/*`
Six pages: coaches, business coaches, fitness coaches, consultants, agency owners, course creators. Each one needs:
- A niche-specific H1 ("AI DM Setter for Fitness Coaches")
- A direct answer
- Niche pains (taken from icp.md pains, in that niche's language)
- How Roleflow works for them
- Qualification criteria
- Pricing summary
- A niche FAQ (2–4 items, using only sourced facts)
- A CTA

No fake niche testimonials or results. Each page must be substantively unique (≥ 400 words), not a find-and-replace template.

### 5.8 `/about` · `/es/sobre-nosotros`
- The one-liner, the mission, founders `[CONFIRM]`, founding year `[CONFIRM]`, and contact diego@roleflow.io.
- Social links `[CONFIRM]` (LinkedIn, X, Instagram, Crunchbase).

---

## 6. Navigation & internal linking
- Header on all pages. Footer with every public page in both languages.
- Each `/vs/*` and `/for/*` page links to the listicle, pricing and FAQ. The listicle links to every `/vs/*` page. Breadcrumbs go on every inner page.
- The Menu drawer (Sign up / Log in tabs) must keep working on the homepage. Optionally expose a "Log in / Sign up" header link to `/signup/` on inner pages, but don't duplicate auth logic.

## 7. Performance & accessibility
- Static HTML and shared CSS, no heavy frameworks. Lighthouse SEO ≥ 95 and accessibility ≥ 90 on new pages.
- One H1 per page, logical headings, alt text, and visible focus states. The `lang` attribute must be correct.

## 8. Out of scope (don't do)
- Don't change Supabase project settings, migrations, the access code or `onboarding/config.js` content.
- No paid placements, no review solicitation copy, no Wikidata.
- Don't merge to `main` without approval.

---

## 9. `[CONFIRM]` items carried from the source files (keep them verbatim until Diego supplies the facts)
1. Founder name(s): Organization schema, /about
2. Founding date/year
3. Social/profile URLs: LinkedIn company, X handle, Instagram handle, Crunchbase (`sameAs`, `twitter:site`, /about)
4. Attribution method for "revenue generated" (EN `[CONFIRM: …]`, ES `[CONFIRMAR método de atribución.]`)
5. Voice-note/reply review or approval process
6. Instagram account safety: official Meta API or not, messaging-window compliance (EN + `[CONFIRMAR API oficial de Meta.]`)
7. Setup time (`[CONFIRM]`)
8. Exact price range: 5–7% is stated. The plan asks to "publish real ranges only", so confirm whether 5–7% is final.
9. Every competitor fact (prices, channels, features) not yet verified, marked `[CONFIRM]` per cell

---

## 10. Acceptance checklist (the PR must pass all of these)
- [ ] `curl -sI https://roleflow.io/` and `https://roleflow.io/pricing` return **301** to the matching `https://www.roleflow.io/…`
- [ ] Homepage `<title>` contains "Done-for-You AI DM Setter for Instagram". Every public page has a unique title, a 150–160-char meta description, OG and Twitter tags, and a self-referencing absolute canonical.
- [ ] Every EN/ES pair has reciprocal hreflang `en`, `es`, `x-default`, and the language switcher goes to the counterpart page
- [ ] `/robots.txt`, `/llms.txt` (text/plain) and `/sitemap.xml` return 200. The sitemap has hreflang alternates and lists every public page, with no `/account/`, `/admin/` or `/reset/`.
- [ ] `/account/`, `/admin/` and `/reset/` have the `noindex` meta and the X-Robots-Tag header
- [ ] Organization, SoftwareApplication and FAQPage JSON-LD validate with no errors, and the FAQPage Q&As match the visible text
- [ ] All 17 EN + 17 ES pages in the URL map exist and return 200, with content in the raw HTML (`curl` shows the text)
- [ ] Every content page has a 40–60-word direct answer at the top
- [ ] Positioning ($0 setup, $0 retainer, 5–7%, cloned-voice voice notes, done-for-you, Instagram DMs only) is consistent on all pages
- [ ] `grep -r "\[CONFIRM"` finds every placeholder from section 9. None were removed.
- [ ] No invented stats, reviews, testimonials, ratings or unsourced competitor claims. Every competitor fact has a source URL and a check date.
- [ ] The listicle discloses Roleflow authorship and has a "wrong for" line for every tool, Roleflow included
- [ ] **Regression:** the homepage quiz and calculator work. Menu → Sign up and Log in tabs switch correctly. Sign-up with access code `Roleflow2026` works and a wrong code is rejected. Log in, magic link, `/account/` dashboard, onboarding prompt generation, `/admin/` (admin only) and `/reset/` all work.
- [ ] Design matches the existing brand (colors, fonts, components) on desktop and mobile. Lighthouse SEO ≥ 95.
- [ ] PR opened with screenshots (EN + ES, desktop + mobile) and is **not merged** without approval
- [ ] After deploy: submit the sitemap in Bing Webmaster Tools and Google Search Console, and enable IndexNow (Diego / account owner)
