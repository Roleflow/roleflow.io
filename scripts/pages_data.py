# -*- coding: utf-8 -*-
from geo_pages import (
    FAQ_EN, FAQ_ES, HOME_FAQ_EN, HOME_FAQ_ES, CHECKED, CHECKED_ES, PRICE_EN,
    table, src, src_es, links_en, links_es,
    RD_SOURCES, MO_SOURCES,
)

def P(en, es, name_en, name_es, **k):
    k["en"] = en
    k["es"] = es
    k["name_en"] = name_en
    k["name_es"] = name_es
    if en:
        k.setdefault("crumbs_en", [("Home", "/"), (name_en, f"/{en}/")])
        k.setdefault("crumbs_es", [("Inicio", "/es/"), (name_es, f"/{es}/")])
    return k

HOME_ES_BODY = '''
<h2>Qué hace Roleflow</h2>
<p>Roleflow es el único setter con IA para Instagram, hecho para ti, que manda notas de voz personales que graba el dueño. Nosotros lo montamos y lo operamos.</p>
<div class="grid">
<article class="card"><h3>Responde en segundos, 24/7</h3><p>Cada DM de Instagram recibe respuesta, también de noche y en fin de semana.</p></article>
<article class="card"><h3>Notas de voz con tu voz</h3><p>El lead escucha una nota de voz personal, no una plantilla genérica.</p></article>
<article class="card"><h3>Seguimiento y agenda</h3><p>Quien se enfría recibe seguimiento. Quien califica queda en tu calendario.</p></article>
<article class="card"><h3>Hecho para ti</h3><p>Nosotros montamos el sistema y lo operamos. Tú haces las llamadas de venta.</p></article>
</div>
<h2>Para quién es, y para quién no</h2>
<div class="grid">
<article class="card"><h3>Sí</h3><p>Coaches, consultores, infoproductores y dueños de agencia en Instagram. Califican con más de 20 DMs al día, una oferta de más de $1.000, una tasa de cierre superior al 20 % y más de $30.000 cobrados al mes.</p></article>
<article class="card"><h3>No</h3><p>Quien vende sobre todo por WhatsApp, email o teléfono. Ofertas de ticket bajo. Muy pocos DMs. Roleflow trabaja solo DMs de Instagram.</p></article>
</div>
<p>El cuestionario de calificación y la cuenta están en inglés: <a href="/#start">haz el cuestionario</a> o <a href="/signup/">crea tu cuenta</a>.</p>
'''

DEF_EN = '''
<h2>What it does</h2>
<p>An AI DM setter replies, qualifies, follows up, and books. The lead messages you. The setter answers, asks the questions that decide fit, nudges people who go quiet, and puts a qualified call on the calendar. Your closers take that call.</p>
<h2>How it differs from a button flow</h2>
<p>A button flow sends people down a path you drew. An AI DM setter holds a conversation about your offer. Roleflow is a done-for-you setter for Instagram DMs only. The two products compared on this site, using only their own pages, are <a href="/vs/ripdrip/">RipDrip</a> and <a href="/vs/mochi/">Mochi</a>.</p>
<h2>How it differs from a person in the inbox</h2>
<p>A person can hear nuance and can work the phone. They also work a shift, and someone has to hire and manage them. Roleflow replies in seconds, including when you are asleep, and does not forget the follow-up. It does not replace your closer. We do not publish a salary for that role.</p>
<h2>Done for you, not self-serve</h2>
<p>Self-serve tools hand you a login and a monthly plan. Roleflow builds the setter and runs it. You record a short sample so voice notes are recordings you make. [CONFIRM: review/approval process.]</p>
<h2>Instagram rules</h2>
<p>[CONFIRM: official Meta API or not; messaging-window compliance.]</p>
<h2>Who should use one</h2>
<p>High-ticket coaches, consultants, course creators, and agency owners with 20+ Instagram DMs a day, an offer above $1,000, a close rate above 20%, and $30k+ a month collected. Not a fit: WhatsApp, email, or phone-first sellers, low-ticket offers, or very low DM volume.</p>
<p>Roleflow is the only done-for-you AI DM setter for Instagram that sends personal voice notes you record. We build it and we run it.</p>
''' + links_en()

