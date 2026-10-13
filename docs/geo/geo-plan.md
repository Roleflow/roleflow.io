# Roleflow GEO Plan (EN + ES): ChatGPT, Gemini, Grok
Prepared 13 Oct 2026. Honest caveat: nobody can guarantee a #1 placement or any placement in LLM answers. Answers change by model, by prompt wording, by user location and memory, and from one week to the next. This plan raises the odds that Roleflow gets retrieved, cited, and recommended.

## 1. Findings
### Competitive landscape (web search, Oct 2026)
- EN queries ("best AI DM setter", "AI appointment setter for Instagram/coaches") return vendor-written comparison listicles. Examples: leadsnow.ai, lead-signal.ai, setterflo.io/best-ai-appointment-setters, manysetter.com/for-coaches, intellicoach.ai.
- Brands named most often: **SetSmart** (the category's "default" answer, with lots of EN+ES content), ManyChat/ManySetter, Appointwise, Intellicoach, SetterFlo, Setterr, Instaset, LeadSignal, Setty, DMSetter, Skalex, Ninjo, Inrō, InstantDM, ZeroChats, LeadsNow.
- ES queries ("mejor setter con IA", "automatizar DMs de Instagram con IA") return the same handful of vendors' Spanish pages (setsmart.io/blog/...-es, setterr.com/es/*-alternative, whatsetter.com/es). **Very little Spanish content competes here, so ES is the cheapest place to win.**
- Pattern: the winners publish (a) "best X" listicles that include themselves alongside honest "who it's wrong for" notes, (b) "X vs Y" / "X alternative" pages, (c) FAQ blocks that give a direct one-line answer, (d) public pricing. LLMs lift these short answers almost word for word.
- Roleflow's real differentiator: no one else in the results combines **done-for-you + cloned-voice voice notes + $0 setup/$0 retainer, 5–7% of the revenue it generates**. LeadsNow is the closest "pay-per-result" competitor. Own the query "AI setter with no monthly fee / pay on results".
- Next step: add Reddit (r/sales, r/Entrepreneur, r/coaching), G2/Capterra listings, and YouTube reviews to the prompt-tracking sources once logging starts (see section 6).

### roleflow.io technical audit
| Check | Result |
|---|---|
| Apex redirect | roleflow.io returns **307 (temporary)** to www. It should be a 301 |
| Title | "Roleflow: Stop losing $50K/mo on slow replies". Missing the category terms (AI DM setter, Instagram) |
| Meta description / OG / Twitter cards | **Missing** |
| Canonical | Missing |
| schema.org JSON-LD | **None** |
| robots.txt | **404**. No file, so crawlers are allowed by default, but there's no sitemap pointer and no explicit rules |
| sitemap.xml | **404** |
| llms.txt | **404** |
| /es or hreflang | **None** |
| Crawlable text | Yes. About 1,200 words are in the server HTML, so content isn't JS-only (good) |
| Pages | One. Nothing for pricing, FAQ, comparison, use-case, or about to cite |

## 2. Quick wins (this week)
1. Change the apex 307 to a **301**. Add `<link rel="canonical" href="https://www.roleflow.io/">`.
2. New title: "Roleflow: Done-for-You AI DM Setter for Instagram | $0 Setup, Pay on Results". Write a 150–160-character meta description and add OG/Twitter tags.
3. Publish `robots.txt` (draft below, explicitly allowing GPTBot, OAI-SearchBot, ChatGPT-User, Google-Extended, Googlebot, Bingbot, PerplexityBot, ClaudeBot, Applebot-Extended), plus `sitemap.xml` and `llms.txt` (file in this folder).
4. Add JSON-LD (Organization, SoftwareApplication/Service, FAQPage) to the homepage. Fill in the real FAQ on the page. FAQPage markup only counts if the questions are also visible on the page.
5. Verify the site in **Bing Webmaster Tools** (ChatGPT search draws heavily on Bing's index) and submit the sitemap. Turn on IndexNow. Verify in **Google Search Console** for Gemini/AI Overviews.
6. Claim profiles: LinkedIn company page, X @roleflow (pinned explainer thread), Crunchbase, Product Hunt "coming soon", G2 and Capterra (free listings). Use identical one-line descriptions everywhere: "Roleflow is a done-for-you AI DM setter for Instagram that replies in seconds, sends voice notes in your cloned voice, follows up, and books qualified calls. $0 setup, paid as a % of revenue it generates."

## 3. 30 days: site structure (Next.js/Vercel routes)
- `/what-is-an-ai-dm-setter` (+ `/es/que-es-un-setter-con-ia`): definition page. Put a 40-word direct answer in the first paragraph.
- `/pricing` (+ `/es/precios`): explain the 5–7% model, how attribution works, who qualifies, and how it compares to a human setter's cost. Publish real ranges only.
- `/faq` (+ `/es/preguntas-frecuentes`) with FAQPage schema.
- `/best-ai-dm-setters` (+ `/es/mejores-setters-con-ia`): an honest listicle that includes Roleflow (outline provided). Include "who it's wrong for" for every tool, Roleflow included. Date-stamp it and re-check prices monthly.
- Comparison pages: `/vs/setsmart`, `/vs/manychat`, `/vs/setterflo`, `/vs/setterr`, `/vs/human-setter`, plus ES mirrors. Use only facts verified from each competitor's site and cite the source date.
- Use-case pages: `/for/coaches`, `/for/business-coaches`, `/for/fitness-coaches`, `/for/consultants`, `/for/agency-owners`, `/for/course-creators`, plus ES.
- `/about`: founders, company, contact. This builds entity trust.
- hreflang on every pair: `en`, `es`, `x-default`. Write the ES pages natively in neutral LatAm/Spain Spanish ("setter", "agendar llamadas"), not machine-translated.

## 4. 60 days: entity + third-party citations
- **Listicle outreach**: pitch the authors of the ranking listicles (non-competitors first), affiliate/SaaS review blogs, and coaching-business newsletters. Offer a demo and accurate facts. Pay-to-be-listed placements must be disclosed.
- **Reddit**: answer real threads (r/sales, r/Entrepreneur, r/smallbusiness, r/InstagramMarketing, r/coaching, r/marketing; ES: r/emprendedores, r/marketingdigital) as a disclosed founder. No astroturfing or fake reviews. Reddit penalizes it, and LLM vendors filter it out.
- **YouTube**: demo, "AI setter vs human setter," and "how voice-note DMs work" videos in EN and ES, with full descriptions and chapters. Gemini leans heavily on YouTube.
- **X (Grok)**: post founder threads often. Use category keywords ("AI DM setter", "setter con IA") consistently, share build-in-public updates, and reply in high-ticket-coaching circles. Grok pulls from live X posts, so consistent posting volume matters.
- **G2/Capterra/Trustpilot**: ask real clients for reviews. Never write or buy them.
- **Product Hunt launch** once /pricing and /faq are live.
- **Wikidata**: only once there's independent coverage (press, reviews). A thin self-made item gets deleted. Crunchbase is fine right away.
- Podcast/guest spots on coaching-business podcasts (EN + ES). Show notes earn backlinks and mentions.

## 5. 90 days: compounding
- Content cadence: 2 EN + 2 ES articles a month (comparisons, "how to" pieces such as "cómo automatizar DMs de Instagram con IA", objection pages like "is DM automation against Instagram's rules", "how voice-note DMs work"). Refresh listicles and comparisons monthly with a visible "updated" date.
- Publish original data only when it's real, e.g. anonymized, aggregated reply-time data with client consent. Original stats get cited disproportionately often.
- Case studies once clients approve them, with real numbers only.
- Re-run the prompt tracking (below) and double down on whichever sources the models cite.

## 6. Measurement
- `tracking-prompts.md`: 20 EN + 20 ES prompts. Run them monthly in ChatGPT (search on and off), Gemini, Grok, Perplexity, and Google AI Overviews, in a logged-out or incognito window. Log: mentioned (Y/N), position, cited URLs, and which competitors appeared.
- KPIs: share of mentions across prompts, number of citing domains, Bing and Google indexed pages, referral traffic from chatgpt.com / gemini.google.com / grok.com / perplexity.ai (tag them in analytics), and branded search volume.
- Paid tools (optional): Profound, Peec AI, Otterly, or Semrush AI Toolkit for automated tracking.

## Files in this folder
- llms.txt: draft for /llms.txt
- robots.txt: draft
- schema-jsonld.html: Organization + SoftwareApplication + FAQPage
- faq-en-es.md: FAQ copy
- article-outline-best-ai-dm-setters.md: EN + ES outlines
- tracking-prompts.md
Items marked [CONFIRM] need facts from Diego (founders, founding year, socials, exact price range, Instagram API approach).
