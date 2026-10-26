# -*- coding: utf-8 -*-
import pages_data as D
from geo_pages import (
    FAQ_EN, FAQ_ES, table, src, src_es, links_en, links_es,
    ROLE_ROW, ROLE_ROW_ES, VS_HEADERS, VS_HEADERS_ES, RD_SOURCES, MO_SOURCES, CHECKED, CHECKED_ES,
)

def vs_table(other, es=False):
    if es:
        return table(VS_HEADERS_ES, [ROLE_ROW_ES, other])
    return table(VS_HEADERS, [ROLE_ROW, other])

def choose(en, a, b):
    if en:
        return f"<h2>Choose them if</h2><p>{a}</p><h2>Choose Roleflow if</h2><p>{b}</p>"
    return f"<h2>Elige esa opción si</h2><p>{a}</p><h2>Elige Roleflow si</h2><p>{b}</p>"

RD_EN = vs_table(["RipDrip", "Team builds a custom AI sales clone", "No price on dm.ripdrip.ai.", "Instagram DM funnel, in the page meta description. Other channels are not named on that page.", "The page says the clone is trained on your voice, offer, process, and personality.", "The product steps name qualifying, objections, and CTAs. A separate automatic follow-up feature is not named on that page.", "The page says it books calls", "Usually live in 72 hours. Their team builds it after an application and, if you qualify, a demo call."]) + choose(True,
    "You want the clone RipDrip describes, built by their team, and you have confirmed the price.",
    "You want voice notes in your own voice, cloned from a short recording, and you want Roleflow to build and run the DM system.") + src(RD_SOURCES) + links_en() + '<p><a href="/vs/mochi/">Mochi</a></p>'

RD_ES = vs_table(["RipDrip", "Su equipo arma un clon de ventas con IA", "Sin precio en dm.ripdrip.ai.", "Embudo de DMs de Instagram, en la meta descripción. Otros canales no figuran en esa página.", "La página dice que el clon se entrena con tu voz, tu oferta, tu proceso y tu personalidad.", "Los pasos nombran calificación, objeciones y CTAs. Un seguimiento automático aparte no figura en esa página.", "La página dice que agenda llamadas", "En general, en vivo en 72 horas. Su equipo lo arma después de una solicitud y, si calificas, una demo."], es=True) + choose(False,
    "Quieres el clon que RipDrip describe, armado por su equipo, y ya confirmaste el precio.",
    "Quieres notas de voz personales en Instagram, y que Roleflow monte y opere el sistema de DMs.") + src_es(RD_SOURCES) + links_es() + '<p><a href="/es/vs/mochi/">Mochi</a></p>'

MO_EN = vs_table(["Mochi", "Software for an Instagram sales team. The Pro card also lists AI Setter.", "Homepage monthly cards: Starter $149, Essential $297, Pro $497. 7-day trial. Checkout price is not on that page.", "Instagram, connected through Meta's official API on that page. Other channels are not named on that page.", "Essential and Pro cards list AI Voice Clone. The page says setters type the message and Mochi makes the voice note. Starter card does not list it.", "The ManyChat comparison on that page names AI-powered follow-up. The page does not state the scope.", "The page says it turns DMs into booked calls. The page does not state automatic calendar booking.", "Homepage: setup in under 5 minutes. Signup page: about two minutes. You invite your team."]) + choose(True,
    "You want software your setters use, on a published monthly plan, with the voice-note behavior confirmed for your plan.",
    "You want Roleflow to build and run the Instagram DM system, with voice notes in your own voice, cloned from a short recording.") + src(MO_SOURCES) + links_en() + '<p><a href="/vs/ripdrip/">RipDrip</a></p>'

MO_ES = vs_table(["Mochi", "Software para un equipo de ventas en Instagram. La tarjeta Pro también lista AI Setter.", "Tarjetas mensuales del home: Starter $149, Essential $297, Pro $497. Prueba de 7 días. El precio de checkout no figura en esa página.", "Instagram, con la API oficial de Meta según esa página. Otros canales no figuran en esa página.", "Essential y Pro listan AI Voice Clone. La página dice que el setter escribe y Mochi hace la nota de voz. Starter no lo lista.", "La comparación con ManyChat en esa página nombra seguimiento con IA. La página no dice el alcance.", "La página dice que convierte DMs en llamadas agendadas. La página no dice si la agenda es automática.", "Home: setup en menos de 5 minutos. La página de alta: unos dos minutos. Invitas a tu equipo."], es=True) + choose(False,
    "Quieres un software que usen tus setters, con un plan mensual publicado, y ya confirmaste las notas de voz de tu plan.",
    "Quieres que Roleflow monte y opere el sistema de DMs de Instagram, con notas de voz en tu propia voz, clonadas de una grabación corta.") + src_es(MO_SOURCES) + links_es() + '<p><a href="/es/vs/ripdrip/">RipDrip</a></p>'

ABOUT_EN = '''
<p>Roleflow is a Client Acquisition System. We build and run your Instagram DM system, with voice notes in your own voice, cloned from a short recording.</p>
<h2>Mission</h2>
<p>High-ticket Instagram businesses lose leads because replies are slow, follow-ups get forgotten, and the owner spends the day managing setters. Roleflow builds and runs the DM system so closers can sell on the calls.</p>
<h2>Company</h2>
<p>Contact: <a href="mailto:diego@roleflow.io">diego@roleflow.io</a>.</p>
<h2>Profiles</h2>
<ul>
<li><a href="https://www.instagram.com/roleflow.io">Instagram</a></li>
<li><a href="https://www.tiktok.com/@roleflow.io">TikTok</a></li>
<li><a href="https://www.youtube.com/@roleflow">YouTube</a></li>
</ul>
<h2>Pages not built yet</h2>
<p>Mindset coaches, dating coaches, med spa, aesthetics, and real estate are future pages only. They are not on this site yet.</p>
''' + links_en()

ABOUT_ES = '''
<p>Roleflow es un sistema de adquisición de clientes para Instagram. Nosotros lo montamos y lo operamos.</p>
<h2>Misión</h2>
<p>Los negocios de ticket alto en Instagram pierden leads porque la respuesta tarda, el seguimiento se olvida y el dueño pasa el día gestionando setters. Roleflow monta y opera el sistema de DMs para que los closers vendan en las llamadas.</p>
<h2>Empresa</h2>
<p>Contacto: <a href="mailto:diego@roleflow.io">diego@roleflow.io</a>.</p>
<h2>Perfiles</h2>
<ul>
<li><a href="https://www.instagram.com/roleflow.io">Instagram</a></li>
<li><a href="https://www.tiktok.com/@roleflow.io">TikTok</a></li>
<li><a href="https://www.youtube.com/@roleflow">YouTube</a></li>
</ul>
<h2>Páginas que todavía no existen</h2>
<p>Coaches de mentalidad, coaches de citas, med spa, estética y bienes raíces quedan como páginas futuras. Aún no están en este sitio.</p>
''' + links_es()