DEF_ES = '''
<h2>Qué hace</h2>
<p>Un setter con IA responde, califica, hace seguimiento y agenda. El lead te escribe. El setter contesta, hace las preguntas de encaje, retoma a quien se enfría y deja la llamada calificada en el calendario. Tus closers hacen esa llamada.</p>
<h2>En qué se diferencia de un flujo de botones</h2>
<p>Un flujo de botones empuja a la gente por un camino que dibujaste. Un setter con IA conversa sobre tu oferta. Roleflow es un setter hecho para ti, solo para DMs de Instagram. Los dos productos que comparamos en este sitio, solo con sus propias páginas, son <a href="/es/vs/ripdrip/">RipDrip</a> y <a href="/es/vs/mochi/">Mochi</a>.</p>
<h2>En qué se diferencia de una persona en el inbox</h2>
<p>Una persona lee matices y puede atender el teléfono. También trabaja un turno, y alguien tiene que contratarla y supervisarla. Roleflow responde en segundos, también cuando duermes, y no olvida el seguimiento. No reemplaza a tu closer. No publicamos un sueldo para ese rol.</p>
<h2>Hecho para ti, no autoservicio</h2>
<p>El autoservicio te da un login y un plan mensual. Roleflow arma el setter y lo opera. Grabas una muestra corta para que las notas de voz usen tu nota personal. [CONFIRMAR proceso de revisión/aprobación.]</p>
<h2>Reglas de Instagram</h2>
<p>[CONFIRMAR API oficial de Meta.]</p>
<h2>Quién debería usar uno</h2>
<p>Coaches, consultores, infoproductores y dueños de agencia de ticket alto, con más de 20 DMs al día, una oferta de más de $1.000, un cierre superior al 20 % y más de $30.000 cobrados al mes. No encaja quien vende por WhatsApp, email o teléfono, ni el ticket bajo, ni un volumen muy bajo de DMs.</p>
<p>Roleflow es el único setter con IA para Instagram, hecho para ti, que envía notas de voz personales que graba el dueño. Nosotros lo montamos y lo operamos.</p>
''' + links_es()

