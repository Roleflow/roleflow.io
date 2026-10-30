#!/usr/bin/env python3
"""Write the crawlable EN/ES pages, sitemap, robots, llms.txt, and homepage SEO blocks."""
import html
import json
import re
from pathlib import Path

from pages_data import PAGES

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://www.roleflow.io"
ONE = "Roleflow is an AI Client Acquisition Engine. We build and run your Instagram DM system: every lead answered in seconds, voice notes in your own voice (cloned from a short recording), follow-ups sent automatically and only within 24 hours, and qualified leads booked on your calendar."
IG = "https://www.instagram.com/roleflow.io"
TT = "https://www.tiktok.com/@roleflow.io"
YT = "https://www.youtube.com/@roleflow"
SAME_AS = [IG, TT, YT]
UPDATED_EN = "Updated: 14 October 2026"
UPDATED_ES = "Actualizado: 14 de octubre de 2026"

NAV_EN = [
    ("/what-is-an-ai-dm-setter/", "AI DM Setter"),
    ("/faq/", "FAQ"),
    ("/best-ai-dm-setters/", "Compare"),
    ("/signup/", "Sign up"),
]
NAV_ES = [
    ("/es/que-es-un-setter-con-ia/", "Setter con IA"),
    ("/es/preguntas-frecuentes/", "Preguntas"),
    ("/es/mejores-setters-con-ia/", "Comparar"),
    ("/signup/", "Crear cuenta"),
]


def words(text):
    plain = re.sub(r"<[^>]+>", " ", text)
    return len(re.findall(r"\S+", plain))


def url(path):
    if path in ("", "/"):
        return ORIGIN + "/"
    return ORIGIN + path if path.endswith("/") else ORIGIN + path + "/"


def footer():
    en_links = [(url_for(p, "en"), p["name_en"]) for p in PAGES]
    es_links = [(url_for(p, "es"), p["name_es"]) for p in PAGES]
    en_links.append(("/signup/", "Sign up"))
    def lis(items):
        return "".join(f'<li><a href="{html.escape(href)}">{html.escape(name)}</a></li>' for href, name in items)
    social = [
        ("Instagram", IG), ("TikTok", TT), ("YouTube", YT),
    ]
    social_html = "".join(f'<a href="{html.escape(href)}">{html.escape(name)}</a>' for name, href in social)
    return f'''<footer class="geo-foot"><div class="foot-in">
<p class="one">{html.escape(ONE)}</p>
<div class="cols">
<div><h2>English</h2><ul>{lis(en_links)}</ul></div>
<div><h2>Español</h2><ul>{lis(es_links)}</ul></div>
</div>
<p class="social">{social_html}</p>
<p class="fine">© Roleflow. AI Client Acquisition Engine. <a href="mailto:diego@roleflow.io">diego@roleflow.io</a></p>
</div></footer>
<script src="/assets/site-config.js"></script>
<script src="/supabase/config.js"></script>
<script type="module" src="/assets/qualify-ui.js"></script>'''


def url_for(page, lang):
    slug = page["en"] if lang == "en" else page["es"]
    if slug in ("", "/"):
        return "/"
    return "/" + slug.strip("/") + "/"


def head(page, lang):
    title = page[f"title_{lang}"]
    desc = page[f"desc_{lang}"]
    if not (150 <= len(desc) <= 160):
        raise SystemExit(f"meta {lang} {page['en'] or 'home'} is {len(desc)} chars: {desc}")
    if lang == "en" and page["en"] not in ("",) and len(title) > 65:
        raise SystemExit(f"title too long ({len(title)}): {title}")
    if lang == "es" and page.get("es") != "es" and len(title) > 70:
        raise SystemExit(f"es title long ({len(title)}): {title}")
    canon = url(url_for(page, lang))
    en = url(url_for(page, "en"))
    es = url(url_for(page, "es"))
    og_type = "article" if page.get("article") else "website"
    locale = "es_ES" if lang == "es" else "en_US"
    alt = "en_US" if lang == "es" else "es_ES"
    lang_attr = "es" if lang == "es" else "en"
    return f'''<!DOCTYPE html>
<html lang="{lang_attr}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="{canon}">
<link rel="alternate" hreflang="en" href="{en}">
<link rel="alternate" hreflang="es" href="{es}">
<link rel="alternate" hreflang="x-default" href="{en}">
<meta property="og:type" content="{og_type}">
<meta property="og:site_name" content="Roleflow">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="{canon}">
<meta property="og:image" content="{ORIGIN}/og-image.png">
<meta property="og:locale" content="{locale}">
<meta property="og:locale:alternate" content="{alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{html.escape(title)}">
<meta name="twitter:description" content="{html.escape(desc)}">
<meta name="twitter:image" content="{ORIGIN}/og-image.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700;800&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
<script type="application/ld+json">
{json.dumps(jsonld(page, lang), ensure_ascii=False, indent=1)}
</script>
</head>'''