# Niche essays. Each one is specific. min_words is enforced by the builder.
COACH_EN = '''
<h2>The inbox after you post</h2>
<p>A coach posts a client story and the DMs arrive while you are on a call. Someone asks if you still take one-to-one clients. Someone else asks for the price. A third person says they will "circle back." By the time you answer, the first two are already talking to another coach. That delay is the whole problem Roleflow is built for. It is not a content tool and it does not post for you. It answers the Instagram conversation that the content started.</p>
<p>The pains are the ones coaches already name. Leads wait hours. The reply that finally goes out is a generic text. The follow-up never happens because the thread fell under newer messages. And if you hired a setter, you now manage that person instead of coaching. Roleflow takes the first response, the follow-up, and the booking. You keep the sessions and the sales calls.</p>
<h2>How it works for a coaching offer</h2>
<p>You send a short recording. Voice notes go out in your own voice, cloned from that recording, and Roleflow writes replies that follow your offer and your tone. A lead who asks about a high-ticket program gets a conversation, not a link dump: what they want, whether they can invest, and whether a call makes sense. If they qualify, the call lands on your calendar. If they go quiet, the follow-up still goes out within 24 hours. Voice notes in your own voice, cloned from a short recording go out so the thread sounds like you. Follow-ups go out only within 24 hours.</p>
<p>This is done for you. You do not build a button flow and you do not staff a night shift. Roleflow is a Client Acquisition System. We build and run your Instagram DM system, with voice notes in your own voice, cloned from a short recording.</p>
<h2>Who qualifies</h2>
<p>Coaches with 20+ DMs a day, an offer above $1,000, a close rate above 20%, and $30k+ a month collected. A $200 group challenge, a WhatsApp community, or a coach who gets three DMs a week is outside the fit. Instagram DMs only. We build and run the Instagram DM system. The work stays on Instagram DMs.</p>
<p>Your setters, if you still have them, stop living in the first-response queue. Closers take the calls Roleflow books. Your closers still take every call that lands on the calendar. Read <a href="/for/business-coaches/">business coaches</a>, <a href="/for/fitness-coaches/">fitness coaches</a>, and the <a href="/best-ai-dm-setters/">comparison</a>.</p>
'''
COACH_ES = '''
<h2>El inbox después de publicar</h2>
<p>Un coach publica la historia de un cliente y los DMs llegan mientras está en una llamada. Alguien pregunta si todavía tomas clientes uno a uno. Otro pide el precio. Un tercero dice que "lo piensa." Cuando contestas, los dos primeros ya hablan con otro coach. Esa espera es el problema para el que existe Roleflow. No es una herramienta de contenido y no publica por ti. Responde la conversación de Instagram que el contenido abrió.</p>
<p>Los dolores son los que los coaches ya dicen. El lead espera horas. La respuesta que sale es un texto genérico. El seguimiento no ocurre porque el hilo quedó debajo de mensajes nuevos. Y si contrataste un setter, ahora gestionas a esa persona en lugar de hacer coaching. Roleflow toma la primera respuesta, el seguimiento y la agenda. Tú te quedas con las sesiones y las llamadas de venta.</p>
<h2>Cómo funciona con una oferta de coaching</h2>
<p>Mandas una grabación corta. Roleflow envía tu nota personal y escribe respuestas que siguen tu oferta y tu tono. Quien pregunta por un programa de ticket alto recibe una conversación, no un montón de links: qué busca, si puede invertir y si una llamada tiene sentido. Si califica, la llamada queda en tu calendario. Si se enfría, el seguimiento igual sale. Las notas de voz salen con tu nota personal para que el hilo suene a ti. El seguimiento sale solo dentro de 24 horas.</p>
<p>Es hecho para ti. No armas un flujo de botones ni cubres un turno de noche. Roleflow es un sistema de adquisición de clientes para Instagram. Nosotros lo montamos y lo operamos hoy.</p>
<h2>Quién califica</h2>
<p>Coaches con más de 20 DMs al día, una oferta de más de $1.000, un cierre superior al 20 % y más de $30.000 cobrados al mes. Un reto de $200, una comunidad de WhatsApp o un coach con tres DMs a la semana queda afuera. Solo DMs de Instagram. Nosotros montamos y operamos el sistema. El trabajo se queda en los DMs de Instagram.</p>
<p>Tus setters, si todavía los tienes, salen de la cola de primera respuesta. Los closers hacen las llamadas que Roleflow agenda. Tus closers igual hacen cada llamada que queda en el calendario. Lee <a href="/es/para/coaches-de-negocios/">coaches de negocios</a>, <a href="/es/para/coaches-fitness/">coaches fitness</a> y la <a href="/es/mejores-setters-con-ia/">comparativa</a>.</p>
'''
BIZ_EN = '''
<h2>Application calls, not content likes</h2>
<p>A business coach sells a program that starts above $1,000. The Instagram DM is the application before the application. People ask about revenue, about whether you work with their niche, and about the time commitment. Those questions decide the call. If they sit unanswered until the evening, the buyer with money has already booked someone who replied at lunch.</p>
<p>The specific mess is the setter layer. Many business coaches already pay someone to "handle DMs." That person works a shift, writes in a voice that is almost yours, and still misses Friday night. You review their threads instead of selling. Roleflow replaces that first-response job. It does not replace the closer who runs the sales call, and it does not coach your clients.</p>
<h2>What the conversation has to do</h2>
<p>The reply has to sound like the person whose face is on the profile. Roleflow sends voice notes in your own voice, cloned from a short recording, and written replies that follow your offer. It asks the qualifying questions you already use: offer fit, ability to invest, and whether a call is the next step. Quiet threads get a follow-up within 24 hours. Qualified threads get a calendar booking. Follow-ups go out only within 24 hours.</p>
<p>Roleflow builds and runs the Instagram DM system. That is a different arrangement from hiring a setter and paying for a software subscription. We do not publish salary numbers. The point is the model: done for you, Instagram only.</p>
<h2>Fit</h2>
<p>20+ DMs a day, offer above $1,000, close rate above 20%, $30k+ a month collected. A business coach who sells a $300 workshop, or who closes on WhatsApp, is not the account we set up. Qualified leads are booked on your calendar. We build and run the Instagram DM system.</p>
<p>A normal week for this buyer is a mix of podcast clips, a live, and a DM from someone who already bought a cheaper product and now wants the real program. Roleflow does not upsell inside someone else's community and it does not email the list. It stays in Instagram DMs, asks whether the high-ticket program is the right next step, and books the call only when the answers match. That keeps the closer's calendar for people who can actually buy. Your closers still take every call that lands on the calendar.</p>
<p>See <a href="/for/coaches/">coaches</a>, <a href="/for/consultants/">consultants</a>, <a href="/for/agency-owners/">agency owners</a>, and <a href="/vs/ripdrip/">RipDrip</a>.</p>
'''
BIZ_ES = '''
<h2>Llamadas de aplicación, no likes</h2>
<p>Un coach de negocios vende un programa que empieza arriba de $1.000. El DM de Instagram es la aplicación antes de la aplicación. La gente pregunta por facturación, por si trabajas su nicho y por el tiempo que exige. Esas preguntas deciden la llamada. Si quedan sin respuesta hasta la noche, el comprador con presupuesto ya agendó con quien contestó al mediodía.</p>
<p>El lío concreto es la capa de setters. Muchos coaches de negocios ya le pagan a alguien para "llevar los DMs." Esa persona trabaja un turno, escribe en una voz que casi es la tuya y igual se pierde el viernes a la noche. Tú revisas sus hilos en lugar de vender. Roleflow reemplaza ese trabajo de primera respuesta. No reemplaza al closer de la llamada de venta y no hace coaching a tus clientes.</p>
<h2>Qué tiene que hacer la conversación</h2>
<p>La respuesta tiene que sonar a la persona cuyo rostro está en el perfil. Roleflow manda notas de voz personales que grabas y textos que siguen tu oferta. Hace las preguntas que ya usas: encaje de la oferta, capacidad de invertir y si la llamada es el siguiente paso. Los hilos fríos reciben seguimiento. Los que califican quedan en el calendario. El seguimiento sale solo dentro de 24 horas.</p>
<p>Roleflow monta y opera el sistema de DMs de Instagram. Es un arreglo distinto de contratar un setter y pagar una suscripción de software. No publicamos sueldos. El punto es el modelo: hecho para ti, solo Instagram.</p>
<h2>Encaje</h2>
<p>Más de 20 DMs al día, oferta de más de $1.000, cierre superior al 20 % y más de $30.000 cobrados al mes. Un coach de negocios que vende un taller de $300, o que cierra por WhatsApp, no es la cuenta que montamos. Los leads calificados quedan en el calendario. Nosotros montamos y operamos el sistema.</p>
<p>Una semana normal de este comprador mezcla clips, un live y un DM de alguien que ya compró algo más barato y ahora quiere el programa de verdad. Roleflow no hace upsell dentro de la comunidad de otro ni escribe emails. Se queda en los DMs de Instagram, pregunta si el programa de ticket alto es el paso correcto y agenda solo cuando las respuestas encajan. Así el calendario del closer queda para quien sí puede comprar.</p>
<p>Mira <a href="/es/para/coaches/">coaches</a>, <a href="/es/para/consultores/">consultores</a>, <a href="/es/para/agencias/">agencias</a> y <a href="/es/vs/ripdrip/">RipDrip</a>.</p>
'''
FIT_EN = '''
<h2>Reels fill the inbox. The program still has a price.</h2>
<p>A fitness coach posts a training clip and the DMs ask three things: do you have spots, is this for beginners or for people who already train, and what does it cost. The offer Roleflow is for is the high-ticket one, above $1,000, not a $29 challenge. The lead who can pay is easy to lose because they messaged ten coaches from the same explore page.</p>
<p>Speed matters here more than a clever script. They are on their phone between sessions. A reply in seconds, including a voice note in your own voice, cloned from a short recording, is the difference between a conversation and a seen-zone. Follow-up matters because fitness leads say "after this trip" and mean it until nobody writes back. Roleflow sends that follow-up within 24 hours. It books the call when they fit. It does not write your program and it does not promise a body result. We do not publish client transformations.</p>
<h2>Done for you, around a coaching week</h2>
<p>You record your voice once. Roleflow runs the Instagram DMs while you are on the gym floor or in sessions. Qualification is the same bar as the rest of Roleflow: 20+ DMs a day, offer above $1,000, close rate above 20%, $30k+ a month collected. A coach selling only low-ticket app subscriptions does not qualify. WhatsApp check-ins with current clients are a different channel. Roleflow does not run those.</p>
<p>Follow-ups go out only within 24 hours. Qualified leads are booked on your calendar. We build and run the Instagram DM system.</p>
<p>The lead who DMs from a reel is often comparing three coaches before lunch. Roleflow's job is the reply and the booking, not a new training plan. Spots, price, and whether they already train are the questions. People who only want a free PDF stay out of the calendar. People who can buy the high-ticket coaching get a time. That is the whole handoff. Nothing on this page is a client result, a star rating, or a review of any kind. We build the Instagram DM system and we keep it running while you coach. The first reply, the follow-up, and the booking stay with Roleflow. Your closers take the calls that land on the calendar, and the program itself stays yours to deliver.</p>
<p>Roleflow is a Client Acquisition System, with voice notes in your own voice, cloned from a short recording. See <a href="/for/coaches/">coaches</a>.</p>
'''
FIT_ES = '''
<h2>Los reels llenan el inbox. El programa igual tiene precio.</h2>
<p>Un coach de fitness publica un clip de entreno y los DMs preguntan tres cosas: si hay cupo, si es para principiantes o para quien ya entrena, y cuánto cuesta. La oferta para la que sirve Roleflow es la de ticket alto, arriba de $1.000, no un reto de $29. El lead que puede pagar se pierde fácil porque le escribió a diez coaches desde la misma página de explorar.</p>
<p>Aquí la velocidad pesa más que un guion ingenioso. Están en el teléfono entre sesiones. Una respuesta en segundos, con una nota de voz en tu nota personal, es la diferencia entre una conversación y un visto. El seguimiento pesa porque el lead de fitness dice "después de este viaje" y lo dice en serio hasta que nadie le escribe. Roleflow manda ese seguimiento solo dentro de 24 horas. Agenda la llamada cuando encaja. No escribe tu programa y no promete un resultado de cuerpo. No publicamos transformaciones de clientes.</p>
<h2>Hecho para ti, alrededor de la semana de coaching</h2>
<p>Grabas tu voz una vez. Roleflow lleva los DMs de Instagram mientras estás en el piso o en sesión. La calificación es la misma barra del resto de Roleflow: más de 20 DMs al día, oferta de más de $1.000, cierre superior al 20 % y más de $30.000 cobrados al mes. Un coach que solo vende suscripciones baratas de una app no califica. Los check-ins de WhatsApp con clientes actuales son otro canal. Roleflow no los lleva.</p>
<p>El seguimiento sale solo dentro de 24 horas. Los leads calificados quedan en el calendario. Nosotros montamos y operamos el sistema.</p>
<p>Quien escribe desde un reel suele comparar tres coaches antes del almuerzo. El trabajo de Roleflow es la respuesta y la agenda, no un plan de entreno nuevo. Cupos, precio y si ya entrena son las preguntas. Quien solo quiere un PDF gratis no entra al calendario. Quien puede comprar el coaching de ticket alto se lleva un horario. Ese es el traspaso. Nada en esta página es un resultado de un cliente, una puntuación con estrellas ni una reseña. Nosotros montamos el sistema de DMs de Instagram y lo seguimos operando mientras das coaching. La primera respuesta, el seguimiento y la agenda se quedan en Roleflow.</p>
<p>Roleflow es un sistema de adquisición de clientes para Instagram, con notas de voz en tu propia voz. Mira <a href="/es/para/coaches/">coaches</a>.</p>
'''
CON_EN = '''
<h2>The DM is the first meeting</h2>
<p>Consultants do not sell a seat in a cohort. They sell a diagnosis. The Instagram DM is often a founder describing a messy problem in four lines and asking if you can help. The wrong reply is a PDF. The right reply asks what the engagement would have to change, whether the budget matches a project above $1,000, and whether a call is worth both calendars. Roleflow runs that first conversation. You still do the actual consulting.</p>
<p>The pain is familiar and a bit more expensive than a coach's missed DM, because one project can be the month. Leads wait. Follow-ups die. You either answer at midnight or you pay a setter who does not know your practice well enough to avoid a bad-fit call. Roleflow qualifies before the call. It follows up within 24 hours if the thread goes quiet. Voice notes in your own voice, cloned from a short recording, matter here because a consultant's trust is the voice, not a branded chatbot.</p>
<h2>Scope</h2>
<p>Instagram DMs only. If your pipeline is referrals and the phone, this is the wrong product. If your pipeline is inbound DMs from posts and you close above 20% on calls, with 20+ DMs a day and $30k+ a month collected, it is the right one. Follow-ups go out only within 24 hours.</p>
<p>Consultants also get DMs that are not buyers: students, vendors, and people who want a free audit. The setter's job is to tell those apart before a 45-minute call is spent on someone who cannot hire you. Roleflow uses your questions for that filter. It does not invent a case study or a win rate. If a fact is not confirmed, it is left out instead of being dressed up. The same rule keeps salary figures and star ratings off this page. We leave both of them out.</p>
<p>Roleflow is a Client Acquisition System, with voice notes in your own voice, cloned from a short recording. We build it and run it, so the first meeting in the DMs is answered in seconds. Your closers, or you, still take the call once it is booked. That is the handoff. Follow-ups go out only within 24 hours. Qualified leads are booked on your calendar. We build and run the Instagram DM system. Your closers, or you, take the booked call. See <a href="/for/agency-owners/">agency owners</a> and <a href="/faq/">the FAQ</a>.</p>
'''
CON_ES = '''
<h2>El DM es la primera reunión</h2>
<p>Los consultores no venden un cupo en una cohorte. Venden un diagnóstico. El DM de Instagram suele ser un fundador contando un problema en cuatro líneas y preguntando si puedes ayudar. La respuesta mala es un PDF. La respuesta útil pregunta qué tendría que cambiar el proyecto, si el presupuesto llega a algo de más de $1.000 y si una llamada vale los dos calendarios. Roleflow lleva esa primera conversación. El consultoría la sigues haciendo tú.</p>
<p>El dolor es conocido y un poco más caro que un DM perdido de un coach, porque un proyecto puede ser el mes. Los leads esperan. El seguimiento muere. Contestas a medianoche o le pagas a un setter que no conoce tu práctica lo bastante como para evitar una llamada que no encaja. Roleflow califica antes de la llamada. El seguimiento sale solo dentro de 24 horas si el hilo se enfría. Las notas de voz personales que grabas importan porque la confianza de un consultor es la voz, no un chatbot de marca.</p>
<h2>Alcance</h2>
<p>Solo DMs de Instagram. Si tu pipeline son referidos y el teléfono, este producto no es. Si tu pipeline son DMs de lo que publicas y cierras por encima del 20 % en llamadas, con más de 20 DMs al día y más de $30.000 cobrados al mes, sí lo es. El seguimiento sale solo dentro de 24 horas.</p>
<p>Los consultores también reciben DMs que no son compradores: estudiantes, proveedores y gente que quiere una auditoría gratis. El trabajo del setter es separarlos antes de gastar 45 minutos con quien no puede contratarte. Roleflow usa tus preguntas para ese filtro. No inventa un caso ni una tasa de éxito. Si un dato no está confirmado, la página lo marca en lugar de adornarlo. La misma regla deja fuera sueldos y estrellas de reseña. Las dos cosas se quedan afuera.</p>
<p>Roleflow es un sistema de adquisición de clientes para Instagram, con notas de voz en tu propia voz. Lo montamos y lo operamos, así la primera reunión en los DMs recibe respuesta en segundos. Tus closers, o tú, igual hacen la llamada cuando ya está agendada. Ese es el traspaso. Los leads calificados quedan en el calendario. Nosotros montamos y operamos el sistema. Tus closers, o tú, hacen la llamada agendada. Mira <a href="/es/para/agencias/">agencias</a> y <a href="/es/preguntas-frecuentes/">las preguntas</a>.</p>
'''
AG_EN = '''
<h2>Your clients' inboxes are not this product</h2>
<p>Agency owners get pitched tools that promise to run every client's Instagram. That is not Roleflow. Roleflow runs the agency owner's own Instagram DMs: the ones where a founder asks if you can take on their account, what a retainer costs, and whether you have room this month. If you sell a high-ticket service from your personal brand, you have the same leak as a coach. Leads wait. Follow-ups slip because you are in a client delivery. Setters on your team get managed instead of you selling the next account.</p>
<p>The conversation is commercial. Budget, scope, and timing. Roleflow replies in seconds, sends voice notes in your own voice, cloned from a short recording, follows up within 24 hours, and books a qualified call. It does not log into a client's profile. It does not post. It does not replace the operators who deliver the work you sell.</p>
<h2>Qualification, stated plainly</h2>
<p>20+ DMs a day on the Instagram account we would run, an offer above $1,000, a close rate above 20%, and $30k+ a month collected. An agency that sells $500 setup fees, or that lives in email and Upwork, does not qualify. Instagram DMs only.</p>
<p>Delivery weeks are when agency DMs go cold. You are in a client Slack, and the founder who asked about a retainer on Monday has booked another shop by Thursday. Roleflow is the reply that still goes out, with voice notes in your own voice, cloned from a short recording, without you opening Instagram. Follow-ups stay within 24 hours. It asks budget and timing. It does not pitch a package you do not sell. The call it books is for your offer, on your account, not for a client's. No client logo and no revenue claim is added here. If a founder asks for a proposal, Roleflow books the call and leaves the scope document to you. It does not send a price you have not approved. Quotes stay in your hands.</p>
<p>Roleflow is a Client Acquisition System, with voice notes in your own voice, cloned from a short recording. We build the system on the agency owner's own Instagram and we run it. The first reply, the follow-up, and the booking stay with Roleflow. The delivery team stays on client work, and the closer takes the call. Follow-ups go out only within 24 hours. Qualified leads are booked on your calendar. We build and run the Instagram DM system. See <a href="/for/consultants/">consultants</a> and <a href="/for/course-creators/">course creators</a>.</p>
'''
AG_ES = '''
<h2>El inbox de tus clientes no es este producto</h2>
<p>A los dueños de agencia les venden herramientas que prometen llevar el Instagram de cada cliente. Eso no es Roleflow. Roleflow lleva los DMs del propio Instagram del dueño: esos en los que un fundador pregunta si puedes tomar su cuenta, cuánto cuesta el retainer y si tienes lugar este mes. Si vendes un servicio de ticket alto desde tu marca personal, tienes la misma fuga que un coach. Los leads esperan. El seguimiento se cae porque estás entregando a un cliente. Los setters de tu equipo se gestionan en lugar de que tú vendas la próxima cuenta.</p>
<p>La conversación es comercial. Presupuesto, alcance y tiempos. Roleflow responde en segundos, manda notas de voz personales que grabas, hace seguimiento y agenda una llamada calificada. No entra al perfil de un cliente. No publica. No reemplaza a quienes entregan el trabajo que vendes.</p>
<h2>Calificación, en claro</h2>
<p>Más de 20 DMs al día en la cuenta de Instagram que operaríamos, una oferta de más de $1.000, un cierre superior al 20 % y más de $30.000 cobrados al mes. Una agencia que vende setups de $500, o que vive en el email y en Upwork, no califica. Solo DMs de Instagram.</p>
<p>Las semanas de entrega son cuando los DMs de la agencia se enfrían. Estás en el Slack de un cliente, y el fundador que preguntó por un retainer el lunes ya contrató a otro el jueves. Roleflow es la respuesta que igual sale, con notas de voz en tu propia voz, clonadas de una grabación corta, sin que abras Instagram. El seguimiento se queda dentro de 24 horas. Pregunta presupuesto y tiempos. No ofrece un paquete que tú no vendes. La llamada que agenda es de tu oferta, en tu cuenta, no en la de un cliente. Aquí no hay logo de cliente ni cifra de facturación inventada. Si un fundador pide una propuesta, Roleflow agenda la llamada y te deja el documento de alcance. No manda un precio que tú no aprobaste. La cotización se queda en tus manos.</p>
<p>Roleflow es un sistema de adquisición de clientes para Instagram, con notas de voz en tu propia voz. Nosotros montamos ese sistema y lo seguimos operando en tu propio Instagram. Ese es el trabajo. El seguimiento sale solo dentro de 24 horas. Los leads calificados quedan en el calendario. Nosotros montamos y operamos el sistema. Mira <a href="/es/para/consultores/">consultores</a> y <a href="/es/para/infoproductores/">infoproductores</a>.</p>
'''
COURSE_EN = '''
<h2>Launches make a queue, not a relationship</h2>
<p>A course creator can have a quiet week and then a post or a cart open that drops a hundred Instagram DMs in an afternoon. The questions repeat: is this cohort still open, does it fit someone at my level, what is the price, can I pay later. Answering them by hand means the launch thread and the DM thread fight for the same hour. A generic "link in bio" reply wastes the people who were ready to talk. Roleflow answers each DM in seconds, qualifies against your offer, follows up only within 24 hours, and books calls for the high-ticket version of what you sell.</p>
<p>Low-ticket self-study courses are the wrong offer. Roleflow is for an offer above $1,000, where a call is how you sell. Voice notes in your own voice, cloned from a short recording, matter on a launch because the buyer followed you for the way you talk. A template does not sound like the person in the reels. Follow-ups go out only within 24 hours.</p>
<h2>After the spike</h2>
<p>The dangerous day is not launch day. It is three days later, when the unanswered "thinking about it" threads are buried. Follow-ups go out only within 24 hours. Booking is the job. You still teach and you still take sales calls. We build and run the Instagram DM system.</p>
<p>Qualify with 20+ DMs a day, close rate above 20%, and $30k+ a month collected. Instagram only. A creator who sells on email and uses Instagram as a billboard is not the fit. Qualified leads are booked on your calendar. We build and run the Instagram DM system.</p>
<p>Cart-open week also brings refund questions and "which bonus is included" from people who already bought. Those are support, not sales. Roleflow should book new buyers and leave existing-student support to you. The page does not invent launch revenue. It only describes the inbox problem. A launch screenshot is not a testimonial and is not used. People who already bought stay with your support inbox. New buyers who still have questions about price and fit are the threads Roleflow is for. We build the Instagram DM system and we run it through the launch and the quiet days after. Your closers take the calls that get booked.</p>
<p>Roleflow is a Client Acquisition System, with voice notes in your own voice, cloned from a short recording. See <a href="/for/coaches/">coaches</a> and <a href="/best-ai-dm-setters/">the comparison</a>.</p>
'''
COURSE_ES = '''
<h2>Un lanzamiento arma una cola, no una relación</h2>
<p>Quien vende un curso puede tener una semana tranquila y después una publicación o una apertura de carrito que deja cien DMs de Instagram en una tarde. Las preguntas se repiten: si la cohorte sigue abierta, si encaja con mi nivel, cuál es el precio, si se puede pagar después. Contestar a mano hace que el hilo del lanzamiento y el hilo de los DMs peleen por la misma hora. Un "link en la bio" genérico desperdicia a quien ya estaba listo para hablar. Roleflow responde cada DM en segundos, califica contra tu oferta, hace seguimiento solo dentro de 24 horas y agenda llamadas de la versión de ticket alto de lo que vendes.</p>
<p>Un curso barato de autoestudio es la oferta equivocada. Roleflow es para una oferta de más de $1.000, donde la llamada es como se vende. Las notas de voz personales que grabas importan en un lanzamiento porque el comprador te siguió por cómo hablas. Una plantilla no suena a la persona de los reels. El seguimiento sale solo dentro de 24 horas.</p>
<h2>Después del pico</h2>
<p>El día peligroso no es el del lanzamiento. Es tres días después, cuando los hilos de "lo estoy pensando" quedaron enterrados. El seguimiento sale solo dentro de 24 horas. Agendar es el trabajo. Tú sigues enseñando y sigues haciendo las llamadas de venta. Nosotros montamos y operamos el sistema de DMs.</p>
<p>Califica con más de 20 DMs al día, un cierre superior al 20 % y más de $30.000 cobrados al mes. Solo Instagram. Quien vende por email y usa Instagram como cartel no encaja. Los leads calificados quedan en el calendario. Nosotros montamos y operamos el sistema.</p>
<p>La semana de carrito también trae preguntas de reembolso y de "qué bono incluye" de quien ya compró. Eso es soporte, no venta. Roleflow debería agendar compradores nuevos y dejarte el soporte de alumnos. Esta página no inventa ingresos de un lanzamiento. Solo describe el problema del inbox. Una captura del lanzamiento no es un testimonio y no se usa. Quien ya compró se queda en tu soporte. Quien todavía pregunta precio y encaje es el hilo de Roleflow.</p>
<p>Roleflow es un sistema de adquisición de clientes para Instagram, con notas de voz en tu propia voz. Nosotros montamos el sistema de DMs y lo operamos. Tus closers hacen las llamadas que quedan agendadas. Mira <a href="/es/para/coaches/">coaches</a> y <a href="/es/mejores-setters-con-ia/">la comparativa</a>.</p>
'''

