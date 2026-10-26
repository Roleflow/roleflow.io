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
    ("What does Roleflow do?", "It replies to every Instagram DM in seconds, 24/7, sends personal voice notes you record, follows up automatically, and books qualified leads on your calendar. We build and run it for you.", True),
    ("How much does it cost?", "$0 setup, $0 retainer. Roleflow takes 10% of the cash you record on deals the system sourced. If you record nothing, nothing is owed.", True),
    ("How is \"revenue generated\" measured?", "[CONFIRM: attribution method, e.g. booked calls sourced from Roleflow conversations that close.]", False),
    ("Who qualifies?", "20+ DMs/day, an offer above $1k, a close rate above 20%, and $30k+/month collected.", True),
    ("Will it sound fake?", "Voice notes are personal voice notes you record, and replies follow your offer and tone. [CONFIRM: review/approval process.]", True),
    ("Is it safe for my Instagram account?", "[CONFIRM: official Meta API or not; messaging-window compliance.]", False),
    ("Do I still need my setters?", "Roleflow handles first response, follow-ups and booking; your closers take the calls.", True),
    ("Which channels?", "Instagram DMs only, for now.", True),
    ("How long does setup take?", "[CONFIRM]", False),
    ("How does Roleflow compare with RipDrip?", "RipDrip's homepage says it builds a custom AI sales clone for an Instagram DM funnel, usually live in 72 hours, and that its team does the build. That page does not publish a price. Roleflow is paid 10% of revenue it generates, with $0 setup and personal voice notes you record. See the comparison for sources.", True),
    ("How does Roleflow compare with Mochi?", "Mochi's homepage lists monthly plans at $149, $297, and $497, a 7-day trial, and an Instagram inbox your team uses. Voice notes that sound like you are on the Essential and Pro cards, and setters type the message. Roleflow builds and runs the setter for a percent of revenue. See the comparison for sources.", True),
]
FAQ_ES = [
    ("¿Qué es un setter con IA?", "Un software que responde los DMs entrantes, califica leads, hace seguimiento y agenda llamadas: el trabajo de un appointment setter humano. Roleflow es un setter con IA para Instagram, hecho para ti.", True),
    ("¿Qué hace Roleflow?", "Responde cada DM de Instagram en segundos, 24/7, envía notas de voz personales que grabas, hace seguimientos automáticos y agenda a los leads calificados en tu calendario. Nosotros lo montamos y lo gestionamos.", True),
    ("¿Cuánto cuesta?", "$0 de setup y $0 de cuota mensual. Cobramos el 10 % del dinero cobrado que registras en las ventas que originó el sistema. Si no registras nada, no debes nada.", True),
    ("¿Cómo se mide lo que genera?", "[CONFIRMAR método de atribución.]", False),
    ("¿Quién califica?", "Más de 20 DMs al día, una oferta de más de $1.000, una tasa de cierre superior al 20 % y más de $30.000 cobrados al mes.", True),
    ("¿Va a sonar a bot?", "Las notas de voz usan notas de voz que grabas tú y las respuestas siguen tu oferta y tu tono. [CONFIRMAR proceso de revisión/aprobación.]", True),
    ("¿Es seguro para mi cuenta de Instagram?", "[CONFIRMAR API oficial de Meta.]", False),
    ("¿Sigo necesitando setters?", "Roleflow se encarga de la primera respuesta, los seguimientos y la agenda; tus closers hacen las llamadas.", True),
    ("¿Qué canales?", "Por ahora, solo DMs de Instagram.", True),
    ("¿Cuánto tarda la puesta en marcha?", "[CONFIRMAR]", False),
    ("¿Cómo se compara Roleflow con RipDrip?", "El home de RipDrip dice que arma un clon de ventas con IA para un embudo de DMs de Instagram, en general en 72 horas, y que su equipo hace el montaje. Esa página no publica un precio. Roleflow cobra el 10 % de los ingresos, con $0 de setup y notas de voz personales. La comparativa trae las fuentes.", True),
    ("¿Cómo se compara Roleflow con Mochi?", "El home de Mochi lista planes mensuales de $149, $297 y $497, 7 días de prueba y un inbox de Instagram que usa tu equipo. Las notas de voz que suenan como tú están en Essential y Pro, y el setter escribe el mensaje. Roleflow monta y opera el setter por un porcentaje. La comparativa trae las fuentes.", True),
]
HOME_FAQ_EN = [
    ("What is an AI DM setter?", "An AI DM setter is software that replies to inbound direct messages, qualifies leads, follows up and books sales calls, doing the job of a human appointment setter. Roleflow is a done-for-you AI DM setter for Instagram.", True),
    ("How much does Roleflow cost?", "$0 setup and $0 monthly retainer. Roleflow takes 10% of the cash you record on deals its system sourced. If you record nothing, nothing is owed.", True),
    ("Who is Roleflow for?", "High-ticket coaches, consultants and creators selling on Instagram with 20+ DMs a day, an offer over $1,000, a close rate over 20% and $30k+/month in cash collected.", True),
    ("Does it sound like a bot?", "Roleflow sends personal voice notes you record, plus written replies, so leads hear from you, not a generic template.", True),
    ("Which channels does Roleflow support?", "Instagram DMs only.", True),
]
HOME_FAQ_ES = [
    ("¿Qué es un setter con IA?", "Un setter con IA es un software que responde los mensajes directos, califica leads, hace seguimiento y agenda llamadas de venta: el trabajo de un appointment setter humano. Roleflow es un setter con IA para Instagram, hecho para ti.", True),
    ("¿Cuánto cuesta Roleflow?", "$0 de setup y $0 de cuota mensual. Roleflow cobra el 10 % del dinero cobrado que registras en las ventas que originó su sistema. Si no registras nada, no debes nada.", True),
    ("¿Para quién es Roleflow?", "Coaches, consultores y creadores de ticket alto que venden en Instagram, con más de 20 DMs al día, una oferta de más de $1.000, una tasa de cierre superior al 20 % y más de $30.000 cobrados al mes.", True),
    ("¿Suena a bot?", "Roleflow envía notas de voz personales con notas de voz que grabas tú, además de respuestas escritas, para que el lead te escuche a ti y no a una plantilla genérica.", True),
    ("¿Qué canales cubre Roleflow?", "Solo DMs de Instagram.", True),
]

