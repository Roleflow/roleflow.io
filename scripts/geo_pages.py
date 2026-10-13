# -*- coding: utf-8 -*-
"""Crawlable page copy. Facts about competitors are cited in the page sources."""

def table(headers, rows):
    th = "".join(f"<th scope=\"col\">{h}</th>" for h in headers)
    body = []
    for row in rows:
        tds = "".join(f"<td>{c}</td>" for c in row[1:])
        body.append(f"<tr><th scope=\"row\">{row[0]}</th>{tds}</tr>")
    return "<div class=\"table-wrap\"><table><thead><tr>" + th + "</tr></thead><tbody>" + "".join(body) + "</tbody></table></div>"

FAQ_EN = [
    ("What is an AI DM setter?", "Software that answers inbound DMs, qualifies leads, follows up and books calls, doing the job of a human appointment setter. Roleflow is a done-for-you AI DM setter for Instagram.", True),
    ("What does Roleflow do?", "It replies to every Instagram DM in seconds, 24/7, sends voice notes in your cloned voice, follows up automatically, and books qualified leads on your calendar. We build and run it for you.", True),
    ("How much does it cost?", "$0 setup, $0 retainer. We're paid 5–7% of the revenue the system generates; the rate is set on your demo call.", True),
    ("How is \"revenue generated\" measured?", "[CONFIRM: attribution method, e.g. booked calls sourced from Roleflow conversations that close.]", False),
    ("Who qualifies?", "20+ DMs/day, an offer above $1k, a close rate above 20%, and $30k+/month collected.", True),
    ("Will it sound fake?", "Voice notes use your own cloned voice and replies follow your offer and tone. [CONFIRM: review/approval process.]", True),
    ("Is it safe for my Instagram account?", "[CONFIRM: official Meta API or not; messaging-window compliance.]", False),
    ("Do I still need my setters?", "Roleflow handles first response, follow-ups and booking; your closers take the calls.", True),
    ("Which channels?", "Instagram DMs only, for now.", True),
    ("How long does setup take?", "[CONFIRM]", False),
]
FAQ_ES = [
    ("¿Qué es un setter con IA?", "Un software que responde los DMs entrantes, califica leads, hace seguimiento y agenda llamadas: el trabajo de un appointment setter humano. Roleflow es un setter con IA para Instagram, hecho para ti.", True),
    ("¿Qué hace Roleflow?", "Responde cada DM de Instagram en segundos, 24/7, envía notas de voz con tu voz clonada, hace seguimientos automáticos y agenda a los leads calificados en tu calendario. Nosotros lo montamos y lo gestionamos.", True),
    ("¿Cuánto cuesta?", "$0 de setup y $0 de cuota mensual. Cobramos entre el 5 % y el 7 % de los ingresos que genera el sistema; el porcentaje se define en la llamada demo.", True),
    ("¿Cómo se mide lo que genera?", "[CONFIRMAR método de atribución.]", False),
    ("¿Quién califica?", "Más de 20 DMs al día, una oferta de más de $1.000, una tasa de cierre superior al 20 % y más de $30.000 cobrados al mes.", True),
    ("¿Va a sonar a bot?", "Las notas de voz usan tu propia voz clonada y las respuestas siguen tu oferta y tu tono. [CONFIRMAR proceso de revisión/aprobación.]", True),
    ("¿Es seguro para mi cuenta de Instagram?", "[CONFIRMAR API oficial de Meta.]", False),
    ("¿Sigo necesitando setters?", "Roleflow se encarga de la primera respuesta, los seguimientos y la agenda; tus closers hacen las llamadas.", True),
    ("¿Qué canales?", "Por ahora, solo DMs de Instagram.", True),
    ("¿Cuánto tarda la puesta en marcha?", "[CONFIRMAR]", False),
]
HOME_FAQ_EN = [
    ("What is an AI DM setter?", "An AI DM setter is software that replies to inbound direct messages, qualifies leads, follows up and books sales calls, doing the job of a human appointment setter. Roleflow is a done-for-you AI DM setter for Instagram.", True),
    ("How much does Roleflow cost?", "$0 setup and $0 monthly retainer. Roleflow is paid 5–7% of the revenue its system generates; the exact rate is set on the demo call.", True),
    ("Who is Roleflow for?", "High-ticket coaches, consultants and creators selling on Instagram with 20+ DMs a day, an offer over $1,000, a close rate over 20% and $30k+/month in cash collected.", True),
    ("Does it sound like a bot?", "Roleflow sends personal voice notes in your own cloned voice, plus written replies, so leads hear from you, not a generic template.", True),
    ("Which channels does Roleflow support?", "Instagram DMs only.", True),
]
HOME_FAQ_ES = [
    ("¿Qué es un setter con IA?", "Un setter con IA es un software que responde los mensajes directos, califica leads, hace seguimiento y agenda llamadas de venta: el trabajo de un appointment setter humano. Roleflow es un setter con IA para Instagram, hecho para ti.", True),
    ("¿Cuánto cuesta Roleflow?", "$0 de setup y $0 de cuota mensual. Roleflow cobra entre el 5 % y el 7 % de los ingresos que genera su sistema; el porcentaje exacto se define en la llamada demo.", True),
    ("¿Para quién es Roleflow?", "Coaches, consultores y creadores de ticket alto que venden en Instagram, con más de 20 DMs al día, una oferta de más de $1.000, una tasa de cierre superior al 20 % y más de $30.000 cobrados al mes.", True),
    ("¿Suena a bot?", "Roleflow envía notas de voz personales con tu propia voz clonada, además de respuestas escritas, para que el lead te escuche a ti y no a una plantilla genérica.", True),
    ("¿Qué canales cubre Roleflow?", "Solo DMs de Instagram.", True),
]