def faq_pick(src, idxs, extra=()):
    rows = [src[i] for i in idxs]
    return rows + list(extra)

LIST_EXTRA_EN = [
    ("Who should not use Roleflow?", "WhatsApp, email, or phone-first sellers, low-ticket offers, and businesses with very low DM volume.", True),
    ("Did Roleflow write this comparison?", "Yes. Roleflow wrote this page and sells a Client Acquisition System. Every tool, including Roleflow, has a wrong-for line.", True),
]
LIST_EXTRA_ES = [
    ("¿Quién no debería usar Roleflow?", "Quien vende por WhatsApp, email o teléfono, quien tiene una oferta de ticket bajo y quien tiene muy pocos DMs.", True),
    ("¿Roleflow escribió esta comparativa?", "Sí. Roleflow escribió esta página y vende un sistema de adquisición de clientes. Cada herramienta, Roleflow incluida, tiene una línea de para quién no es.", True),
]
NICHE_FAQ_EN = [
    ("Which channels?", FAQ_EN[5][1], True),
    ("Who qualifies?", FAQ_EN[2][1], True),
]
NICHE_FAQ_ES = [
    ("¿Qué canales?", FAQ_ES[5][1], True),
    ("¿Quién califica?", FAQ_ES[2][1], True),
]

def base(**k):
    return k

