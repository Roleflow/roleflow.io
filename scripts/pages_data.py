# -*- coding: utf-8 -*-
from geo_pages import (
    FAQ_EN, FAQ_ES, HOME_FAQ_EN, HOME_FAQ_ES, CHECKED, CHECKED_ES,
    table, src, src_es, links_en, links_es, ROLE_ROW, VS_HEADERS,
    SS_SOURCES, ST_SOURCES, SF_SOURCES, MC_SOURCES, UNVERIFIED_EN, UNVERIFIED_ES,
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
<p>Roleflow es el único setter con IA para Instagram, hecho para ti, que manda notas de voz con la voz clonada del dueño, con $0 de setup, $0 de cuota y entre el 5 % y el 7 % de los ingresos que genera.</p>
<div class="grid">
<article class="card"><h3>Responde en segundos, 24/7</h3><p>Cada DM de Instagram recibe respuesta, también de noche y en fin de semana.</p></article>
<article class="card"><h3>Notas de voz con tu voz</h3><p>El lead escucha una nota en tu voz clonada, no una plantilla genérica.</p></article>
<article class="card"><h3>Seguimiento y agenda</h3><p>Quien se enfría recibe seguimiento. Quien califica queda en tu calendario.</p></article>
<article class="card"><h3>$0 por adelantado</h3><p>Sin setup y sin cuota. El fee es del 5 % al 7 % de lo que genera, y nosotros lo montamos y lo operamos.</p></article>
</div>
<h2>Precio</h2>
<p>$0 de setup, $0 de cuota, del 5 % al 7 % de los ingresos. El porcentaje se define en la demo. <a href="/es/precios/">Ver precios</a>. [CONFIRM whether 5–7% is the final published range.]</p>
<h2>Para quién es, y para quién no</h2>
<div class="grid">
<article class="card"><h3>Sí</h3><p>Coaches, consultores, infoproductores y dueños de agencia en Instagram. Califican con más de 20 DMs al día, una oferta de más de $1.000, una tasa de cierre superior al 20 % y más de $30.000 cobrados al mes.</p></article>
<article class="card"><h3>No</h3><p>Quien vende sobre todo por WhatsApp, email o teléfono. Ofertas de ticket bajo. Muy pocos DMs. Roleflow trabaja solo DMs de Instagram.</p></article>
</div>
<p>El cuestionario de calificación y la cuenta están en inglés: <a href="/#quiz">haz el cuestionario</a> o <a href="/signup/">crea tu cuenta</a>.</p>
'''

DEF_EN = '''
<h2>What it does</h2>
<p>An AI DM setter replies, qualifies, follows up, and books. The lead messages you. The setter answers, asks the questions that decide fit, nudges people who go quiet, and puts a qualified call on the calendar. Your closers take that call.</p>
<h2>How it differs from a chatbot or a ManyChat flow</h2>
<p>A button flow sends people down a path you drew. An AI DM setter holds a conversation about your offer. ManyChat, on its own pricing page, describes automation for comments and messages across several channels. Roleflow is not that product. Roleflow is a done-for-you setter for Instagram DMs only. See <a href="/vs/manychat/">Roleflow vs ManyChat</a>.</p>
<h2>How it differs from a human setter</h2>
<p>A person can hear nuance and can work the phone. They also work a shift, and someone has to hire and manage them. Roleflow replies in seconds, including when you are asleep, and does not forget the follow-up. It does not replace your closer. <a href="/vs/human-setter/">Roleflow vs a human setter</a>.</p>
<h2>Done for you, not self-serve</h2>
<p>Self-serve tools hand you a login and a monthly plan. Roleflow builds the setter and runs it. You record a short sample so voice notes use your cloned voice. [CONFIRM: review/approval process.]</p>
<h2>Instagram rules</h2>
<p>[CONFIRM: official Meta API or not; messaging-window compliance.]</p>
<h2>Who should use one</h2>
<p>High-ticket coaches, consultants, course creators, and agency owners with 20+ Instagram DMs a day, an offer above $1,000, a close rate above 20%, and $30k+ a month collected. Not a fit: WhatsApp, email, or phone-first sellers, low-ticket offers, or very low DM volume.</p>
<p>Roleflow is the only done-for-you AI DM setter for Instagram that sends voice notes in the owner's cloned voice, with $0 setup, $0 retainer, and 5–7% of the revenue it generates.</p>
''' + links_en()

DEF_ES = '''
<h2>Qué hace</h2>
<p>Un setter con IA responde, califica, hace seguimiento y agenda. El lead te escribe. El setter contesta, hace las preguntas de encaje, retoma a quien se enfría y deja la llamada calificada en el calendario. Tus closers hacen esa llamada.</p>
<h2>En qué se diferencia de un chatbot o de un flujo de ManyChat</h2>
<p>Un flujo de botones empuja a la gente por un camino que dibujaste. Un setter con IA conversa sobre tu oferta. ManyChat, en su página de precios, se describe como automatización de comentarios y mensajes en varios canales. Roleflow no es ese producto. Es un setter hecho para ti, solo para DMs de Instagram. Mira <a href="/es/vs/manychat/">Roleflow vs ManyChat</a>.</p>
<h2>En qué se diferencia de un setter humano</h2>
<p>Una persona lee matices y puede atender el teléfono. También trabaja un turno, y alguien tiene que contratarla y supervisarla. Roleflow responde en segundos, también cuando duermes, y no olvida el seguimiento. No reemplaza a tu closer. <a href="/es/vs/setter-humano/">Roleflow vs un setter humano</a>.</p>
<h2>Hecho para ti, no autoservicio</h2>
<p>El autoservicio te da un login y un plan mensual. Roleflow arma el setter y lo opera. Grabas una muestra corta para que las notas de voz usen tu voz clonada. [CONFIRMAR proceso de revisión/aprobación.]</p>
<h2>Reglas de Instagram</h2>
<p>[CONFIRMAR API oficial de Meta.]</p>
<h2>Quién debería usar uno</h2>
<p>Coaches, consultores, infoproductores y dueños de agencia de ticket alto, con más de 20 DMs al día, una oferta de más de $1.000, un cierre superior al 20 % y más de $30.000 cobrados al mes. No encaja quien vende por WhatsApp, email o teléfono, ni el ticket bajo, ni un volumen muy bajo de DMs.</p>
<p>Roleflow es el único setter con IA para Instagram, hecho para ti, que envía notas de voz con la voz clonada del dueño, con $0 de setup, $0 de cuota y entre el 5 % y el 7 % de los ingresos que genera.</p>
''' + links_es()

PRICE_EN = '''
<h2>The model</h2>
<p>There is no setup invoice and no monthly retainer. Roleflow is paid 5–7% of the revenue the system generates. The exact rate is set on the demo call. [CONFIRM whether 5–7% is the final published range.] If the system generates nothing, you owe nothing for that work.</p>
<h2>How attribution works</h2>
<p>[CONFIRM: attribution method, e.g. booked calls sourced from Roleflow conversations that close.]</p>
<p>Illustrative formula, not a client result and not a promise: attributed revenue in a month × the rate from the demo call = the Roleflow share. If the attributed amount were $10,000 and the rate were 6%, the share would be $600. Your rate can sit anywhere from 5% to 7%. This is arithmetic, not a case study.</p>
<h2>Who qualifies</h2>
<p>20+ DMs a day, an offer above $1,000, a close rate above 20%, and $30k+ a month in cash collected. We fund the setup, so the offer has to be able to produce revenue from Instagram DMs.</p>
<h2>Percent of revenue, or a flat fee</h2>
<p>A flat monthly tool bill is predictable and you pay it even in a quiet month. A percent of revenue stays at $0 until the system generates revenue, and it moves with that revenue. The percent model fits a high-ticket Instagram offer with enough inbound. A flat fee can fit a team that wants software it operates itself. We do not publish a human setter's salary. The comparison with a person is about speed, coverage, follow-up, and management, on <a href="/vs/human-setter/">Roleflow vs a human setter</a>.</p>
<h2>What you still do</h2>
<p>You take the sales calls. Roleflow handles first response, follow-ups, and booking. Setup time: [CONFIRM].</p>
''' + links_en()

PRICE_ES = '''
<h2>El modelo</h2>
<p>No hay factura de setup ni cuota mensual. Roleflow cobra entre el 5 % y el 7 % de los ingresos que genera el sistema. El porcentaje exacto se define en la demo. [CONFIRM whether 5–7% is the final published range.] Si el sistema no genera, no debes nada por ese trabajo.</p>
<h2>Cómo se atribuye</h2>
<p>[CONFIRMAR método de atribución.]</p>
<p>Fórmula ilustrativa, no un resultado de un cliente y no una promesa: ingresos atribuidos en un mes × el porcentaje de la demo = la parte de Roleflow. Si el monto atribuido fuera $10.000 y el porcentaje fuera 6 %, la parte sería $600. Tu porcentaje puede estar entre el 5 % y el 7 %. Es aritmética, no un caso.</p>
<h2>Quién califica</h2>
<p>Más de 20 DMs al día, una oferta de más de $1.000, un cierre superior al 20 % y más de $30.000 cobrados al mes. Nosotros financiamos el setup, así que la oferta tiene que poder generar ingresos desde los DMs de Instagram.</p>
<h2>Porcentaje de ingresos, o cuota fija</h2>
<p>Una cuota mensual de software es predecible y se paga también en un mes flojo. Un porcentaje se queda en $0 hasta que el sistema genera, y se mueve con esos ingresos. Encaja con una oferta de ticket alto y suficiente inbound en Instagram. Una cuota fija puede encajar con un equipo que quiere operar el software solo. No publicamos el sueldo de un setter humano. La comparación con una persona va de velocidad, cobertura, seguimiento y gestión, en <a href="/es/vs/setter-humano/">Roleflow vs un setter humano</a>.</p>
<h2>Qué sigues haciendo tú</h2>
<p>Tú haces las llamadas de venta. Roleflow hace la primera respuesta, los seguimientos y la agenda. Puesta en marcha: [CONFIRMAR].</p>
''' + links_es()

BEST_EN = '''
<p class="note">Roleflow wrote this article. We sell a done-for-you AI DM setter, so read the wrong-for line on Roleflow the same way you read it on every other tool.</p>
<h2>What is an AI DM setter</h2>
<p>Software that answers inbound DMs, qualifies leads, follows up, and books calls: the job of a human appointment setter. <a href="/what-is-an-ai-dm-setter/">Full definition</a>.</p>
<h2>How we compared</h2>
<p>We looked at pricing model, done-for-you versus self-serve, channels, voice, booking, human handoff, and whether a vendor states an official Instagram API. A cell is filled only when we could read it on that company's site on ''' + CHECKED + '''. Otherwise it says [CONFIRM]. We did not add reviews, ratings, or customer results.</p>
<h2>Comparison table</h2>
''' + table(
    ["Tool", "Type", "Published price", "Channels", "Best for", "Wrong for"],
    [
        ["Roleflow", "Done for you", "$0 setup, $0 retainer, 5–7% of revenue generated", "Instagram DMs only", "High-ticket Instagram sellers with 20+ DMs/day who want it built and run", "WhatsApp, email, or phone-first sellers, low-ticket offers, or low DM volume"],
        ["SetSmart", "Self-serve AI setter", "$99/month Pro on the pricing page; llms.txt says $97/month. [CONFIRM current checkout price.]", "Instagram, WhatsApp, Messenger (llms.txt)", "Teams who will run a multi-channel setter on a monthly plan", "Buyers who want $0 retainer and a percent of revenue only"],
        ["ManyChat / ManySetter", "Self-serve flow builder", "Annual prices from $0 to $139/month on manychat.com/pricing. ManySetter: [CONFIRM]", "Instagram, Messenger, TikTok, Telegram, WhatsApp, SMS, email (ManyChat pricing page). ManySetter: [CONFIRM]", "People who want to build automations themselves", "People who want a done-for-you setter and will not build flows. ManySetter wrong-for: [CONFIRM]"],
        ["SetterFlo", "Pilot described as done for you; Starter described as DIY", "Pilot $997 onboarding then $297/month; Starter $297/month. [CONFIRM checkout price.]", "Instagram (plan cards name IG accounts)", "Instagram operators comparing a monthly plan with a percent-of-revenue fee", "Buyers who need a confirmed cloned-voice note feature. Voice notes: [CONFIRM]"],
        ["Setterr", "Self-serve, flat monthly", "$250/month up to 500 conversations, or $400/month up to 1,000", "Instagram, from the product's own positioning on its pricing page", "Owners who want a flat Instagram plan and no commission", "Owners who want Roleflow to build and run it and to pay only a percent of revenue. Cloned-voice notes: [CONFIRM]"],
        ["Intellicoach", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]"],
        ["Appointwise", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]"],
        ["Instaset", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]"],
        ["LeadsNow", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]"],
        ["Human setter", "A person on your team", "No salary published here", "Whatever you hire them to cover, including phone", "Nuance, phone calls, and judgment on odd deals", "Teams that need a first reply in seconds, all day, without managing a setter's shift"],
    ],
) + '''
<h2>Roleflow</h2>
<p>Done for you. Instagram DMs only. Voice notes in your cloned voice. Follow-ups and booked calls. $0 setup, $0 retainer, 5–7% of revenue generated, rate set on the demo call. Wrong for: WhatsApp, email, or phone-first sellers, low-ticket offers, or low DM volume. <a href="/pricing/">Pricing</a>.</p>
<h2>SetSmart</h2>
<p>SetSmart's pricing page lists a Pro plan at $99/month for 1,000 AI messages, usage pricing above that, and no setup fee. Its llms.txt lists Pro at $97/month and names Instagram, WhatsApp, and Messenger, and says it books appointments. [CONFIRM current checkout price.] Cloned-voice Instagram voice notes: [CONFIRM]. Wrong for: buyers who only want a percent-of-revenue price and no monthly plan. <a href="/vs/setsmart/">Roleflow vs SetSmart</a>.</p>
<h2>ManyChat and ManySetter</h2>
<p>ManyChat's pricing page shows a free plan and annual prices of $14, $29, $69, and $139 per month, and names several channels. It is a flow builder you operate, not a done-for-you setter. ManySetter's features: [CONFIRM]. Wrong for: someone who will not build automations and wants the setter run for them. <a href="/vs/manychat/">Roleflow vs ManyChat</a>.</p>
<h2>SetterFlo</h2>
<p>SetterFlo's homepage plan cards list a Pilot Partner at $997 onboarding then $297/month, described as done for you, and a Starter at $297/month, described as DIY, on Instagram. [CONFIRM checkout price.] Cloned-voice voice notes: [CONFIRM]. Wrong for: buyers who need that voice-note fact confirmed before they switch. <a href="/vs/setterflo/">Roleflow vs SetterFlo</a>.</p>
<h2>Setterr</h2>
<p>Setterr's pricing page lists $250/month for 500 conversations and $400/month for 1,000, with no commission, replies trained on your DMs, booking, and follow-ups. Cloned-voice voice notes: [CONFIRM]. Wrong for: owners who want the system built and run, paid only as a percent of revenue. <a href="/vs/setterr/">Roleflow vs Setterr</a>.</p>
''' + UNVERIFIED_EN + '''
<h2>A human setter</h2>
<p>A person is the baseline. They can take phone calls and read odd situations. They work a shift, and you manage them. We do not publish salary figures. Wrong for: a team that needs every Instagram DM answered in seconds, all day, without a setter to supervise. <a href="/vs/human-setter/">Roleflow vs a human setter</a>.</p>
<h2>Pricing models</h2>
<p>Per message and per conversation bills grow when a post works. A flat retainer is owed in a quiet month too. A percent of revenue stays at zero until revenue shows up, and it only fits when the offer can pay for the work. Roleflow uses the percent model on Instagram. The other published prices above are monthly software plans.</p>
<h2>How to choose</h2>
<p>If you have 20+ Instagram DMs a day, an offer above $1,000, a close rate above 20%, and $30k+ collected, and you want the setter built and run with voice notes in your cloned voice, start with Roleflow. If you want to operate the software and pay a monthly plan across more channels, read the self-serve rows and confirm the [CONFIRM] cells on the vendor's site. If the sale happens on the phone and the DM is only a prelude a person must judge, keep a human setter in the process. Your closers still take Roleflow's booked calls.</p>
<p class="note">Methodology: public pages only, checked ''' + CHECKED + '''. No paid placement. Re-check prices before you buy. This is not a ranking and not a review score.</p>
''' + links_en()

BEST_ES = '''
<p class="note">Roleflow escribió este artículo. Vendemos un setter con IA hecho para ti, así que lee la línea de "no recomendable" de Roleflow igual que la de las demás herramientas.</p>
<h2>Qué es un setter con IA</h2>
<p>Un software que responde DMs, califica, hace seguimiento y agenda llamadas: el trabajo de un setter humano. No es un chatbot de botones ni un flujo de ManyChat. <a href="/es/que-es-un-setter-con-ia/">Definición completa</a>.</p>
<h2>Cómo comparamos</h2>
<p>Miramos el modelo de precio, hecho para ti frente a autoservicio, canales, voz, agenda, traspaso a una persona y si el proveedor dice usar la API oficial. Una celda se llena solo si la leímos en el sitio de esa empresa el ''' + CHECKED_ES + '''. Si no, dice [CONFIRM]. No agregamos reseñas, puntuaciones ni resultados de clientes.</p>
<h2>Tabla comparativa</h2>
''' + table(
    ["Herramienta", "Tipo", "Precio publicado", "Canales", "Ideal para", "No recomendable si"],
    [
        ["Roleflow", "Hecho para ti", "$0 de setup, $0 de cuota, del 5 % al 7 % de los ingresos", "Solo DMs de Instagram", "Quien vende ticket alto en Instagram, con más de 20 DMs al día, y quiere que se lo operen", "Vendes por WhatsApp, email o teléfono, tienes ticket bajo o muy pocos DMs"],
        ["SetSmart", "Setter de IA en autoservicio", "$99/mes en su página de precios; su llms.txt dice $97/mes. [CONFIRM precio de checkout.]", "Instagram, WhatsApp y Messenger (llms.txt)", "Quien va a operar un setter multicanal con plan mensual", "Quieres $0 de cuota y solo un porcentaje de ingresos"],
        ["ManyChat / ManySetter", "Constructor de flujos", "Precios anuales de $0 a $139/mes en manychat.com/pricing. ManySetter: [CONFIRM]", "Instagram, Messenger, TikTok, Telegram, WhatsApp, SMS y email (página de ManyChat). ManySetter: [CONFIRM]", "Quien quiere armar automatizaciones", "No quieres construir flujos y buscas un setter operado por otro. ManySetter: [CONFIRM]"],
        ["Setterr", "Autoservicio, cuota fija", "$250/mes hasta 500 conversaciones, o $400/mes hasta 1.000", "Instagram, según su página de precios", "Quien quiere un plan fijo de Instagram y cero comisión", "Quieres que Roleflow lo monte y lo opere, y pagar solo un porcentaje. Notas de voz clonadas: [CONFIRM]"],
        ["Instaset", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]"],
        ["SetterFlo", "Piloto descrito como hecho para ti; Starter descrito como DIY", "Piloto $997 de onboarding y luego $297/mes; Starter $297/mes. [CONFIRM precio de checkout.]", "Instagram (las tarjetas nombran cuentas de IG)", "Quien compara una cuota mensual con un fee sobre ingresos", "Necesitas confirmada la nota de voz clonada. Notas de voz: [CONFIRM]"],
        ["Intellicoach", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]"],
        ["WhatSetter", "[CONFIRM]", "[CONFIRM]", "[CONFIRM]", "Pensado en el esquema para quien vende por WhatsApp. Encaje real: [CONFIRM]", "[CONFIRM]"],
        ["Setter humano", "Una persona en tu equipo", "Aquí no publicamos sueldos", "Lo que le contrates, incluido el teléfono", "Matices, llamadas y criterio en casos raros", "Necesitas la primera respuesta en segundos, todo el día, sin supervisar un turno"],
    ],
) + '''
<h2>Roleflow</h2>
<p>Hecho para ti. Solo DMs de Instagram. Notas de voz con tu voz clonada. Seguimientos y llamadas agendadas. $0 de setup, $0 de cuota, del 5 % al 7 % de los ingresos, porcentaje en la demo. No recomendable si vendes por WhatsApp, email o teléfono, si el ticket es bajo o si hay muy pocos DMs. <a href="/es/precios/">Precios</a>.</p>
<h2>SetSmart</h2>
<p>Su página de precios lista un plan Pro a $99/mes por 1.000 mensajes de IA. Su llms.txt lista Pro a $97/mes y nombra Instagram, WhatsApp y Messenger, y dice que agenda citas. [CONFIRM precio de checkout.] Notas de voz clonadas en Instagram: [CONFIRM]. No recomendable si solo quieres un porcentaje de ingresos y ningún plan mensual. <a href="/es/vs/setsmart/">Roleflow vs SetSmart</a>.</p>
<h2>ManyChat y ManySetter</h2>
<p>La página de precios de ManyChat muestra un plan gratis y precios anuales de $14, $29, $69 y $139 al mes, y nombra varios canales. Es un constructor de flujos que operas tú. ManySetter: [CONFIRM]. No recomendable si no vas a armar automatizaciones. <a href="/es/vs/manychat/">Roleflow vs ManyChat</a>.</p>
<h2>Setterr</h2>
<p>Su página de precios lista $250/mes por 500 conversaciones y $400/mes por 1.000, sin comisión, con respuestas entrenadas en tus DMs, agenda y seguimientos. Notas de voz clonadas: [CONFIRM]. No recomendable si quieres que lo monten y lo operen, pagando solo un porcentaje. <a href="/es/vs/setterr/">Roleflow vs Setterr</a>.</p>
<h2>SetterFlo</h2>
<p>Las tarjetas de su home listan un Pilot Partner a $997 de onboarding y luego $297/mes, descrito como hecho para ti, y un Starter a $297/mes, descrito como DIY, en Instagram. [CONFIRM precio de checkout.] Notas de voz clonadas: [CONFIRM]. <a href="/es/vs/setterflo/">Roleflow vs SetterFlo</a>.</p>
''' + UNVERIFIED_ES + '''
<h2>Setter humano</h2>
<p>Una persona es la base. Puede atender el teléfono y leer situaciones raras. Trabaja un turno y tú la gestionas. No publicamos sueldos. No recomendable si cada DM de Instagram tiene que responderse en segundos, todo el día, sin un setter al que supervisar. <a href="/es/vs/setter-humano/">Roleflow vs un setter humano</a>.</p>
<h2>Modelos de precio</h2>
<p>Cobrar por mensaje o por conversación sube cuando una publicación funciona. Una cuota fija se debe también en un mes flojo. Un porcentaje de ingresos se queda en cero hasta que hay ingresos, y solo encaja si la oferta puede pagarlo. Roleflow usa ese porcentaje en Instagram. Los otros precios publicados de arriba son planes mensuales de software.</p>
<h2>Cómo elegir</h2>
<p>Si tienes más de 20 DMs de Instagram al día, una oferta de más de $1.000, un cierre superior al 20 % y más de $30.000 cobrados, y quieres el setter montado y operado con notas de voz en tu voz clonada, empieza por Roleflow. Si quieres operar el software y pagar un plan mensual en más canales, lee las filas de autoservicio y confirma las celdas [CONFIRM] en el sitio del proveedor. Si la venta ocurre por teléfono y el DM solo es la antesala, mantén a una persona en el proceso. Tus closers igual hacen las llamadas que Roleflow agenda.</p>
<p class="note">Metodología: solo páginas públicas, revisadas el ''' + CHECKED_ES + '''. Sin pago por aparecer. Vuelve a mirar los precios antes de comprar. Esto no es un ranking ni una puntuación.</p>
''' + links_es()

from pages_tail import PAGES