def org_node(lang):
    desc = page_desc = {
        "en": "AI Client Acquisition Engine for Instagram DMs. We build and run the system: replies in seconds, voice notes in your own voice, follow-ups within 24 hours, and booked calls.",
        "es": "Motor de adquisición de clientes con IA para DMs de Instagram. Lo montamos y lo operamos: respuestas en segundos, notas de voz en tu propia voz y llamadas agendadas.",
    }[lang]
    return {
        "@type": "Organization",
        "@id": ORIGIN + "/#org",
        "name": "Roleflow",
        "url": ORIGIN + "/",
        "logo": ORIGIN + "/logo.png",
        "description": desc,
        "sameAs": SAME_AS,
        "email": "diego@roleflow.io",
    }


def app_node(lang):
    if lang == "en":
        features = [
            "Every Instagram DM answered in seconds",
            "Voice notes in your own voice, cloned from a short recording",
            "Follow-ups sent automatically, only within 24 hours",
            "Qualified leads booked on your calendar",
            "We build and run the Instagram DM system",
        ]
    else:
        features = [
            "Cada DM de Instagram respondido en segundos",
            "Notas de voz en tu propia voz, clonadas de una grabación corta",
            "Seguimientos solo dentro de 24 horas",
            "Leads calificados agendados en tu calendario",
            "Montamos y operamos el sistema de DMs de Instagram",
        ]
    return {
        "@type": "Product",
        "@id": ORIGIN + "/#app",
        "name": "Roleflow",
        "category": "AI Client Acquisition Engine",
        "applicationCategory": "BusinessApplication",
        "applicationSubCategory": "AI Client Acquisition Engine",
        "operatingSystem": "Web",
        "inLanguage": ["en", "es"],
        "publisher": {"@id": ORIGIN + "/#org"},
        "featureList": features,
    }


def faq_node(pairs):
    return {
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
            for q, a, keep in pairs if keep
        ],
    }


def crumbs_node(page, lang):
    items = []
    for i, (name, href) in enumerate(page[f"crumbs_{lang}"], start=1):
        items.append({"@type": "ListItem", "position": i, "name": name, "item": url(href)})
    return {"@type": "BreadcrumbList", "itemListElement": items}


def jsonld(page, lang):
    graph = []
    if page.get("home"):
        graph.append(org_node(lang))
        graph.append(app_node(lang))
        graph.append({
            "@type": "WebSite",
            "@id": ORIGIN + "/#website",
            "url": ORIGIN + "/",
            "name": "Roleflow",
            "inLanguage": ["en", "es"],
            "publisher": {"@id": ORIGIN + "/#org"},
        })
    else:
        graph.append({"@type": "Organization", "@id": ORIGIN + "/#org"})
        graph.append(crumbs_node(page, lang))
    faqs = [(q, a, keep) for q, a, keep in page.get(f"faq_{lang}", []) if keep]
    if faqs:
        graph.append(faq_node(page[f"faq_{lang}"]))
    if page.get("article"):
        graph.append({
            "@type": "Article",
            "headline": page[f"h1_{lang}"],
            "description": page[f"desc_{lang}"],
            "datePublished": "2026-10-13",
            "dateModified": "2026-10-13",
            "inLanguage": "es" if lang == "es" else "en",
            "author": {"@id": ORIGIN + "/#org"},
            "publisher": {"@id": ORIGIN + "/#org"},
            "mainEntityOfPage": url(url_for(page, lang)),
            "image": ORIGIN + "/og-image.png",
        })
    return {"@context": "https://schema.org", "@graph": graph}