RES_EN = '''
<h2>Guides</h2>
<ul>
<li><a href="/what-is-an-ai-dm-setter/">What is an AI DM setter</a></li>
<li><a href="/faq/">FAQ</a></li>
<li><a href="/best-ai-dm-setters/">Best AI DM setters</a></li>
<li><a href="/vs/ripdrip/">Roleflow vs RipDrip</a></li>
<li><a href="/vs/mochi/">Roleflow vs Mochi</a></li>
<li><a href="/about/">About</a></li>
<li><a href="/signup/">Sign up</a></li>
</ul>
<h2>By niche</h2>
<ul>
<li><a href="/for/coaches/">For coaches</a></li>
<li><a href="/for/business-coaches/">For business coaches</a></li>
<li><a href="/for/fitness-coaches/">For fitness coaches</a></li>
<li><a href="/for/consultants/">For consultants</a></li>
<li><a href="/for/agency-owners/">For agency owners</a></li>
<li><a href="/for/course-creators/">For course creators</a></li>
</ul>
<p>The same guides in Spanish are on <a href="/es/recursos/">Recursos</a>. The quiz stays on the <a href="/#start">homepage</a>.</p>
'''

RES_ES = '''
<h2>Guías</h2>
<ul>
<li><a href="/es/que-es-un-setter-con-ia/">Qué es un setter con IA</a></li>
<li><a href="/es/preguntas-frecuentes/">Preguntas frecuentes</a></li>
<li><a href="/es/mejores-setters-con-ia/">Mejores setters con IA</a></li>
<li><a href="/es/vs/ripdrip/">Roleflow frente a RipDrip</a></li>
<li><a href="/es/vs/mochi/">Roleflow frente a Mochi</a></li>
<li><a href="/es/sobre-nosotros/">Sobre nosotros</a></li>
<li><a href="/signup/">Crear cuenta</a> (la cuenta está en inglés)</li>
</ul>
<h2>Por nicho</h2>
<ul>
<li><a href="/es/para/coaches/">Para coaches</a></li>
<li><a href="/es/para/coaches-de-negocios/">Para coaches de negocios</a></li>
<li><a href="/es/para/coaches-fitness/">Para coaches fitness</a></li>
<li><a href="/es/para/consultores/">Para consultores</a></li>
<li><a href="/es/para/agencias/">Para agencias</a></li>
<li><a href="/es/para/infoproductores/">Para infoproductores</a></li>
</ul>
<p>Las mismas guías en inglés están en <a href="/resources/">Resources</a>. El cuestionario sigue en el <a href="/#start">inicio</a>.</p>
'''