CHECKED = "13 October 2026"
CHECKED_ES = "13 de octubre de 2026"

def src(items):
    lis = "".join(f"<li>{item}</li>" for item in items)
    return f"<h2>Sources</h2><ol class=\"sources\">{lis}</ol>"

def src_es(items):
    lis = "".join(f"<li>{item}</li>" for item in items)
    return f"<h2>Fuentes</h2><ol class=\"sources\">{lis}</ol>"

ROLE_ROW = ["Roleflow", "Done for you", "$0 setup, $0 retainer, 5–7% of revenue generated", "Instagram DMs only", "Yes, in the owner's cloned voice", "Yes, automatic", "Yes, qualified calls", "Roleflow builds and runs it"]
VS_HEADERS = ["", "Model", "Pricing model", "Channels", "Voice notes in a cloned voice", "Follow-ups", "Calendar booking", "Setup effort"]

def links_en():
    return '<p>Read <a href="/what-is-an-ai-dm-setter/">what an AI DM setter is</a>, <a href="/pricing/">pricing</a>, the <a href="/faq/">FAQ</a>, and the <a href="/best-ai-dm-setters/">comparison list</a>.</p>'

def links_es():
    return '<p>Lee <a href="/es/que-es-un-setter-con-ia/">qué es un setter con IA</a>, <a href="/es/precios/">precios</a>, las <a href="/es/preguntas-frecuentes/">preguntas frecuentes</a> y la <a href="/es/mejores-setters-con-ia/">comparativa</a>.</p>'

SS_SOURCES = [
    f'SetSmart pricing page, checked {CHECKED}: <a href="https://setsmart.io/pricing">https://setsmart.io/pricing</a>. It lists a free 7-day trial (credit card required), a Pro plan at $99/month that includes 1,000 AI messages, usage-based pricing above that, custom enterprise pricing, and no setup fees or long-term contracts.',
    f'SetSmart llms.txt, checked {CHECKED}: <a href="https://setsmart.io/llms.txt">https://setsmart.io/llms.txt</a>. It describes Instagram, WhatsApp, and Facebook Messenger, and lists a Pro plan at $97/month for 1,000 messages. That dollar figure does not match the pricing page. [CONFIRM current checkout price.] The same file says SetSmart books appointments. Cloned-voice Instagram voice notes: [CONFIRM].',
]
ST_SOURCES = [
    f'Setterr pricing page, checked {CHECKED}: <a href="https://setterr.com/pricing/">https://setterr.com/pricing/</a>. $250/month for up to 500 AI conversations, or $400/month for up to 1,000. No per-lead fees, no commission, no contract. Replies in your voice trained on your DMs, calendar booking, and smart follow-ups are listed. Cloned-voice voice notes: [CONFIRM].',
]
SF_SOURCES = [
    f'SetterFlo homepage, checked {CHECKED}: <a href="https://www.setterflo.io/">https://www.setterflo.io/</a>. Plan cards on that page: Pilot Partner at $997 onboarding, described as done-for-you, then $297/month; Starter at $297/month, described as DIY; Enterprise, contact sales. Instagram accounts are named on the cards. The same page also shows other dollar figures in a comparison block. [CONFIRM which price a new customer is charged at checkout.] Cloned-voice voice notes: [CONFIRM].',
]
MC_SOURCES = [
    f'ManyChat pricing page, checked {CHECKED}: <a href="https://manychat.com/pricing">https://manychat.com/pricing</a>. Annual prices shown: $0, Essential $14/month, Pro $29/month, Business $69/month, Advanced $139/month. The page says the price depends on billing country. Channels named there include Instagram, Facebook Messenger, TikTok, Telegram, WhatsApp, SMS, and email. ManyChat describes itself as automation you use to reply to comments and messages. Cloned-voice voice notes and done-for-you setter setup: [CONFIRM].',
    'ManySetter is named beside ManyChat in the Roleflow GEO plan. ManySetter features and price: [CONFIRM].',
]

UNVERIFIED_EN = '''<h2>Tools we have not verified on their own sites</h2>
<p>Intellicoach, Appointwise, Instaset, and LeadsNow show up in category roundups. On {date} we did not copy a price, channel list, or feature from each company's own site, so those cells stay [CONFIRM]. Our notes describe LeadsNow as a pay-per-result name in public listicles. That is not a price from leadsnow.ai. [CONFIRM]</p>
<p>Wrong for Intellicoach: [CONFIRM]. Wrong for Appointwise: [CONFIRM]. Wrong for Instaset: [CONFIRM]. Wrong for LeadsNow: [CONFIRM].</p>'''.format(date=CHECKED)

UNVERIFIED_ES = '''<h2>Herramientas que no verificamos en su propio sitio</h2>
<p>Intellicoach, Instaset y WhatSetter aparecen en rondas del rubro. El {date} no copiamos precio, canales ni funciones desde el sitio de cada empresa, así que esas celdas quedan en [CONFIRM]. WhatSetter entra en esta lista para quien vende por WhatsApp. Funciones y precio de WhatSetter: [CONFIRM].</p>
<p>No recomendable si, Intellicoach: [CONFIRM]. Instaset: [CONFIRM]. WhatSetter: [CONFIRM].</p>'''.format(date=CHECKED_ES)