def header(page, lang):
    en_cur = ' aria-current="page"' if lang == "en" else ""
    es_cur = ' aria-current="page"' if lang == "es" else ""
    return f'''<a class="skip" href="#content">{'Saltar al contenido' if lang == 'es' else 'Skip to content'}</a>
<header class="top">
<a class="brand" href="/"><img alt="" src="/assets/logo.jpg" width="34" height="34">Roleflow</a>
<p class="lang"><a href="{url_for(page, 'en')}" hreflang="en" lang="en"{en_cur}>EN</a> <span aria-hidden="true">|</span> <a href="{url_for(page, 'es')}" hreflang="es" lang="es"{es_cur}>ES</a></p>
</header>'''


def faq_html(pairs, heading):
    if not pairs:
        return ""
    blocks = []
    for q, a, _keep in pairs:
        blocks.append(f"<details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>")
    return f'<section class="faq"><h2>{heading}</h2>{"".join(blocks)}</section>'


def cta(lang):
    if lang == "en":
        return '<p class="cta"><a class="btn" href="#qualify" data-qualify>See if you qualify</a> <a class="btn ghost" href="#qualify" data-qualify>Book a demo</a></p>'
    return '<p class="cta"><a class="btn" href="#qualify" data-qualify>Comprueba si calificas</a> <a class="btn ghost" href="#qualify" data-qualify>Agenda una demo</a></p>'


def crumbs_html(page, lang):
    bits = []
    items = page[f"crumbs_{lang}"]
    for i, (name, href) in enumerate(items):
        if i == len(items) - 1:
            bits.append(f'<li><span aria-current="page">{html.escape(name)}</span></li>')
        else:
            bits.append(f'<li><a href="{html.escape(href)}">{html.escape(name)}</a></li>')
    label = "Migas" if lang == "es" else "Breadcrumb"
    return f'<nav class="crumbs" aria-label="{label}"><ol>{"".join(bits)}</ol></nav>'


def render(page, lang):
    n = words(page[f"answer_{lang}"])
    if not 40 <= n <= 60:
        raise SystemExit(f"answer {lang} {page['en'] or page['es']} has {n} words")
    if page.get("min_words"):
        bw = words(page[f"body_{lang}"])
        if bw < page["min_words"]:
            raise SystemExit(f"body {lang} {page['en']} has {bw} words")
    updated = ""
    if page.get("updated"):
        updated = f'<p class="updated">{UPDATED_ES if lang == "es" else UPDATED_EN}</p>'
    h1 = page[f"h1_{lang}"]
    answer = html.escape(page[f"answer_{lang}"])
    faq_h = "Preguntas frecuentes" if lang == "es" else "FAQ"
    doc = "\n".join([
        head(page, lang),
        "<body class=\"geo\">",
        header(page, lang),
        f'<main id="content" class="wrap">',
        crumbs_html(page, lang) if not page.get("home") else "",
        f"<h1>{h1}</h1>",
        f'<p class="answer">{answer}</p>',
        updated,
        page[f"body_{lang}"],
        faq_html(page.get(f"faq_{lang}", []), faq_h),
        cta(lang),
        "</main>",
        footer(),
        "</body></html>\n",
    ])
    return doc


def write_page(page, lang):
    if lang == "en" and page.get("skip_en"):
        return
    path = ROOT / url_for(page, lang).strip("/") / "index.html"
    if url_for(page, lang) == "/":
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render(page, lang), encoding="utf-8")
    print("wrote", path.relative_to(ROOT))


def sitemap():
    urls = []
    for page in PAGES:
        for lang in ("en", "es"):
            if lang == "en" and page.get("skip_en"):
                loc = ORIGIN + "/"
            else:
                loc = url(url_for(page, lang))
            en = url(url_for(page, "en"))
            es = url(url_for(page, "es"))
            urls.append((loc, en, es))
    urls.append((ORIGIN + "/signup/", ORIGIN + "/signup/", None))
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    seen = set()
    for loc, en, es in urls:
        if loc in seen:
            continue
        seen.add(loc)
        lines.append("  <url>")
        lines.append(f"    <loc>{loc}</loc>")
        lines.append("    <lastmod>2026-10-13</lastmod>")
        lines.append(f'    <xhtml:link rel="alternate" hreflang="en" href="{en}"/>')
        if es:
            lines.append(f'    <xhtml:link rel="alternate" hreflang="es" href="{es}"/>')
        lines.append(f'    <xhtml:link rel="alternate" hreflang="x-default" href="{en}"/>')
        lines.append("  </url>")
    lines.append("</urlset>\n")
    (ROOT / "sitemap.xml").write_text("\n".join(lines), encoding="utf-8")