CHECKED = "14 October 2026"
CHECKED_ES = "14 de octubre de 2026"

def src(items):
    lis = "".join(f"<li>{item}</li>" for item in items)
    return f"<h2>Sources</h2><ol class=\"sources\">{lis}</ol>"

def src_es(items):
    lis = "".join(f"<li>{item}</li>" for item in items)
    return f"<h2>Fuentes</h2><ol class=\"sources\">{lis}</ol>"

ROLE_ROW = ["Roleflow", "Done for you", "$0 setup, $0 retainer, 10% of revenue generated", "Instagram DMs only", "Yes, personal voice notes you record", "Yes, automatic", "Yes, qualified calls", "Roleflow builds and runs it"]
ROLE_ROW_ES = ["Roleflow", "Hecho para ti", "$0 de setup, $0 de cuota, el 10 % de los ingresos", "Solo DMs de Instagram", "Sí, con grabaciones personales del dueño", "Sí, automáticos", "Sí, llamadas calificadas", "Roleflow lo monta y lo opera"]
VS_HEADERS = ["", "Model", "Pricing model", "Channels", "Personal voice notes", "Follow-ups", "Calendar booking", "Setup effort"]
VS_HEADERS_ES = ["", "Modelo", "Modelo de precio", "Canales", "Notas de voz personales", "Seguimientos", "Agenda", "Esfuerzo de puesta en marcha"]

def links_en():
    return '<p>Read <a href="/what-is-an-ai-dm-setter/">what an AI DM setter is</a>, <a href="/pricing/">pricing</a>, the <a href="/faq/">FAQ</a>, and the <a href="/best-ai-dm-setters/">comparison list</a>.</p>'

def links_es():
    return '<p>Lee <a href="/es/que-es-un-setter-con-ia/">qué es un setter con IA</a>, <a href="/es/precios/">precios</a>, las <a href="/es/preguntas-frecuentes/">preguntas frecuentes</a> y la <a href="/es/mejores-setters-con-ia/">comparativa</a>.</p>'

RD_SOURCES = [
    f'RipDrip homepage, checked {CHECKED}: <a href="https://dm.ripdrip.ai/">https://dm.ripdrip.ai/</a>. The page meta description says RipDrip builds a custom AI sales clone that handles an Instagram DM funnel 24/7. The page says the clone qualifies leads and books calls, is trained on your voice, offer, sales process, and personality, and is usually live in 72 hours after you fill an onboarding form. It says the dev team handles the build and you do not touch code. Apply, then a demo call if you qualify. No price is published on that page. Price: [CONFIRM]. Audio voice notes in a cloned voice, as distinct from writing trained on your voice: [CONFIRM]. Channels other than the Instagram DM funnel named in that meta description: [CONFIRM].',
]
MO_SOURCES = [
    f'Mochi homepage, checked {CHECKED}: <a href="https://themochi.app/">https://themochi.app/</a>. Monthly cards: Starter $149/month for 300 active conversations and 3 team members; Essential $297/month for 1,000 active conversations, 10 team members, unlimited automations, Mochi MCP, and AI Voice Clone; Pro $497/month for 5,000 active conversations, unlimited team members, AI Voice Clone, AI Setter, VIP WhatsApp support, and monthly coaching calls. The page also says 7 days free, save 25% with yearly, setup in under 5 minutes, and connect Instagram through Meta\'s official API. The AI Voice Cloning section says setters type the message and Mochi turns it into a voice note in your voice. A request to https://themochi.app/pricing on the same date returned HTTP 404, so the price charged at checkout is [CONFIRM] if it differs from these cards.',
    f'Mochi signup page, checked {CHECKED}: <a href="https://use.themochi.app/">https://use.themochi.app/</a>. It says every plan starts with 7 days free and that you can connect Instagram, invite the team, and go live in about two minutes. That setup time does not match the homepage line "under 5 minutes." [CONFIRM which time a new customer is shown.]',
]