BEST_EN = '''
<p class="note">Roleflow wrote this article. We sell a done-for-you AI DM setter, so read the wrong-for line on Roleflow the same way you read it on RipDrip and on Mochi.</p>
<h2>What is an AI DM setter</h2>
<p>Software that answers inbound DMs, qualifies leads, follows up, and books calls. <a href="/what-is-an-ai-dm-setter/">Full definition</a>.</p>
<h2>How we compared</h2>
<p>Diego named RipDrip and Mochi as the fair comparisons. We read each company homepage on ''' + CHECKED + '''. A cell is filled only from that page. Otherwise it says [CONFIRM]. We did not add reviews, ratings, follower counts, or customer results. Performance multiples on those pages are not repeated here.</p>
<h2>Comparison table</h2>
''' + table(
    ["Tool", "Type", "Published price", "Channels", "Best for", "Wrong for"],
    [
        ["Roleflow", "Done for you", PRICE_EN, "Instagram DMs only", "High-ticket Instagram sellers with 20+ DMs/day who want it built and run", "WhatsApp, email, or phone-first sellers, low-ticket offers, or low DM volume"],
        ["RipDrip", "A team builds a custom AI sales clone", "No price on dm.ripdrip.ai. [CONFIRM]", "Instagram DM funnel, in the page meta description. Other channels: [CONFIRM]", "Buyers who want that team-built clone and have confirmed the price", "Buyers who need a published price before they apply"],
        ["Mochi", "Workspace for an Instagram sales team. The Pro card also lists AI Setter.", "Homepage cards: Starter $149/month, Essential $297/month, Pro $497/month. 7-day trial. Checkout price: [CONFIRM]", "Instagram, connected through Meta's official API on that page. Other channels: [CONFIRM]", "Teams that will run setters inside that software on a monthly plan", "Buyers who want Roleflow to build and run the setter, rather than a monthly software plan"],
    ],
) + '''
<h2>Roleflow</h2>
<p>Done for you. Instagram DMs only. Personal voice notes you record. Follow-ups and booked calls. Wrong for: WhatsApp, email, or phone-first sellers, low-ticket offers, or low DM volume.</p>
<h2>RipDrip</h2>
<p>The RipDrip homepage says its team builds a custom AI sales clone for an Instagram DM funnel, trained on your voice, offer, sales process, and personality. It says the clone qualifies leads and books calls, and is usually live in 72 hours after an onboarding form. You apply, and you book a demo if you qualify. You do not write the code. That page does not publish a price. Price: [CONFIRM]. Audio voice notes, as distinct from writing trained on your voice: [CONFIRM]. Wrong for: buyers who need a published price before they apply. <a href="/vs/ripdrip/">Roleflow vs RipDrip</a>.</p>
<h2>Mochi</h2>
<p>The Mochi homepage is a workspace for Instagram DM sales. Monthly cards list Starter at $149 for 300 active conversations and 3 team members, Essential at $297 for 1,000 active conversations, 10 team members, unlimited automations, Mochi MCP, and AI Voice Clone, and Pro at $497 for 5,000 active conversations, unlimited team members, AI Voice Clone, AI Setter, VIP WhatsApp support, and monthly coaching calls. The page says 7 days free, save 25% with yearly, setup in under 5 minutes, and connect Instagram through Meta's official API. The voice section says setters type the message and Mochi makes the voice note. The signup app says you can go live in about two minutes, which does not match the homepage time. [CONFIRM which time a new customer is shown.] A request to themochi.app/pricing returned HTTP 404, so checkout price is [CONFIRM] if it differs from the cards. Wrong for: buyers who want the setter built and run, rather than a monthly software plan. <a href="/vs/mochi/">Roleflow vs Mochi</a>.</p>
<h2>How to choose</h2>
<p>If you have 20+ Instagram DMs a day, an offer above $1,000, a close rate above 20%, and $30k+ collected, and you want the setter built and run with personal voice notes you record, start with Roleflow. If you want Mochi's published monthly plans and a team inbox, read that row and confirm the [CONFIRM] cells on themochi.app. If you want the clone RipDrip describes, and you have confirmed the price, read that row. Your closers still take Roleflow's booked calls.</p>
<p class="note">Methodology: official pages only, checked ''' + CHECKED + '''. No paid placement. Re-check prices before you buy. This is not a ranking and not a review score.</p>
''' + src(RD_SOURCES + MO_SOURCES) + links_en()