def robots():
    groups = ["*", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "Google-Extended", "Googlebot", "PerplexityBot", "ClaudeBot", "Applebot-Extended", "Bingbot"]
    parts = []
    for name in groups:
        parts.append(f"User-agent: {name}\nAllow: /\nDisallow: /account/\nDisallow: /admin/\nDisallow: /reset/\n")
    parts.append("Sitemap: https://www.roleflow.io/sitemap.xml\n")
    (ROOT / "robots.txt").write_text("\n".join(parts), encoding="utf-8")


def llms():
    lines = [
        "# Roleflow",
        "",
        f"> {ONE}",
        "",
        "Roleflow is an AI Client Acquisition Engine for high-ticket coaches, consultants, course creators and agency owners whose personal brand drives sales on Instagram. En español: motor de adquisición de clientes con IA.",
        "",
        "Who it fits: businesses with 20+ Instagram DMs a day, an offer above $1,000, a close rate above 20%, and $30k+/month cash collected.",
        "Who it does not fit: businesses selling mainly through WhatsApp, email or phone (Instagram DMs only), low-ticket offers, or very low DM volume.",
        "Roleflow is an AI Client Acquisition Engine. Apply To Work Together opens the on-site qualification (#qualify). Public pages do not link to a calendar.",
        "",
        "## Social",
        f"- Instagram: {IG}",
        f"- TikTok: {TT}",
        f"- YouTube: {YT}",
        "",
        "## Key pages",
    ]
    for page in PAGES:
        if page.get("skip_en"):
            lines.append(f"- [{page['name_en']}]({ORIGIN}/)")
        else:
            lines.append(f"- [{page['name_en']}]({url(url_for(page, 'en'))})")
    lines.append(f"- [Sign up]({ORIGIN}/signup/)")
    lines.append("")
    (ROOT / "llms.txt").write_text("\n".join(lines), encoding="utf-8")


def vercel():
    data = {
        "redirects": [
            {"source": "/acquire", "destination": "/account/acquisition/", "statusCode": 301},
            {"source": "/acquire/", "destination": "/account/acquisition/", "statusCode": 301},
            {"source": "/acquire/index.html", "destination": "/account/acquisition/", "statusCode": 301},
            {"source": "/admin/office", "destination": "/admin/hq/", "statusCode": 301},
            {"source": "/admin/office/", "destination": "/admin/hq/", "statusCode": 301},
            {"source": "/admin/office/index.html", "destination": "/admin/hq/", "statusCode": 301},
            {"source": "/pricing", "destination": "/", "statusCode": 301},
            {"source": "/pricing/", "destination": "/", "statusCode": 301},
            {"source": "/pricing/index.html", "destination": "/", "statusCode": 301},
            {"source": "/es/precios", "destination": "/es/", "statusCode": 301},
            {"source": "/es/precios/", "destination": "/es/", "statusCode": 301},
            {"source": "/es/precios/index.html", "destination": "/es/", "statusCode": 301},
            {
                "source": "/:path*",
                "has": [{"type": "host", "value": "roleflow.io"}],
                "destination": "https://www.roleflow.io/:path*",
                "statusCode": 301,
            },
        ],
        "headers": [
            {"source": "/(.*)", "headers": [{"key": "Content-Security-Policy", "value": "frame-src 'self' https://share.descript.com"}]},
            {"source": "/(account|admin|reset|acquire)(.*)", "headers": [{"key": "X-Robots-Tag", "value": "noindex, nofollow"}]},
            {"source": "/llms.txt", "headers": [{"key": "Content-Type", "value": "text/plain; charset=utf-8"}]},
        ],
    }
    (ROOT / "vercel.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def images():
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        import subprocess, sys
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "-q"])
        from PIL import Image, ImageDraw, ImageFont
    logo = Image.open(ROOT / "assets" / "logo.jpg").convert("RGBA")
    logo.save(ROOT / "logo.png")
    im = Image.new("RGB", (1200, 630), "#0A1226")
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, 1200, 14), fill="#7B4DFF")
    draw.rectangle((0, 616, 1200, 630), fill="#FF8A3D")
    bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 72)
    regular = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
    draw.text((72, 150), "Roleflow", font=bold, fill="#EEF1FA")
    draw.text((72, 250), "AI Client Acquisition Engine", font=regular, fill="#E8B04A")
    draw.text((72, 300), "for Instagram DMs.", font=regular, fill="#E8B04A")
    blurb = "Replies in seconds. Voice notes in your own voice.\nFollow-ups within 24 hours. Booked calls."
    draw.multiline_text((72, 400), blurb, font=regular, fill="#EEF1FA", spacing=10)
    im.save(ROOT / "og-image.png")