PAGES = [
    D.P("", "es", "Home", "Inicio", skip_en=True, home=True,
        title_en="Roleflow | Client Acquisition System",
        title_es="Roleflow | Sistema de adquisición de clientes",
        desc_en="Client Acquisition System for Instagram DMs. We build and run the DM system, answer every lead in seconds, and book qualified calls on your calendar today.",
        desc_es="Sistema de adquisición de clientes para DMs de Instagram. Montamos y operamos el sistema, respondemos cada lead en segundos y agendamos las llamadas hoy.",
        h1_en="Roleflow",
        h1_es="Sistema de adquisición de clientes",
        answer_en="Roleflow is a Client Acquisition System. We build and run your Instagram DM system. It replies to every inbound DM in seconds, sends voice notes in your own voice, cloned from a short recording, follows up only within 24 hours, and books qualified calls. Your closers take the calls.",
        answer_es="Roleflow es un sistema de adquisición de clientes. Montamos y operamos tu sistema de DMs de Instagram. Responde cada lead en segundos, manda notas de voz en tu propia voz, clonadas de una grabación corta, y el seguimiento sale solo dentro de 24 horas. Tus closers hacen las llamadas.",
        body_en="", body_es=D.HOME_ES_BODY, faq_en=D.HOME_FAQ_EN, faq_es=D.HOME_FAQ_ES,
        crumbs_en=[("Home", "/")], crumbs_es=[("Inicio", "/es/")]),
    D.P("what-is-an-ai-dm-setter", "es/que-es-un-setter-con-ia", "What is an AI DM setter", "Qué es un setter con IA",
        title_en="What Is an AI DM Setter? | Roleflow", title_es="Qué es un setter con IA | Roleflow",
        desc_en="An AI DM setter replies, qualifies, follows up, and books calls. Roleflow is a Client Acquisition System for Instagram DMs, with voice notes in your own voice.",
        desc_es="Un setter con IA responde DMs, califica, hace seguimiento y agenda. Roleflow es un sistema de adquisición de clientes, con notas de voz en tu propia voz.",
        h1_en="What is an AI DM setter?", h1_es="Qué es un setter con IA",
        answer_en="An AI DM setter is software that replies to inbound direct messages, qualifies the lead, follows up, and books a sales call. It does the work of a human appointment setter. Roleflow is a Client Acquisition System for Instagram DMs. It replies in seconds and sends voice notes in your own voice, cloned from a short recording.",
        answer_es="Un setter con IA es un software que responde los mensajes directos, califica al lead, hace seguimiento y agenda una llamada de venta. Hace el trabajo de un appointment setter humano. Roleflow es un sistema de adquisición de clientes: responde en segundos y manda notas de voz en tu propia voz, clonadas de una grabación corta.",
        body_en=D.DEF_EN, body_es=D.DEF_ES, faq_en=faq_pick(FAQ_EN, [0, 1, 5]), faq_es=faq_pick(FAQ_ES, [0, 1, 5])),
    D.P("faq", "es/preguntas-frecuentes", "FAQ", "Preguntas frecuentes",
        title_en="AI DM Setter FAQ | Roleflow", title_es="Preguntas del setter con IA | Roleflow",
        desc_en="FAQ on what an AI DM setter is, who qualifies, and Instagram DMs. Roleflow is a Client Acquisition System we build and run, with voice notes in your own voice.",
        desc_es="Preguntas sobre qué es un setter con IA, quién califica y los DMs de Instagram. Roleflow es un sistema de adquisición de clientes que montamos y operamos.",
        h1_en="AI DM setter FAQ", h1_es="Preguntas frecuentes",
        answer_en="These answers cover what an AI DM setter is, what Roleflow does, who qualifies, and which channel it runs. Roleflow is a Client Acquisition System for Instagram DMs, with voice notes in your own voice, cloned from a short recording. We build the system and we run it.",
        answer_es="Estas respuestas explican qué es un setter con IA, qué hace Roleflow, quién califica y en qué canal trabaja. Roleflow es un sistema de adquisición de clientes para Instagram, con notas de voz en tu propia voz, clonadas de una grabación corta.",
        body_en="<p>Unknown facts are left out.</p>" + links_en(),
        body_es="<p>Si un dato no está confirmado, no se inventa.</p>" + links_es(),
        faq_en=FAQ_EN, faq_es=FAQ_ES),
    D.P("best-ai-dm-setters", "es/mejores-setters-con-ia", "Best AI DM setters", "Mejores setters con IA", updated=True, article=True,
        title_en="Best AI DM Setters (2026) | Roleflow", title_es="Mejores setters con IA (2026) | Roleflow",
        desc_en="A 2026 comparison of Roleflow, RipDrip, and Mochi for Instagram DMs. Only cited prices and features, with a wrong-for line on each tool, checked in October.",
        desc_es="Comparativa de 2026 de Roleflow, RipDrip y Mochi para DMs de Instagram. Solo precios y funciones citados, con una línea de no encaje en cada herramienta.",
        h1_en="Best AI DM setters for Instagram (2026)", h1_es="Los mejores setters con IA para Instagram (2026)",
        answer_en="Pick Roleflow when you want a Client Acquisition System we build and run, with voice notes in your own voice, cloned from a short recording. RipDrip publishes a team-built clone, usually live in 72 hours, and no price. Mochi publishes monthly plans at $149, $297, and $497.",
        answer_es="Elige Roleflow si quieres un sistema de adquisición de clientes que montamos y operamos, con notas de voz en tu propia voz, clonadas de una grabación corta. RipDrip publica un clon de su equipo, en general en 72 horas, y sin precio. Mochi publica planes de $149, $297 y $497.",
        body_en=D.BEST_EN, body_es=D.BEST_ES,
        faq_en=faq_pick(FAQ_EN, [0, 2, 5, 6, 7], LIST_EXTRA_EN),
        faq_es=faq_pick(FAQ_ES, [0, 2, 5, 6, 7], LIST_EXTRA_ES)),
    D.P("resources", "es/recursos", "Resources", "Recursos",
        title_en="Resources | Roleflow", title_es="Recursos | Roleflow",
        desc_en="Guides for Roleflow: what an AI DM setter is, the FAQ, RipDrip and Mochi comparisons, niche pages for coaches and agencies, plus every Spanish page here.",
        desc_es="Recursos de Roleflow: la guía del setter con IA, las preguntas frecuentes, comparativas de RipDrip y Mochi, y los nichos, más cada página en inglés aquí.",
        h1_en="Resources", h1_es="Recursos",
        answer_en="These guides explain Roleflow and compare it with RipDrip and Mochi using only facts from each company site. You will also find the FAQ and pages for coaches, consultants, agencies, and course creators. The homepage quiz stays on the home page.",
        answer_es="Estas guías explican Roleflow y lo comparan con RipDrip y Mochi usando solo datos del sitio de cada empresa. También están las preguntas y las páginas para coaches, consultores, agencias e infoproductores. El cuestionario sigue en la página de inicio.",
        body_en=RES_EN, body_es=RES_ES),
    D.P("vs/ripdrip", "es/vs/ripdrip", "Roleflow vs RipDrip", "Roleflow frente a RipDrip", updated=True,
        title_en="Roleflow vs RipDrip", title_es="Roleflow frente a RipDrip",
        desc_en="Roleflow vs RipDrip for Instagram DMs. A Client Acquisition System we build and run, against a team-built clone, a 72-hour setup, and no published price.",
        desc_es="Roleflow frente a RipDrip en DMs de Instagram. Un sistema de adquisición de clientes, frente a un clon que arma su equipo, en 72 horas y sin precio publicado.",
        h1_en="Roleflow vs RipDrip", h1_es="Roleflow vs RipDrip",
        answer_en="Roleflow is a Client Acquisition System, with voice notes in your own voice, cloned from a short recording. We build the system and we run it. RipDrip says it builds a custom AI sales clone for an Instagram DM funnel, usually live in 72 hours, and that its team does the build. That page does not publish a price.",
        answer_es="Roleflow es un sistema de adquisición de clientes en Instagram, con notas de voz en tu propia voz, clonadas de una grabación corta. Nosotros lo montamos y lo operamos. El home de RipDrip dice que arma un clon con IA para un embudo de DMs y que suele estar en vivo en 72 horas. Esa página no publica un precio.",
        body_en=RD_EN, body_es=RD_ES, faq_en=NICHE_FAQ_EN, faq_es=NICHE_FAQ_ES),
    D.P("vs/mochi", "es/vs/mochi", "Roleflow vs Mochi", "Roleflow frente a Mochi", updated=True,
        title_en="Roleflow vs Mochi", title_es="Roleflow frente a Mochi",
        desc_en="Roleflow vs Mochi for Instagram DMs. A Client Acquisition System we build and run, against Mochi monthly plans at $149, $297, and $497. Sources included.",
        desc_es="Roleflow frente a Mochi en DMs de Instagram. Un sistema de adquisición de clientes, frente a los planes de Mochi a $149, $297 y $497. Fuentes incluidas.",
        h1_en="Roleflow vs Mochi", h1_es="Roleflow vs Mochi",
        answer_en="Roleflow builds and runs your Instagram DM system, with voice notes in your own voice, cloned from a short recording. Mochi lists monthly plans at $149, $297, and $497, a 7-day trial, and an Instagram inbox your team uses. Essential and Pro list voice notes that setters type. Choose Mochi to run that software.",
        answer_es="Roleflow monta y opera el sistema de DMs de Instagram, con notas de voz en tu propia voz, clonadas de una grabación corta. Mochi lista planes de $149, $297 y $497 al mes, 7 días de prueba y un inbox para tu equipo. Essential y Pro listan notas de voz que escribe el setter.",
        body_en=MO_EN, body_es=MO_ES, faq_en=NICHE_FAQ_EN, faq_es=NICHE_FAQ_ES),
]

