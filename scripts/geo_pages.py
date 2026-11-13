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
    ("What is an AI DM setter?", "An AI DM setter is the name people search for software that answers inbound DMs, qualifies leads, follows up, and books calls. Roleflow is an AI Client Acquisition Engine. We build and run your Instagram DM system.", True),
    ("What does Roleflow do?", "We build and run your Instagram DM system. Every lead is answered in seconds. Voice notes go out in your own voice, cloned from a short recording. Follow-ups are sent automatically, only within 24 hours. Qualified leads are booked on your calendar.", True),
    ("Who qualifies?", "20+ DMs/day, an offer above $1k, a close rate above 20%, and $30k+/month cash collected.", True),
    ("Will it sound fake?", "Voice notes are in your own voice, cloned from a short recording, and replies follow your offer and tone.", True),
    ("Do I still need my setters?", "Roleflow handles first response, follow-ups within 24 hours, and booking. Your closers take the calls.", True),
    ("Which channels?", "Instagram DMs only.", True),
    ("How does Roleflow compare with RipDrip?", "RipDrip's homepage says it builds a custom AI sales clone for an Instagram DM funnel, usually live in 72 hours, and that its team does the build. That page does not publish a price. Roleflow is an AI Client Acquisition Engine we build and run, with voice notes in your own voice. See the comparison for sources.", True),
    ("How does Roleflow compare with Mochi?", "Mochi's homepage lists monthly plans at $149, $297, and $497, a 7-day trial, and an Instagram inbox your team uses. Voice notes on the Essential and Pro cards are typed by setters. Roleflow builds and runs the Instagram DM system. See the comparison for sources.", True),
]
FAQ_ES = [
    ("¿Qué es un setter con IA?", "Un setter con IA es el nombre de la búsqueda: un software que responde los DMs entrantes, califica leads, hace seguimiento y agenda llamadas. Roleflow es un motor de adquisición de clientes con IA. Nosotros montamos y operamos tu sistema de DMs de Instagram.", True),
    ("¿Qué hace Roleflow?", "Montamos y operamos tu sistema de DMs de Instagram. Cada lead recibe respuesta en segundos. Las notas de voz salen en tu propia voz, clonadas de una grabación corta. El seguimiento sale solo dentro de 24 horas. Los leads calificados quedan en tu calendario.", True),
    ("¿Quién califica?", "Más de 20 DMs al día, una oferta de más de $1.000, una tasa de cierre superior al 20 % y más de $30.000 cobrados al mes.", True),
    ("¿Va a sonar a bot?", "Las notas de voz salen en tu propia voz, clonadas de una grabación corta, y las respuestas siguen tu oferta y tu tono.", True),
    ("¿Sigo necesitando setters?", "Roleflow se encarga de la primera respuesta, los seguimientos dentro de 24 horas y la agenda; tus closers hacen las llamadas.", True),
    ("¿Qué canales?", "Solo DMs de Instagram.", True),
    ("¿Cómo se compara Roleflow con RipDrip?", "El home de RipDrip dice que arma un clon de ventas con IA para un embudo de DMs de Instagram, en general en 72 horas, y que su equipo hace el montaje. Esa página no publica un precio. Roleflow es un motor de adquisición de clientes con IA. La comparativa trae las fuentes.", True),
    ("¿Cómo se compara Roleflow con Mochi?", "El home de Mochi lista planes mensuales de $149, $297 y $497, 7 días de prueba y un inbox de Instagram que usa tu equipo. Las notas de voz que suenan como tú están en Essential y Pro, y el setter escribe el mensaje. Roleflow monta y opera el sistema de DMs. La comparativa trae las fuentes.", True),
]
HOME_FAQ_EN = [
    ("What is an AI DM setter?", "An AI DM setter is the search name for software that replies to inbound direct messages, qualifies leads, follows up, and books sales calls. Roleflow is an AI Client Acquisition Engine for Instagram DMs.", True),
    ("Who is Roleflow for?", "High-ticket coaches, consultants and creators selling on Instagram with 20+ DMs a day, an offer over $1,000, a close rate over 20% and $30k+/month in cash collected.", True),
    ("Does it sound like a bot?", "Roleflow sends voice notes in your own voice, cloned from a short recording, plus written replies, so leads hear you, not a generic template.", True),
    ("Which channels does Roleflow support?", "Instagram DMs only.", True),
]
HOME_FAQ_ES = [
    ("¿Qué es un setter con IA?", "Un setter con IA es el nombre de la búsqueda: un software que responde los mensajes directos, califica leads, hace seguimiento y agenda llamadas de venta. Roleflow es un motor de adquisición de clientes con IA para DMs de Instagram.", True),
    ("¿Para quién es Roleflow?", "Coaches, consultores y creadores de ticket alto que venden en Instagram, con más de 20 DMs al día, una oferta de más de $1.000, una tasa de cierre superior al 20 % y más de $30.000 cobrados al mes.", True),
    ("¿Suena a bot?", "Roleflow envía notas de voz en tu propia voz, clonadas de una grabación corta, además de respuestas escritas, para que el lead te escuche a ti y no a una plantilla genérica.", True),
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

ROLE_ROW = ["Roleflow", "Built and run for you", "$0 upfront + 10% of revenue generated, no retainer", "Instagram DMs only", "Yes, cloned from a short recording", "Yes, only within 24 hours", "Yes, qualified calls", "Roleflow builds and runs it"]
ROLE_ROW_ES = ["Roleflow", "Lo montamos y lo operamos", "No figura en esta página", "Solo DMs de Instagram", "Sí, clonadas de una grabación corta", "Sí, solo dentro de 24 horas", "Sí, llamadas calificadas", "Roleflow lo monta y lo opera"]
VS_HEADERS = ["", "Model", "Pricing model", "Channels", "Personal voice notes", "Follow-ups", "Calendar booking", "Setup effort"]
VS_HEADERS_ES = ["", "Modelo", "Modelo de precio", "Canales", "Notas de voz personales", "Seguimientos", "Agenda", "Esfuerzo de puesta en marcha"]

def links_en():
    return '<p>Read <a href="/what-is-an-ai-dm-setter/">what an AI DM setter is</a>, the <a href="/faq/">FAQ</a>, and the <a href="/best-ai-dm-setters/">comparison list</a>.</p>'

def links_es():
    return '<p>Lee <a href="/es/que-es-un-setter-con-ia/">qué es un setter con IA</a>, las <a href="/es/preguntas-frecuentes/">preguntas frecuentes</a> y la <a href="/es/mejores-setters-con-ia/">comparativa</a>.</p>'

RD_SOURCES = [
    f'RipDrip homepage, checked {CHECKED}: <a href="https://dm.ripdrip.ai/">https://dm.ripdrip.ai/</a>. The page meta description says RipDrip builds a custom AI sales clone that handles an Instagram DM funnel 24/7. The page says the clone qualifies leads and books calls, is trained on your voice, offer, sales process, and personality, and is usually live in 72 hours after you fill an onboarding form. It says the dev team handles the build and you do not touch code. Apply, then a demo call if you qualify. No price is published on that page.',
]
MO_SOURCES = [
    f'Mochi homepage, checked {CHECKED}: <a href="https://themochi.app/">https://themochi.app/</a>. Monthly cards: Starter $149/month for 300 active conversations and 3 team members; Essential $297/month for 1,000 active conversations, 10 team members, unlimited automations, Mochi MCP, and AI Voice Clone; Pro $497/month for 5,000 active conversations, unlimited team members, AI Voice Clone, AI Setter, VIP WhatsApp support, and monthly coaching calls. The page also says 7 days free, save 25% with yearly, setup in under 5 minutes, and connect Instagram through Meta\'s official API. The AI Voice Cloning section says setters type the message and Mochi turns it into a voice note in your voice. A request to https://themochi.app/pricing on the same date returned HTTP 404, so a checkout price that differs from these cards is not shown on that page.',
    f'Mochi signup page, checked {CHECKED}: <a href="https://use.themochi.app/">https://use.themochi.app/</a>. It says every plan starts with 7 days free and that you can connect Instagram, invite the team, and go live in about two minutes. That setup time does not match the homepage line "under 5 minutes."',
]