def patch_private():
    for rel in ("account/index.html", "admin/index.html", "reset/index.html"):
        path = ROOT / rel
        text = path.read_text(encoding="utf-8")
        if 'name="robots"' not in text:
            text = text.replace(
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="robots" content="noindex, nofollow">',
                1,
            )
            path.write_text(text, encoding="utf-8")
            print("noindex", rel)


def patch_signup(foot):
    path = ROOT / "signup" / "index.html"
    text = path.read_text(encoding="utf-8")
    if 'rel="canonical"' not in text:
        desc = "Create your Roleflow account to start onboarding. Qualified clients save their answers and book Instagram DM calls. An access code is required to join."
        if not 150 <= len(desc) <= 160:
            raise SystemExit(f"signup meta {len(desc)}")
        block = f'''<title>Create your account · Roleflow</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://www.roleflow.io/signup/">
<link rel="alternate" hreflang="en" href="https://www.roleflow.io/signup/">
<link rel="alternate" hreflang="x-default" href="https://www.roleflow.io/signup/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Roleflow">
<meta property="og:title" content="Create your account · Roleflow">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="https://www.roleflow.io/signup/">
<meta property="og:image" content="https://www.roleflow.io/og-image.png">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Create your account · Roleflow">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="https://www.roleflow.io/og-image.png">'''
        text = text.replace("<title>Create your account · Roleflow</title>", block, 1)
    if 'href="/assets/site.css"' not in text:
        text = text.replace(
            '<link rel="stylesheet" href="/auth/site.css">',
            '<link rel="stylesheet" href="/auth/site.css">\n<link rel="stylesheet" href="/assets/site.css">',
            1,
        )
    text = text.replace(
        "<footer>&copy; Roleflow. Instagram DM sales systems, paid on commission.</footer>",
        foot,
        1,
    )
    if 'src="/assets/site-config.js"' not in text.split("footer")[0]:
        pass
    path.write_text(text, encoding="utf-8")
    print("patched signup")


def home_jsonld():
    home = next(p for p in PAGES if p.get("home"))
    return json.dumps(jsonld(home, "en"), ensure_ascii=False, indent=1)