def niche(en, es, name_en, name_es, title_en, title_es, desc_en, desc_es, h1_en, h1_es, answer_en, answer_es, body_en, body_es):
    return D.P(en, es, name_en, name_es, min_words=400,
        title_en=title_en, title_es=title_es, desc_en=desc_en, desc_es=desc_es,
        h1_en=h1_en, h1_es=h1_es, answer_en=answer_en, answer_es=answer_es,
        body_en=body_en + links_en(), body_es=body_es + links_es(),
        faq_en=NICHE_FAQ_EN, faq_es=NICHE_FAQ_ES)

PAGES += [
    niche("for/coaches", "es/para/coaches", "For coaches", "Para coaches",
          "AI DM Setter for Coaches | Roleflow", "Setter con IA para coaches | Roleflow",
          "AI DM setter for coaches on Instagram. Roleflow is a Client Acquisition System: replies in seconds, voice notes in your own voice, and booked calls. We run it.",
          "Setter con IA para coaches en Instagram. Roleflow es un sistema de adquisición de clientes: responde en segundos y agenda llamadas calificadas. Lo operamos.",
          "AI DM setter for coaches", "Setter con IA para coaches",
          "An AI DM setter for coaches replies to Instagram leads about your program, qualifies them, and books the sales call. Roleflow does that work as a Client Acquisition System, with voice notes in your own voice, cloned from a short recording. We build it and we run it.",
          "Un setter con IA para coaches responde en Instagram sobre tu programa, califica y agenda la llamada. Roleflow lo hace como sistema de adquisición de clientes, con notas de voz en tu propia voz, clonadas de una grabación corta. Nosotros lo montamos y lo operamos.",
          COACH_EN, COACH_ES),
    niche("for/business-coaches", "es/para/coaches-de-negocios", "For business coaches", "Para coaches de negocios",
          "AI DM Setter for Business Coaches | Roleflow", "Setter con IA para negocios | Roleflow",
          "AI DM setter for business coaches. Roleflow is a Client Acquisition System for Instagram DMs: replies in seconds and books qualified calls. We build and run it.",
          "Setter con IA para coaches de negocios. Roleflow es un sistema de adquisición de clientes: lleva los DMs de Instagram y agenda llamadas calificadas hoy.",
          "AI DM setter for business coaches", "Setter con IA para coaches de negocios",
          "Business coaches lose deals when a DM about a high-ticket program sits for hours. Roleflow is a Client Acquisition System for Instagram. It replies in seconds, sends voice notes in your own voice, cloned from a short recording, and books qualified calls. We build it and we run it.",
          "Un coach de negocios pierde ventas cuando un DM sobre un programa de ticket alto espera horas. Roleflow es un sistema de adquisición de clientes para Instagram: responde en segundos, manda notas de voz en tu propia voz y agenda llamadas. Nosotros lo montamos y lo operamos.",
          BIZ_EN, BIZ_ES),
    niche("for/fitness-coaches", "es/para/coaches-fitness", "For fitness coaches", "Para coaches fitness",
          "AI DM Setter for Fitness Coaches | Roleflow", "Setter con IA para fitness | Roleflow",
          "AI DM setter for fitness coaches on Instagram. Roleflow is a Client Acquisition System: it answers program DMs in seconds and books calls. We build and run it.",
          "Setter con IA para coaches fitness en Instagram. Roleflow es un sistema de adquisición de clientes: responde DMs del programa en segundos y agenda llamadas.",
          "AI DM setter for fitness coaches", "Setter con IA para coaches fitness",
          "Fitness coaches get DMs after reels asking if spots are open. Roleflow answers those Instagram messages in seconds, with voice notes in your own voice, cloned from a short recording, and books people who fit. We build it and we run it. It fits coaches above the qualification line, not low-ticket challenges.",
          "Los coaches de fitness reciben DMs después de un reel preguntando si quedan cupos. Roleflow responde esos mensajes de Instagram en segundos, con notas de voz en tu propia voz, y agenda a quien encaja. Es un sistema de adquisición de clientes. Nosotros lo montamos y lo operamos.",
          FIT_EN, FIT_ES),
    niche("for/consultants", "es/para/consultores", "For consultants", "Para consultores",
          "AI DM Setter for Consultants | Roleflow", "Setter con IA para consultores | Roleflow",
          "AI DM setter for consultants on Instagram. Roleflow is a Client Acquisition System: it qualifies leads and books calls. We build the system and run it.",
          "Setter con IA para consultores en DMs de Instagram. Roleflow es un sistema de adquisición de clientes: califica y agenda llamadas. Lo montamos y lo operamos.",
          "AI DM setter for consultants", "Setter con IA para consultores",
          "Consultants sell through conversations, and Instagram DMs are often the first one. Roleflow is a Client Acquisition System that replies in seconds, sends voice notes in your own voice, cloned from a short recording, and books a qualified call. We build it and we run it.",
          "Los consultores venden en conversaciones, y el DM de Instagram suele ser la primera. Roleflow es un sistema de adquisición de clientes: responde en segundos, manda notas de voz en tu propia voz y agenda una llamada calificada. Lo montamos y lo operamos. Si vendes por teléfono, no es tu canal.",
          CON_EN, CON_ES),
    niche("for/agency-owners", "es/para/agencias", "For agency owners", "Para agencias",
          "AI DM Setter for Agency Owners | Roleflow", "Setter con IA para agencias | Roleflow",
          "AI DM setter for agency owners selling from their own Instagram. Roleflow is a Client Acquisition System that books qualified calls. We build and run it.",
          "Setter con IA para dueños de agencia que venden desde su Instagram. Roleflow es un sistema de adquisición de clientes y agenda llamadas calificadas hoy.",
          "AI DM setter for agency owners", "Setter con IA para dueños de agencia",
          "Agency owners who sell a high-ticket service from their own Instagram still lose leads in the DMs. Roleflow replies in seconds, sends voice notes in your own voice, cloned from a short recording, follows up within 24 hours, and books the call. We build and run it.",
          "El dueño de una agencia que vende un servicio de ticket alto desde su propio Instagram también pierde leads en los DMs. Roleflow es un sistema de adquisición de clientes: responde en segundos, hace seguimiento dentro de 24 horas y agenda. No llevamos el inbox de tus clientes.",
          AG_EN, AG_ES),
    niche("for/course-creators", "es/para/infoproductores", "For course creators", "Para infoproductores",
          "AI DM Setter for Course Creators | Roleflow", "Setter con IA para cursos | Roleflow",
          "AI DM setter for course creators. Roleflow is a Client Acquisition System: it answers launch DMs on Instagram in seconds and books calls. We build and run it.",
          "Setter con IA para infoproductores. Roleflow es un sistema de adquisición de clientes: responde los DMs del lanzamiento en Instagram y agenda llamadas.",
          "AI DM setter for course creators", "Setter con IA para infoproductores",
          "Course creators get a spike of Instagram DMs when a post or launch goes out. Roleflow answers each one in seconds, qualifies, follows up only within 24 hours, and books calls for a high-ticket offer, with voice notes in your own voice, cloned from a short recording. We build and run it.",
          "Quien vende un curso recibe un pico de DMs en Instagram cuando publica o abre un lanzamiento. Roleflow es un sistema de adquisición de clientes: responde cada DM en segundos, califica, hace seguimiento dentro de 24 horas y agenda llamadas de ticket alto. Nosotros lo montamos y lo operamos.",
          COURSE_EN, COURSE_ES),
    D.P("about", "es/sobre-nosotros", "About", "Sobre nosotros",
        title_en="About Roleflow | Client Acquisition System", title_es="Sobre Roleflow | Sistema de adquisición",
        desc_en="About Roleflow, a Client Acquisition System for Instagram DMs. Voice notes in your own voice. We build the system and run it. Contact diego@roleflow.io.",
        desc_es="Sobre Roleflow, sistema de adquisición de clientes para Instagram. Notas de voz en tu propia voz. Lo montamos y lo operamos. Contacto diego@roleflow.io.",
        h1_en="About Roleflow", h1_es="Sobre Roleflow",
        answer_en="Roleflow is a Client Acquisition System. We build and run your Instagram DM system. It replies in seconds, sends voice notes in your own voice, cloned from a short recording, follows up only within 24 hours, and books qualified calls. Your closers take the calls. Contact diego@roleflow.io.",
        answer_es="Roleflow es un sistema de adquisición de clientes. Montamos y operamos tu sistema de DMs de Instagram. Responde en segundos, manda notas de voz en tu propia voz, clonadas de una grabación corta, y agenda llamadas calificadas. El contacto es diego@roleflow.io.",
        body_en=ABOUT_EN, body_es=ABOUT_ES),
]