BEST_ES = '''
<p class="note">Roleflow escribió este artículo. Vendemos un setter con IA hecho para ti, así que lee la línea de "no recomendable" de Roleflow igual que la de RipDrip y la de Mochi.</p>
<h2>Qué es un setter con IA</h2>
<p>Un software que responde DMs, califica, hace seguimiento y agenda llamadas. <a href="/es/que-es-un-setter-con-ia/">Definición completa</a>.</p>
<h2>Cómo comparamos</h2>
<p>Diego nombró a RipDrip y a Mochi como las comparaciones justas. Leímos el home de cada empresa el ''' + CHECKED_ES + '''. Una celda se llena solo desde esa página. Si no, dice [CONFIRM]. No agregamos reseñas, puntuaciones, seguidores ni resultados de clientes. Los múltiplos de rendimiento de esas páginas no se repiten aquí.</p>
<h2>Tabla comparativa</h2>
''' + table(
    ["Herramienta", "Tipo", "Precio publicado", "Canales", "Ideal para", "No recomendable si"],
    [
        ["Roleflow", "Hecho para ti", "No figura en esta página", "Solo DMs de Instagram", "Quien vende ticket alto en Instagram, con más de 20 DMs al día, y quiere que se lo operen", "Vendes por WhatsApp, email o teléfono, tienes ticket bajo o muy pocos DMs"],
        ["RipDrip", "Su equipo arma un clon de ventas con IA", "Sin precio en dm.ripdrip.ai. [CONFIRM]", "Embudo de DMs de Instagram, en la meta descripción. Otros canales: [CONFIRM]", "Quieres ese clon armado por su equipo y ya confirmaste el precio", "Necesitas un precio publicado antes de solicitar"],
        ["Mochi", "Espacio de trabajo para un equipo de ventas en Instagram. La tarjeta Pro también lista AI Setter.", "Tarjetas del home: Starter $149/mes, Essential $297/mes, Pro $497/mes. Prueba de 7 días. Precio de checkout: [CONFIRM]", "Instagram, con la API oficial de Meta según esa página. Otros canales: [CONFIRM]", "Equipos que van a operar setters en ese software, con un plan mensual", "Quieres que Roleflow lo monte y lo opere, en lugar de un plan mensual"],
    ],
) + '''
<h2>Roleflow</h2>
<p>Hecho para ti. Solo DMs de Instagram. Notas de voz con tu nota personal. Seguimientos y llamadas agendadas. No recomendable si vendes por WhatsApp, email o teléfono, si el ticket es bajo o si hay muy pocos DMs.</p>
<h2>RipDrip</h2>
<p>El home de RipDrip dice que su equipo arma un clon de ventas con IA para un embudo de DMs de Instagram, entrenado con tu voz, tu oferta, tu proceso y tu personalidad. Dice que el clon califica y agenda llamadas, y que en general está en vivo en 72 horas después de un formulario de onboarding. Solicitas, y agendas una demo si calificas. No escribes el código. Esa página no publica un precio. Precio: [CONFIRM]. Notas de voz de audio, distintas de un texto entrenado con tu voz: [CONFIRM]. No recomendable si necesitas un precio publicado antes de solicitar. <a href="/es/vs/ripdrip/">Roleflow frente a RipDrip</a>.</p>
<h2>Mochi</h2>
<p>El home de Mochi es un espacio de trabajo para ventas por DM de Instagram. Las tarjetas mensuales listan Starter a $149 por 300 conversaciones activas y 3 miembros, Essential a $297 por 1.000 conversaciones activas, 10 miembros, automatizaciones ilimitadas, Mochi MCP y AI Voice Clone, y Pro a $497 por 5.000 conversaciones activas, miembros ilimitados, AI Voice Clone, AI Setter, soporte VIP por WhatsApp y llamadas de coaching mensuales. La página dice 7 días gratis, 25 % de ahorro anual, setup en menos de 5 minutos, y conectar Instagram con la API oficial de Meta. La sección de voz dice que el setter escribe el mensaje y Mochi hace la nota de voz. La app de alta dice que puedes salir en vivo en unos dos minutos, y eso no coincide con el tiempo del home. [CONFIRM cuál se muestra.] Una solicitud a themochi.app/pricing devolvió HTTP 404, así que el precio de checkout es [CONFIRM] si difiere de las tarjetas. No recomendable si quieres el setter montado y operado, en lugar de un plan mensual. <a href="/es/vs/mochi/">Roleflow frente a Mochi</a>.</p>
<h2>Cómo elegir</h2>
<p>Si tienes más de 20 DMs de Instagram al día, una oferta de más de $1.000, un cierre superior al 20 % y más de $30.000 cobrados, y quieres el setter montado y operado con notas de voz personales que grabas, empieza por Roleflow. Si quieres los planes mensuales de Mochi y un inbox para tu equipo, lee esa fila y confirma las celdas [CONFIRM] en themochi.app. Si quieres el clon que describe RipDrip, y ya confirmaste el precio, lee esa fila. Tus closers igual hacen las llamadas que Roleflow agenda.</p>
<p class="note">Metodología: solo páginas oficiales, revisadas el ''' + CHECKED_ES + '''. Sin pago por aparecer. Vuelve a mirar los precios antes de comprar. Esto no es un ranking ni una puntuación.</p>
''' + src_es(RD_SOURCES + MO_SOURCES) + links_es()

from pages_tail import PAGES