def patch_home():
    path = ROOT / "index.html"
    text = path.read_text(encoding="utf-8")
    title = "Roleflow | AI Client Acquisition Engine"
    desc = "AI Client Acquisition Engine for Instagram DMs. We build and run the system, answer every lead in seconds, and book qualified calls on your calendar today."
    if len(desc) < 150 or len(desc) > 160:
        raise SystemExit(len(desc))
    head_extra = f'''<title>{title}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="https://www.roleflow.io/">
<link rel="alternate" hreflang="en" href="https://www.roleflow.io/">
<link rel="alternate" hreflang="es" href="https://www.roleflow.io/es/">
<link rel="alternate" hreflang="x-default" href="https://www.roleflow.io/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Roleflow">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="https://www.roleflow.io/">
<meta property="og:image" content="https://www.roleflow.io/og-image.png">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="es_ES">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{html.escape(title)}">
<meta name="twitter:description" content="{html.escape(desc)}">
<meta name="twitter:image" content="https://www.roleflow.io/og-image.png">
<link rel="stylesheet" href="/assets/site.css">
<script type="application/ld+json">
{home_jsonld()}
</script>'''
    text = text.replace("<title>Roleflow: Stop losing $50K/mo on slow replies</title>", head_extra, 1)
    css = '''
.menu-toggle{top:14px;transform:none}
.geo-links{padding-top:0}
@media(max-width:760px){.menu-toggle{top:10px}}
'''
    if "z-index:6" not in text:
        text = text.replace("</style>", css + "</style>", 1)
    links = '''<nav class="geo-links" aria-label="Primary"><a href="/what-is-an-ai-dm-setter/">AI DM Setter</a><a href="/faq/">FAQ</a><a href="/best-ai-dm-setters/">Compare</a><span class="geo-lang"><a href="/" hreflang="en" lang="en" aria-current="page">EN</a> | <a href="/es/" hreflang="es" lang="es">ES</a></span></nav>'''
    text = text.replace(
        'Roleflow</div><button type="button" class="navlink menu-toggle"',
        'Roleflow</div>' + links + '<button type="button" class="navlink menu-toggle"',
        1,
    )
    text = text.replace(
        '<p class="sub">We build and run your Instagram DM system. It answers every lead in seconds and sends voice notes in your own voice. You pay 10% of what it earns. Answer 4 questions to see if you qualify.</p>',
        '<p class="sub">Roleflow is an AI Client Acquisition Engine. It answers every lead in seconds and sends voice notes in your own voice, cloned from a short recording. Answer 4 questions to see if you qualify.</p>',
        1,
    )
    text = text.replace(
        '<div class="panel" id="start"><div id="qz" tabindex="-1" style="outline:0" aria-live="polite"></div></div>',
        '<div id="quiz"><div class="panel" id="start"><div id="qz" tabindex="-1" style="outline:0" aria-live="polite"></div></div></div>',
        1,
    )
    answer = "Roleflow is an AI Client Acquisition Engine. We build and run your Instagram DM system. It replies to every inbound DM in seconds, sends voice notes in your own voice, cloned from a short recording, follows up only within 24 hours, and books qualified calls. Your closers take the calls."
    if not 40 <= words(answer) <= 60:
        raise SystemExit(f"home answer {words(answer)}")
    home = next(p for p in PAGES if p.get("home"))
    faq = faq_html(home["faq_en"], "FAQ")
    block = f'''<section class="geo-block" id="what"><div class="wrap">
<p class="answer">{html.escape(answer)}</p>
<h2>What Roleflow does</h2>
<div class="geo-grid">
<article><h3>Replies in seconds</h3><p>Every Instagram lead gets an answer.</p></article>
<article><h3>Voice notes in your own voice</h3><p>Notes are cloned from a short recording, not a generic template.</p></article>
<article><h3>Follow-ups and booked calls</h3><p>Follow-ups go out only within 24 hours. Qualified leads land on your calendar.</p></article>
<article><h3>Built and run for you</h3><p>We set up the Instagram DM system and we keep it running. Your closers take the calls that land on the calendar.</p></article>
</div>
</div></section>
<section class="geo-block"><div class="wrap">
<h2>Who it is for, and who it is not for</h2>
<div class="geo-grid">
<article><h3>For</h3><p>High-ticket coaches, consultants, course creators and agency owners on Instagram. You qualify with 20+ DMs a day, an offer above $1,000, a close rate above 20%, and $30k+ a month in cash collected.</p></article>
<article><h3>Not for</h3><p>Businesses that sell mainly on WhatsApp, email or phone. Low-ticket offers. Very low DM volume. Roleflow runs Instagram DMs only.</p></article>
</div>
</div></section>
<section class="geo-block"><div class="wrap">
{faq}
</div></section>
'''
    text = text.replace('<section style="padding-top:20px"><div class="wrap">\n  <h2>Questions</h2>', block + '<section style="padding-top:20px"><div class="wrap">\n  <h2>More questions</h2>', 1)
    text = text.replace(
        "<footer>&copy; Roleflow. Instagram DM sales systems, paid on commission.</footer>",
        footer(),
        1,
    )
    path.write_text(text, encoding="utf-8")
    print("patched home")


def main():
    # ES home is in PAGES with skip_en
    for page in PAGES:
        write_page(page, "en")
        write_page(page, "es")
    sitemap()
    robots()
    llms()
    vercel()
    images()
    print("done")


if __name__ == "__main__":
    main()
