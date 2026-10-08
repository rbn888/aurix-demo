/* ============================================================
   AURIX landing — i18n (ES/EN), header, mobile menu, reveal,
   early-access placeholder. Vanilla JS, no dependencies.
   ============================================================ */
(function () {
  'use strict';

  /* ── Public launch (SPEC LANZAMIENTO 1) — SINGLE SOURCE OF TRUTH for the
     landing. KEEP IN SYNC with login.html (the app deploy, which owns the real
     OTP gate). Fixed UTC timestamp so an early/late deploy never shifts the
     official launch, and never computed from deploy time or localStorage.
       2026-07-23T17:00:00.000Z === Thu 23 Jul 2026, 19:00 Europe/Madrid
     Rollback: set PUBLIC_LAUNCH_ENABLED = false → public access closed again. */
  var PUBLIC_LAUNCH_ENABLED = true;
  var PUBLIC_LAUNCH_AT      = '2026-07-23T17:00:00.000Z';
  var PUBLIC_LAUNCH_AT_MS   = Date.parse(PUBLIC_LAUNCH_AT);
  function isPublicLaunchOpen() { return PUBLIC_LAUNCH_ENABLED === true && Date.now() >= PUBLIC_LAUNCH_AT_MS; }
  // ceil so it never shows "0 h" while still closed (0 only once truly open).
  function publicLaunchRemainingHours() { return Math.max(0, Math.ceil((PUBLIC_LAUNCH_AT_MS - Date.now()) / 3600000)); }

  /* ── Translations ───────────────────────────────────── */
  var I18N = {
    es: {

      'hero.eyebrow': 'Sistema operativo del patrimonio',
      'hero.h1a': 'Todo tu patrimonio.',
      'hero.h1b': 'Un solo sistema operativo.',
      'hero.sub': 'Aurix reúne acciones, fondos, cripto, metales, inmuebles y liquidez en una interfaz clara y privada.',
      'preview.label': 'Vista previa del producto',
      'mock.total': 'Patrimonio total', 'mock.value': '4,82 M€', 'mock.delta': '+8,4% YTD',
      'mock.health': 'Salud de cartera', 'mock.health.v': 'Sólida',
      'mock.risk': 'Riesgo', 'mock.risk.v': 'Equilibrado',

      'problem.title': 'Tu patrimonio está fragmentado.',
      'problem.lead': 'Repartido entre bancos, brókers y aplicaciones que no se hablan entre sí.',
      'frag.banks.t': 'Bancos', 'frag.banks.d': 'efectivo y depósitos',
      'frag.brokers.t': 'Brókers', 'frag.brokers.d': 'acciones, ETFs y fondos',
      'frag.crypto.t': 'Cripto', 'frag.crypto.d': 'activos digitales',
      'frag.realestate.t': 'Inmuebles', 'frag.realestate.d': 'asignación inmobiliaria',
      'frag.metals.t': 'Metales', 'frag.metals.d': 'oro y metales preciosos',
      'frag.cash.t': 'Liquidez', 'frag.cash.d': 'posición disponible',
      'pain.1.t': 'Sin visibilidad', 'pain.1.d': 'Nunca ves tu situación financiera completa.',
      'pain.2.t': 'Sin claridad', 'pain.2.d': 'No sabes cómo está distribuido todo.',
      'pain.3.t': 'Sin contexto', 'pain.3.d': 'Tus números no explican lo que significan.',

      'solution.title': 'Diseñado para ver todo tu patrimonio como un solo sistema.',
      'solution.lead': 'Aurix centraliza cada clase de activo en una interfaz clara, dándote control, contexto y claridad sobre tu vida financiera.',
      'solution.assets': 'Acciones · ETFs · Fondos · Cripto · Inmuebles · Metales · Liquidez',
      'asset.stocks': 'Acciones', 'asset.etfs': 'ETFs', 'asset.funds': 'Fondos', 'asset.crypto': 'Cripto',
      'asset.metals': 'Metales', 'asset.realestate': 'Inmuebles', 'asset.cash': 'Liquidez',
      'feat.value.t': 'Valor total', 'feat.value.d': 'Unificado entre todas tus clases de activo.',
      'feat.alloc.t': 'Asignación', 'feat.alloc.d': 'Cómo está repartido entre clases de activo.',
      'feat.evo.t': 'Evolución', 'feat.evo.d': 'El recorrido de tu patrimonio en el tiempo.',
      'feat.health.t': 'Salud de cartera', 'feat.health.d': 'Concentración, liquidez y riesgo, interpretados.',
      'feat.insights.t': 'Insights', 'feat.insights.d': 'Observaciones claras sobre tu estructura.',
      'feat.intel.t': 'Inteligencia', 'feat.intel.d': 'Contexto, no solo cifras.',

      'trust.label': 'Unificado en',
      'show.title': 'Diseñado para ver todo tu patrimonio como un único sistema.',
      'show.lead': 'Control, contexto y claridad en una sola interfaz.',

      'ws.eyebrow': 'Inteligencia',
      'ws.title': 'Plataforma de Inteligencia Patrimonial',
      'ws.lead': 'Centralizar tu patrimonio es solo el comienzo.',
      'ws.lead2': 'Aurix transforma datos dispersos en comprensión accionable para ayudarte a entender qué está cambiando, qué importa y qué requiere tu atención.',
      'ws.b1': 'Cambios relevantes detectados automáticamente',
      'ws.b2': 'Salud de cartera en tiempo real',
      'ws.b3': 'Contexto de mercado aplicado a tu patrimonio',
      'ws.b4': 'Recomendaciones accionables impulsadas por IA',

      'market.eyebrow': 'Mercado',
      'market.title': 'Consulta los mercados desde un único lugar.',
      'market.lead': 'Sigue cualquier activo relevante desde una interfaz profesional: el contexto de mercado que necesitas para entender qué ocurre con tus inversiones, no solo tu patrimonio.',
      'market.1': 'Acciones', 'market.2': 'ETFs y Fondos', 'market.3': 'Cripto',
      'market.4': 'Materias primas', 'market.5': 'Índices', 'market.6': 'Mercados globales',

      'roadmap.title': 'Hacia dónde va Aurix.',
      'roadmap.now': 'Ahora', 'roadmap.next': 'Próximo', 'roadmap.later': 'Después',
      'rm.now.1': 'Dashboard patrimonial', 'rm.now.2': 'Seguimiento de mercado', 'rm.now.3': 'Centro financiero personal', 'rm.now.4': 'Cartera inmobiliaria',
      'rm.next.1': 'Centro de inteligencia', 'rm.next.2': 'Salud de cartera', 'rm.next.3': 'Acceso Fundador', 'rm.next.4': 'Herramientas inteligentes',
      'rm.later.1': 'Automatización avanzada', 'rm.later.2': 'Insights asistidos por IA', 'rm.later.3': 'Integraciones ampliadas', 'rm.later.4': 'Planificación patrimonial avanzada',

      'updates.title': 'Centro financiero personal.',
      'updates.sub': 'Planifica, simula y organiza las áreas más importantes de tu patrimonio desde una única zona de trabajo.',
      'updates.1': 'Planificación financiera', 'updates.2': 'Cartera inmobiliaria', 'updates.3': 'Objetivos financieros',
      'updates.4': 'Herramientas de crecimiento patrimonial', 'updates.5': 'Análisis de escenarios', 'updates.6': 'Análisis de financiación',
      'updates.7': 'Diario de inversiones', 'updates.8': 'Gestión de flujo de caja', 'updates.9': 'Seguimiento de mercado',
      'updates.10': 'Calculadora de interés compuesto',

      'early.eyebrow': 'Beta privada',
      'early.title': 'Solo por invitación.',
      'early.sub': 'Aurix está abriendo acceso a usuarios seleccionados antes del lanzamiento público.',
      'early.founder': 'El Acceso Fundador estará disponible para los primeros miembros, con beneficios exclusivos, acceso prioritario y reconocimiento permanente de fundador.',
      'early.name': 'Nombre', 'early.email': 'Email', 'early.button': 'Solicitar acceso',
      'early.note': 'No compartiremos tu información. Beta privada · plazas limitadas.',
      'early.invalid': 'Revisa tu nombre y un email válido.',
      'early.sending': 'Enviando…',
      'early.dup': 'Ya estás en la lista de espera de Aurix.',
      'early.rate': 'Demasiados intentos. Inténtalo de nuevo más tarde.',
      'early.error': 'Algo salió mal. Inténtalo de nuevo.',
      'early.success': 'Solicitud recibida. Te contactaremos pronto.',
      'early.trust': 'Primeras plazas disponibles por invitación',
      'modal.title': 'Solicita acceso privado.',
      'modal.sub': 'Déjanos tus datos y contactaremos con usuarios seleccionados.',
      'footer.tag': 'Plataforma de inteligencia patrimonial',
      'footer.product': 'Plataforma', 'footer.legal': 'Legal', 'footer.privacy': 'Privacidad', 'footer.terms': 'Términos', 'footer.support': 'Soporte', 'footer.social': 'Social',
      'footer.desc': 'Aurix es una plataforma de inteligencia patrimonial diseñada para ayudar a las personas a centralizar su patrimonio, entender su evolución y ganar claridad sobre su futuro financiero.',

      'pos.eyebrow': 'Plataforma de inteligencia patrimonial',
      'pos.title1': 'Centraliza tu patrimonio.',
      'pos.title2': 'Entiende su evolución.',
      'pos.title3': 'Descubre qué impulsa tu futuro financiero.',
      'pos.lead': 'Aurix transforma datos financieros fragmentados en claridad, contexto y comprensión accionable.',
      'pos.lead2': 'Porque construir patrimonio no consiste solo en seguir activos. Consiste en entender las decisiones, tendencias y fuerzas que moldean tu futuro financiero.',

      'community.title': 'Únete a la comunidad de Aurix',
      'community.text': 'Sigue el desarrollo del producto, recibe novedades y conecta con los primeros usuarios que están construyendo el futuro de la inteligencia patrimonial.',
      'community.tg.sub': 'Comunidad oficial',

      'cred.1': 'Una sola plataforma.', 'cred.2': 'Todo tu patrimonio.', 'cred.3': 'Visibilidad completa.',

      'meta.title': 'Aurix — El sistema operativo de tu patrimonio',
      'meta.desc': 'Controla, entiende y gestiona todo tu patrimonio — acciones, fondos, cripto, inmuebles, metales y liquidez — desde una sola plataforma.'
    },
    en: {

      'hero.eyebrow': 'Wealth Operating System',
      'hero.h1a': 'Your entire wealth.',
      'hero.h1b': 'One operating system.',
      'hero.sub': 'Aurix brings stocks, funds, crypto, metals, real estate and cash into one clear, private interface.',
      'preview.label': 'Product preview',
      'mock.total': 'Total Wealth', 'mock.value': '$4.82M', 'mock.delta': '+8.4% YTD',
      'mock.health': 'Health Score', 'mock.health.v': 'Strong',
      'mock.risk': 'Risk', 'mock.risk.v': 'Balanced',

      'problem.title': 'Your wealth is fragmented.',
      'problem.lead': 'Spread across banks, brokers and apps that never talk to each other.',
      'frag.banks.t': 'Banks', 'frag.banks.d': 'Cash and deposits',
      'frag.brokers.t': 'Brokers', 'frag.brokers.d': 'Stocks, ETFs and funds',
      'frag.crypto.t': 'Crypto', 'frag.crypto.d': 'Digital assets',
      'frag.realestate.t': 'Real Estate', 'frag.realestate.d': 'Property allocation',
      'frag.metals.t': 'Metals', 'frag.metals.d': 'Gold and precious metals',
      'frag.cash.t': 'Cash', 'frag.cash.d': 'Liquidity position',
      'pain.1.t': 'No visibility', 'pain.1.d': 'You never see your full financial picture.',
      'pain.2.t': 'No clarity', 'pain.2.d': 'You don’t know how everything is distributed.',
      'pain.3.t': 'No context', 'pain.3.d': 'Your numbers don’t explain what they mean.',

      'solution.title': 'Built to see your entire wealth as one system.',
      'solution.lead': 'Aurix centralizes every asset class into one clear interface, giving you control, context and clarity over your financial life.',
      'solution.assets': 'Stocks · ETFs · Funds · Crypto · Real Estate · Metals · Cash',
      'asset.stocks': 'Stocks', 'asset.etfs': 'ETFs', 'asset.funds': 'Funds', 'asset.crypto': 'Crypto',
      'asset.metals': 'Metals', 'asset.realestate': 'Real Estate', 'asset.cash': 'Cash',
      'feat.value.t': 'Total value', 'feat.value.d': 'Unified across asset classes.',
      'feat.alloc.t': 'Allocation', 'feat.alloc.d': 'How it is split across asset classes.',
      'feat.evo.t': 'Evolution', 'feat.evo.d': 'Your wealth’s journey over time.',
      'feat.health.t': 'Portfolio health', 'feat.health.d': 'Concentration, liquidity and risk, interpreted.',
      'feat.insights.t': 'Insights', 'feat.insights.d': 'Clear observations about your structure.',
      'feat.intel.t': 'Intelligence', 'feat.intel.d': 'Context, not just figures.',

      'trust.label': 'Unified across',
      'show.title': 'Built to see your entire wealth as one system.',
      'show.lead': 'Control, context and clarity in a single interface.',

      'ws.eyebrow': 'Intelligence',
      'ws.title': 'Wealth Intelligence Platform',
      'ws.lead': 'Centralizing your wealth is only the beginning.',
      'ws.lead2': 'Aurix turns scattered data into actionable understanding — helping you see what is changing, what matters and what needs your attention.',
      'ws.b1': 'Relevant changes detected automatically',
      'ws.b2': 'Real-time portfolio health',
      'ws.b3': 'Market context applied to your wealth',
      'ws.b4': 'AI-driven actionable insights',

      'market.eyebrow': 'Market',
      'market.title': 'Follow the markets from one place.',
      'market.lead': 'Track any relevant asset from a professional interface — the market context you need to understand what is happening with your investments, not just your wealth.',
      'market.1': 'Stocks', 'market.2': 'ETFs & Funds', 'market.3': 'Crypto',
      'market.4': 'Commodities', 'market.5': 'Indices', 'market.6': 'Global markets',

      'roadmap.title': 'Where Aurix is heading.',
      'roadmap.now': 'Now', 'roadmap.next': 'Next', 'roadmap.later': 'Later',
      'rm.now.1': 'Portfolio Dashboard', 'rm.now.2': 'Market Tracking', 'rm.now.3': 'Personal Financial Center', 'rm.now.4': 'Real Estate Portfolio',
      'rm.next.1': 'Intelligence Center', 'rm.next.2': 'Portfolio Health', 'rm.next.3': 'Founder Access', 'rm.next.4': 'Smart Tools',
      'rm.later.1': 'Advanced Automation', 'rm.later.2': 'AI-Assisted Insights', 'rm.later.3': 'Expanded Integrations', 'rm.later.4': 'Advanced Wealth Planning',

      'updates.title': 'Personal financial center.',
      'updates.sub': 'Plan, simulate and organize the most important areas of your wealth from a single workspace.',
      'updates.1': 'Financial Planning', 'updates.2': 'Real Estate Portfolio', 'updates.3': 'Financial Goals',
      'updates.4': 'Wealth Growth Tools', 'updates.5': 'Scenario Analysis', 'updates.6': 'Financing Analysis',
      'updates.7': 'Investment Journal', 'updates.8': 'Cash Flow Management', 'updates.9': 'Market Monitoring',
      'updates.10': 'Compound Interest Calculator',

      'early.eyebrow': 'Private Beta',
      'early.title': 'Invitation only.',
      'early.sub': 'Aurix is currently opening access to selected early users before public launch.',
      'early.founder': 'Founder Access will be available for early members with exclusive benefits, priority access and permanent founder recognition.',
      'early.name': 'Name', 'early.email': 'Email', 'early.button': 'Request Access',
      'early.note': 'We will not share your information. Private beta · limited spots.',
      'early.invalid': 'Please check your name and a valid email.',
      'early.sending': 'Sending…',
      'early.dup': 'You’re already on the Aurix waitlist.',
      'early.rate': 'Too many attempts. Please try again later.',
      'early.error': 'Something went wrong. Please try again.',
      'early.success': 'Request received. We’ll be in touch.',
      'early.trust': 'Limited early invitations available',
      'modal.title': 'Request private access.',
      'modal.sub': 'Leave your details and we’ll contact selected users.',
      'footer.tag': 'Wealth Intelligence Platform',
      'footer.product': 'Platform', 'footer.legal': 'Legal', 'footer.privacy': 'Privacy', 'footer.terms': 'Terms', 'footer.support': 'Support', 'footer.social': 'Social',
      'footer.desc': 'Aurix is a Wealth Intelligence Platform designed to help people centralize their wealth, understand its evolution and gain clarity over their financial future.',

      'pos.eyebrow': 'Wealth Intelligence Platform',
      'pos.title1': 'Centralize your wealth.',
      'pos.title2': 'Understand its evolution.',
      'pos.title3': 'Discover what drives your financial future.',
      'pos.lead': 'Aurix transforms fragmented financial data into clarity, context and actionable understanding.',
      'pos.lead2': 'Because building wealth is not only about tracking assets. It is about understanding the decisions, trends and forces shaping your financial future.',

      'community.title': 'Join the Aurix Community',
      'community.text': 'Follow product development, receive updates and connect with early users building the future of wealth intelligence.',
      'community.tg.sub': 'Official Community',

      'cred.1': 'One platform.', 'cred.2': 'All your wealth.', 'cred.3': 'Complete visibility.',

      'meta.title': 'Aurix — The operating system for your wealth',
      'meta.desc': 'Track, understand and manage your entire wealth — stocks, funds, crypto, real estate, metals and cash — from one platform.'
    }
  };

  // ── SPEC 2 · LANDING DE CONVERSIÓN ── textos nuevos (audiencia, problema, beneficio, planes, FAQ).
  // Se aplican DESPUÉS del diccionario: varias claves (hero.*, cta.*) ya existían con el copy
  // anterior y en un literal de objeto ganaría la última aparición.
  Object.assign(I18N.es, {
      'nav.how': "Producto",
      'nav.plans': "Planes",
      'nav.faq': "Preguntas",
      'hero.h1a': "Todo tu patrimonio.",
      'hero.h1b': "Una visión más inteligente.",
      'hero.sub': "Reúne tus inversiones, entiende qué está cambiando y planifica tus próximos pasos. Acciones, ETFs, fondos, cripto y más, en un solo lugar.",
      'cta.start': "Crear cuenta gratis",
      'cta.see': "Explorar Aurix",
      'cta.premium': "Empezar y descubrir Premium",
      'hero.note': "Sin tarjeta para empezar.",
      'shot.tag': "Vista de Aurix · datos de ejemplo",
      'alt.dashboard': "Dashboard de Aurix con datos de ejemplo",
      'alt.positions': "Posiciones de una categoría en Aurix, con datos de ejemplo",
      'alt.intelligence': "Intelligence de Aurix con datos de ejemplo",
      'alt.workspace': "Presupuesto mensual de Aurix con datos de ejemplo",
      'bridge': "Tus inversiones están repartidas. Tu visión no tiene por qué estarlo.",
      'how.eyebrow': "Cómo funciona",
      'how.lead': "Tú registras tus posiciones: Aurix no se conecta a tu banco ni te pide credenciales bancarias.",
      'how.1.t': "Reúne todo tu patrimonio",
      'how.1.d': "Consulta cuánto tienes, cómo se distribuye y cómo evoluciona. Organiza acciones, ETFs, fondos, cripto, metales, inmuebles y liquidez en una sola visión.",
      'how.1.note': "Añade tus posiciones manualmente y mantén tu información al día.",
      'how.2.t': "Descubre qué merece tu atención",
      'how.2.d': "Intelligence pone tu patrimonio en contexto: dónde se concentra, qué ha cambiado y cómo evoluciona su estructura. Una lectura de tus datos para entender mejor tu cartera.",
      'how.3.t': "Convierte tus números en planes",
      'how.3.d': "Organiza tu presupuesto, controla cobros y pagos pendientes, explora préstamos y proyecta tus objetivos y el interés compuesto. Herramientas y plantillas para planificar con tus propios números.",
      'how.3.ex': "Plantillas como Presupuesto mensual, Control de cobros, Objetivos financieros o Portfolio inmobiliario; herramientas como Interés compuesto, Simulador de préstamos o Simulador de escenarios.",
      'plans.title': "Empieza gratis. Pasa a Premium cuando quieras más.",
      'free.price': "0 €",
      'free.per': "sin coste",
      'free.sub': "Sin tarjeta para empezar.",
      'free.intro': "Incluye:",
      'free.1': "Todas tus posiciones, sin límite de activos",
      'free.2': "Dashboard con total, reparto y evolución",
      'free.3': "Mercado: sigue índices y activos",
      'free.4': "Una primera lectura de Intelligence sobre tu cartera",
      'price.month': "7,99 €",
      'price.month.per': "al mes",
      'price.year.note': "O 69,99 € al año, cobrados anualmente: 5,83 € al mes, ahorras un 27 %.",
      'prem.intro': "Todo lo incluido en Free, más:",
      'prem.1': "Intelligence completa: concentración, estructura y cambios de tu patrimonio",
      'prem.2': "Todas las herramientas y plantillas de Workspace",
      'prem.3': "Guarda tus planes y retómalos en otro dispositivo",
      'price.terms': "Suscripción renovable. Cancela desde Gestionar mi plan.",
      'faq.title': "Preguntas frecuentes",
      'faq.1.q': "¿Qué puedo hacer gratis?",
      'faq.1.a': "Registrar todas tus posiciones, ver tu patrimonio, su reparto y evolución, seguir el mercado y recibir una primera lectura de Intelligence. Premium añade Intelligence completa, todas las herramientas y plantillas de Workspace y el guardado de tus planes.",
      'faq.2.q': "¿Aurix se conecta con mi banco o mi bróker?",
      'faq.2.a': "No. Registras tus posiciones a mano y Aurix actualiza los precios de los activos cotizados. No necesita tus credenciales bancarias y no puede mover tu dinero.",
      'faq.3.q': "¿Cómo se cobra Premium y cómo lo cancelo?",
      'faq.3.a': "Mensual (7,99 € al mes) o anual (69,99 €, en un único cobro al año). La suscripción se renueva automáticamente al final de cada periodo hasta que la canceles desde «Gestionar mi plan» en la app. El pago lo procesa Stripe; Aurix no guarda tu tarjeta.",
      'faq.4.q': "¿Aurix me dice qué comprar o vender?",
      'faq.4.a': "No. Aurix organiza y explica tu patrimonio; no ofrece asesoramiento financiero ni recomendaciones de inversión.",
      'faq.5.q': "¿Dónde puedo usarlo?",
      'faq.5.a': "En el navegador del ordenador o del móvil, y puedes añadirlo a la pantalla de inicio. Tus datos se guardan en tu cuenta.",
      'final.title': "Tu patrimonio, con más claridad.",
      'final.note': "Empieza con Free. Descubre Premium desde la aplicación.",
      'nav.product': 'Plataforma', 'nav.market': 'Mercado', 'nav.workspace': 'Inteligencia', 'nav.roadmap': 'Roadmap', 'nav.early': 'Acceso anticipado',
      'cta.enter': 'Comenzar', 'cta.request': 'Solicitar acceso', 'cta.joinLaunch': 'Únete antes del Launch 1',
      'launch.count': 'Lanzamiento en {h} h',
  });
  Object.assign(I18N.en, {
      'nav.how': "Product",
      'nav.plans': "Plans",
      'nav.faq': "FAQ",
      'hero.h1a': "All your wealth.",
      'hero.h1b': "A smarter view.",
      'hero.sub': "Bring your investments together, understand what is changing and plan your next steps. Stocks, ETFs, funds, crypto and more, in one place.",
      'cta.start': "Create a free account",
      'cta.see': "Explore Aurix",
      'cta.premium': "Start and discover Premium",
      'hero.note': "No card needed to start.",
      'shot.tag': "Aurix view · sample data",
      'alt.dashboard': "Aurix Dashboard with sample data",
      'alt.positions': "Positions in a category in Aurix, with sample data",
      'alt.intelligence': "Aurix Intelligence with sample data",
      'alt.workspace': "Aurix monthly budget with sample data",
      'bridge': "Your investments are spread out. Your view doesn’t have to be.",
      'how.eyebrow': "How it works",
      'how.lead': "You record your positions yourself: Aurix does not connect to your bank or ask for your banking credentials.",
      'how.1.t': "Bring all your wealth together",
      'how.1.d': "See how much you have, how it is distributed and how it evolves. Organise stocks, ETFs, funds, crypto, metals, real estate and cash in a single view.",
      'how.1.note': "Add your positions manually and keep your information up to date.",
      'how.2.t': "Find out what deserves your attention",
      'how.2.d': "Intelligence puts your wealth in context: where it is concentrated, what has changed and how its structure evolves. A reading of your data to better understand your portfolio.",
      'how.3.t': "Turn your numbers into plans",
      'how.3.d': "Organise your budget, keep track of pending collections and payments, explore loans and project your goals and compound interest. Tools and templates to plan with your own numbers.",
      'how.3.ex': "Templates such as Monthly budget, Payment control, Financial goals or Real estate portfolio; tools such as Compound interest, Loan simulator or Scenario builder.",
      'plans.title': "Start free. Go Premium when you want more.",
      'free.price': "€0",
      'free.per': "no cost",
      'free.sub': "No card needed to start.",
      'free.intro': "Includes:",
      'free.1': "All your positions, with no asset limit",
      'free.2': "Dashboard with total, split and evolution",
      'free.3': "Market: follow indices and assets",
      'free.4': "A first Intelligence reading of your portfolio",
      'price.month': "€7.99",
      'price.month.per': "per month",
      'price.year.note': "Or €69.99 a year, billed annually: €5.83 a month, you save 27%.",
      'prem.intro': "Everything in Free, plus:",
      'prem.1': "Full Intelligence: concentration, structure and changes in your wealth",
      'prem.2': "All Workspace tools and templates",
      'prem.3': "Save your plans and pick them up on another device",
      'price.terms': "Renewing subscription. Cancel from Manage my plan.",
      'faq.title': "Frequently asked questions",
      'faq.1.q': "What can I do for free?",
      'faq.1.a': "Record all your positions, see your wealth, its split and evolution, follow the market and get a first Intelligence reading. Premium adds full Intelligence, all Workspace tools and templates, and saving your plans.",
      'faq.2.q': "Does Aurix connect to my bank or broker?",
      'faq.2.a': "No. You record your positions by hand and Aurix updates the prices of listed assets. It does not need your banking credentials and cannot move your money.",
      'faq.3.q': "How is Premium charged and how do I cancel?",
      'faq.3.a': "Monthly (€7.99 a month) or annual (€69.99, in a single yearly charge). The subscription renews automatically at the end of each period until you cancel it from “Manage my plan” in the app. Payments are processed by Stripe; Aurix does not store your card.",
      'faq.4.q': "Does Aurix tell me what to buy or sell?",
      'faq.4.a': "No. Aurix organises and explains your wealth; it does not give financial advice or investment recommendations.",
      'faq.5.q': "Where can I use it?",
      'faq.5.a': "In the browser on your computer or phone, and you can add it to your home screen. Your data is kept in your account.",
      'final.title': "Your wealth, with more clarity.",
      'final.note': "Start with Free. Discover Premium from the app.",
      'nav.product': 'Platform', 'nav.market': 'Market', 'nav.workspace': 'Intelligence', 'nav.roadmap': 'Roadmap', 'nav.early': 'Early Access',
      'cta.enter': 'Get Started', 'cta.request': 'Request Access', 'cta.joinLaunch': 'Join before Launch 1',
      'launch.count': 'Launching in {h} h',
  });

  var LS_KEY = 'aurix_lang';
  // M.03 · B — ELECCIÓN EXPLÍCITA vs IDIOMA POR DEFECTO.
  //
  // `aurix_lang` se escribe en CADA `applyLang()`, también en la del arranque, así
  // que su presencia nunca distinguió "el usuario eligió ES/EN aquí" de "la landing
  // se pintó en su idioma por defecto". Sin esa distinción el CTA afirmaba
  // `?lang=en` para TODO EL MUNDO, y como el app-side trata `?lang=` como una
  // elección explícita que gana, un usuario que había elegido español DENTRO de
  // Aurix volvía a entrar por la landing y se encontraba la app en inglés.
  //
  // La clave de elección es NUEVA a propósito: los contenedores que ya tienen
  // `aurix_lang` escrito por la ruta por defecto no pueden quedar marcados
  // retroactivamente como una elección que nunca hicieron.
  var LS_CHOICE_KEY = 'aurix_lang_choice';
  var lang = 'en';
  var langExplicit = false;

  function detectLang() {
    // English by default. Spanish stays available via the ES/EN toggle and is
    // remembered once chosen — we no longer auto-switch from the browser locale.
    var choice;
    // Un enlace con `?lang=es|en` (p. ej. compartido desde una campaña) es una elección explícita.
    try { var q = new URLSearchParams(location.search).get('lang'); if (q === 'es' || q === 'en') { langExplicit = true; return q; } } catch (_) {}
    try { choice = localStorage.getItem(LS_CHOICE_KEY); } catch (_) {}
    if (choice === 'es' || choice === 'en') { langExplicit = true; return choice; }
    var stored;
    try { stored = localStorage.getItem(LS_KEY); } catch (_) {}
    if (stored === 'es' || stored === 'en') return stored;
    return 'en';
  }

  function applyLang(next, explicit) {
    lang = (next === 'en') ? 'en' : 'es';
    var dict = I18N[lang];
    document.documentElement.lang = lang;
    try { localStorage.setItem(LS_KEY, lang); } catch (_) {}
    if (explicit === true) {
      langExplicit = true;
      try { localStorage.setItem(LS_CHOICE_KEY, lang); } catch (_) {}
    }

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      if (dict[key] != null) nodes[i].textContent = dict[key];
    }
    // Capturas del producto en el idioma activo (mismos datos ficticios) y su texto alternativo.
    var imgs = document.querySelectorAll('img[data-i18n-src]');
    for (var m = 0; m < imgs.length; m++) {
      imgs[m].setAttribute('src', 'assets/' + imgs[m].getAttribute('data-i18n-src') + '-' + lang + '.jpg');
      var ak = imgs[m].getAttribute('data-i18n-alt'); if (ak && dict[ak] != null) imgs[m].setAttribute('alt', dict[ak]);
    }
    // Reflect active state on every language toggle (header + mobile)
    var btns = document.querySelectorAll('.lang-btn');
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.toggle('active', btns[j].getAttribute('data-lang') === lang);
    }
    // AURIX-LANDING-POLISH-1: multilingual SEO basics — localize the document
    // title, meta description and og:locale when the language changes. (No
    // separate /en route; single page, dynamic per selection.)
    if (dict['meta.title']) document.title = dict['meta.title'];
    var md = document.querySelector('meta[name="description"]');
    if (md && dict['meta.desc']) md.setAttribute('content', dict['meta.desc']);
    var ogl = document.querySelector('meta[property="og:locale"]');
    if (ogl) ogl.setAttribute('content', lang === 'en' ? 'en_US' : 'es_ES');

    // Keep the animated wealth figure in the active language (final value).
    var cv = document.getElementById('countValue');
    if (cv && !cv.dataset.counting) cv.textContent = fmtWealth(WEALTH_TARGET);

    // Keep "Enter Aurix" links carrying the active language across origins.
    updateAppLinks();
    // Y lo mismo con las legales: viven en el dominio de la app, así que sin
    // `?lang=` un lector en inglés abriría Privacidad en español.
    updateLegalLinks();
    // Re-render the launch countdown copy in the active language.
    if (typeof applyLaunchGate === 'function') applyLaunchGate();
  }

  // Fictional headline wealth figure (labelled "Product preview"). ES: 4,82 M€ · EN: $4.82M
  var WEALTH_TARGET = 4.82;
  function fmtWealth(n) {
    return lang === 'en' ? ('$' + n.toFixed(2) + 'M') : (n.toFixed(2).replace('.', ',') + ' M€');
  }

  function t(key) { return (I18N[lang] && I18N[lang][key]) || (I18N.es[key]) || ''; }

  /* ── Market preview (illustrative) ──────────────────── */
  // Datasets are clearly a product preview — no real-time data, brands or return
  // promises. `line` is an SVG path over a 640×200 viewBox; the area is closed to
  // the baseline. The symbol label mirrors the active (localized) tab.
  var MK_DATA = [
    { val:5432.18, dec:2, pre:'', delta:'+1.24%', up:true,
      line:'M0,150 C60,140 110,150 170,120 C230,92 280,108 340,78 C400,52 460,70 520,44 C580,24 610,34 640,26' },
    { val:318.40, dec:2, pre:'', delta:'+0.86%', up:true,
      line:'M0,140 C70,138 120,120 180,118 C250,116 300,96 360,92 C430,88 480,70 540,64 C590,60 620,52 640,50' },
    { val:67920, dec:0, pre:'$', delta:'+3.10%', up:true,
      line:'M0,162 C50,150 90,172 140,120 C190,72 240,140 300,96 C360,54 410,122 470,70 C520,30 590,52 640,28' },
    { val:2384.50, dec:2, pre:'$', delta:'−0.42%', up:false,
      line:'M0,70 C60,66 110,84 170,90 C230,96 280,86 340,104 C400,120 460,110 520,128 C580,144 610,138 640,150' },
    { val:17210, dec:0, pre:'', delta:'+0.92%', up:true,
      line:'M0,150 C70,146 120,130 180,126 C250,120 300,104 360,100 C430,94 480,72 540,66 C600,60 620,52 640,46' },
    { val:3480.75, dec:2, pre:'', delta:'+0.54%', up:true,
      line:'M0,138 C70,134 120,128 180,118 C250,108 300,108 360,96 C430,84 480,80 540,68 C600,58 620,58 640,52' }
  ];

  function initMarket() {
    var panel = document.getElementById('marketPanel');
    if (!panel) return;
    var symEl = document.getElementById('mkSymbol');
    var priceEl = document.getElementById('mkPrice');
    var deltaEl = document.getElementById('mkDelta');
    var lineEl = document.getElementById('mkLine');
    var areaEl = document.getElementById('mkArea');
    var tabs = panel.querySelectorAll('.mk-tab');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var current = -1, rafId = 0;

    // Locale-aware grouping/decimal separators (EN 1,234.5 · ES 1.234,5).
    function fmt(n, dec, pre) {
      var fixed = dec ? n.toFixed(dec) : String(Math.round(n));
      var parts = fixed.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : '.');
      return pre + (parts.length > 1 ? parts[0] + (lang === 'en' ? '.' : ',') + parts[1] : parts[0]);
    }
    function countTo(target, dec, pre) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (reduce) { priceEl.textContent = fmt(target, dec, pre); return; }
      var dur = 720, start = null;
      function step(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        priceEl.textContent = fmt(target * eased, dec, pre);
        if (p < 1) rafId = requestAnimationFrame(step);
        else { priceEl.textContent = fmt(target, dec, pre); rafId = 0; }
      }
      rafId = requestAnimationFrame(step);
    }
    function drawLine() {
      if (reduce || !lineEl.getTotalLength) return;
      var len = lineEl.getTotalLength();
      lineEl.style.transition = 'none';
      lineEl.style.strokeDasharray = len;
      lineEl.style.strokeDashoffset = len;
      void lineEl.getBoundingClientRect(); // reflow so the reset takes effect
      lineEl.style.transition = 'stroke-dashoffset 1.1s var(--ease)';
      lineEl.style.strokeDashoffset = '0';
    }
    function select(i, animate) {
      if (i === current) return;
      current = i;
      var d = MK_DATA[i];
      for (var k = 0; k < tabs.length; k++) {
        tabs[k].classList.toggle('is-active', k === i);
        tabs[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
      }
      symEl.textContent = tabs[i] ? tabs[i].textContent : '';
      deltaEl.textContent = d.delta;
      deltaEl.classList.toggle('up', d.up);
      deltaEl.classList.toggle('down', !d.up);
      lineEl.setAttribute('d', d.line);
      areaEl.setAttribute('d', d.line + ' L640,200 L0,200 Z');
      if (animate) { countTo(d.val, d.dec, d.pre); drawLine(); }
      else { priceEl.textContent = fmt(d.val, d.dec, d.pre); }
    }

    for (var k = 0; k < tabs.length; k++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          select(parseInt(btn.getAttribute('data-mk'), 10) || 0, true);
        });
      })(tabs[k]);
    }

    select(0, false); // static first paint
    if (reduce || !('IntersectionObserver' in window)) {
      countTo(MK_DATA[0].val, MK_DATA[0].dec, MK_DATA[0].pre);
    } else {
      var mio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          mio.unobserve(en.target);
          current = -1; select(0, true); // animate on first entry
        });
      }, { threshold: 0.4 });
      mio.observe(panel);
    }
  }

  // AURIX-LANDING-PREMIUM-PASS-1: single source of truth for the private-app
  // URL. Every "Enter Aurix" link ([data-app-link]) points here.
  // El subdominio canónico ya está vivo, así que el TODO queda resuelto: este
  // owner reescribe el `href` de CADA CTA en `updateAppLinks()`, de modo que
  // mientras apuntara al host antiguo ganaba siempre al href correcto que el
  // HTML ya traía. Debe coincidir con el `href` del markup (mismo destino con y
  // sin JS).
  var APP_URL = '../';   // DEMO: el registro y las legales se abren en la demo, nunca en producción

  // AURIX-WAITLIST-1: lead-capture endpoint (Vercel, same backend as the app API).
  var WAITLIST_ENDPOINT = 'https://isa-portfolio-ten.vercel.app/api/waitlist';

  // Cross-origin language handoff: localStorage is NOT shared between
  // aurixsystem.io and the app origin, so we pass the active language on every
  // "Enter Aurix" link; login.html / index.html read it into 'portfolio_lang'.
  //
  // M.03 · B — DOS PARÁMETROS, DOS AFIRMACIONES DISTINTAS:
  //   `lang=`     · el usuario ELIGIÓ este idioma en la landing → gana siempre.
  //   `langhint=` · es sólo el idioma con el que la landing se estaba mostrando →
  //                 se aplica únicamente si el contenedor de la app no tiene ya
  //                 una preferencia guardada.
  // Un único valor persistido en la app (`portfolio_lang`) sigue siendo la
  // autoridad; esto sólo evita que la landing afirme una elección inexistente.
  function appUrlForLang() {
    var v = (lang === 'en' ? 'en' : 'es');
    return APP_URL + '?' + (langExplicit ? 'lang=' : 'langhint=') + v;
  }
  function updateAppLinks() {
    var links = document.querySelectorAll('[data-app-link]');
    for (var i = 0; i < links.length; i++) links[i].setAttribute('href', appUrlForLang());
  }
  // Soporte y legales: páginas PÚBLICAS servidas por el dominio de la app. El
  // idioma viaja en `?lang=` (elección explícita, no una pista): quien está
  // leyendo la landing en inglés no debe aterrizar en un texto legal en español.
  var LEGAL_URLS = { privacy: 'privacy.html', terms: 'terms.html', support: 'support.html' };
  function updateLegalLinks() {
    var v = (lang === 'en' ? 'en' : 'es');
    var links = document.querySelectorAll('[data-legal-link]');
    for (var i = 0; i < links.length; i++) {
      var page = LEGAL_URLS[links[i].getAttribute('data-legal-link')];
      if (page) links[i].setAttribute('href', APP_URL + page + '?lang=' + v);
    }
  }

  /* ── Init ───────────────────────────────────────────── */
  // WSPHERE.V3 #4 — desktop-only reflective sweep on the Intelligence orb. A soft
  // highlight follows the cursor across the sphere (transform-moved, rAF-throttled)
  // and fades when the pointer leaves. No-op on touch / reduced-motion / narrow screens.
  function initOrbSheen() {
    var orb = document.getElementById('intelOrb');
    if (!orb) return;
    var mq = window.matchMedia;
    if (!mq || !mq('(min-width: 861px) and (pointer: fine)').matches) return;
    if (mq('(prefers-reduced-motion: reduce)').matches) return;
    var sheen = orb.querySelector('.io-sheen');
    if (!sheen) return;
    var raf = 0, x = 0, y = 0, bw = 0, bh = 0;
    function apply() {
      raf = 0;
      // Centre the 62%-sized blob under the cursor (translate in px = GPU-cheap).
      sheen.style.setProperty('--io-sx', (x - bw * 0.31) + 'px');
      sheen.style.setProperty('--io-sy', (y - bh * 0.31) + 'px');
      orb.classList.add('is-sheen');
    }
    orb.addEventListener('pointermove', function (e) {
      var b = sheen.getBoundingClientRect();
      if (!b.width) return;
      x = e.clientX - b.left; y = e.clientY - b.top; bw = b.width; bh = b.height;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    orb.addEventListener('pointerleave', function () { orb.classList.remove('is-sheen'); });
  }

  /* ── Public-launch CTA gate + hours countdown ─────────
     Locks every [data-launch-cta] until PUBLIC_LAUNCH_AT and shows only the
     remaining hours; enables them automatically at the timestamp (no reload,
     no new deploy). Recomputed on mount, language change, tab-visible, focus,
     pageshow (bfcache) and via a light timer aligned to the next hour boundary. */
  var _launchTimer = null;
  function applyLaunchGate() {
    var open = isPublicLaunchOpen();
    var ctas = document.querySelectorAll('[data-launch-cta]');
    for (var i = 0; i < ctas.length; i++) {
      var el = ctas[i];
      if (open) {
        el.classList.remove('is-launch-locked');
        el.removeAttribute('aria-disabled');
        el.removeAttribute('tabindex');
        if (el.dataset.launchHref) { el.setAttribute('href', el.dataset.launchHref); }
        if ('disabled' in el) { try { el.disabled = false; } catch (_) {} }
      } else {
        el.classList.add('is-launch-locked');
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('tabindex', '-1');
        if (el.tagName === 'A') {
          if (el.getAttribute('href') && el.getAttribute('href') !== '#') { el.dataset.launchHref = el.getAttribute('href'); }
          el.setAttribute('href', '#');
        }
        if ('disabled' in el) { try { el.disabled = true; } catch (_) {} }
      }
    }
    var cd = document.getElementById('launchCountdown');
    if (cd) {
      if (open) { cd.hidden = true; cd.textContent = ''; }
      else { cd.hidden = false; cd.textContent = t('launch.count').replace('{h}', String(publicLaunchRemainingHours())); }
    }
    if (_launchTimer) { clearTimeout(_launchTimer); _launchTimer = null; }
    if (!open) {
      var msToLaunch = PUBLIC_LAUNCH_AT_MS - Date.now();
      var msToHourTick = (msToLaunch % 3600000) || 3600000;     // when remainingHours next decrements
      var delay = Math.min(msToLaunch, msToHourTick) + 250;      // land just past the boundary
      if (delay > 0 && delay < 2147483647) { _launchTimer = setTimeout(applyLaunchGate, delay); }
    }
  }
  // Small, elegant launch-state toast (no modal / popup / alert) — shown when the
  // locked DESKTOP navbar CTA is tapped before launch. Mobile is unchanged (its
  // Hero CTA already shows the hours beneath it), so the toast is scoped to the
  // navbar CTA (.header-right). Reuses the launch.count i18n string.
  var _launchToastEl = null, _launchToastTimer = null;
  function showLaunchToast() {
    if (!_launchToastEl) {
      _launchToastEl = document.createElement('div');
      _launchToastEl.className = 'launch-toast';
      _launchToastEl.setAttribute('role', 'status');
      document.body.appendChild(_launchToastEl);
    }
    _launchToastEl.textContent = t('launch.count').replace('{h}', String(publicLaunchRemainingHours()));
    void _launchToastEl.offsetWidth;                 // reflow so the transition plays
    _launchToastEl.classList.add('is-visible');
    if (_launchToastTimer) clearTimeout(_launchToastTimer);
    _launchToastTimer = setTimeout(function () { if (_launchToastEl) _launchToastEl.classList.remove('is-visible'); }, 2600);
  }

  // Defence beyond the visual state: cancel any activation of a locked CTA.
  document.addEventListener('click', function (e) {
    var cta = (e.target && e.target.closest) ? e.target.closest('[data-launch-cta]') : null;
    if (cta && !isPublicLaunchOpen()) {
      e.preventDefault(); e.stopPropagation();
      if (cta.closest('.header-right')) showLaunchToast();   // desktop navbar CTA → elegant state
    }
  }, true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) applyLaunchGate(); });
  window.addEventListener('focus', applyLaunchGate);
  window.addEventListener('pageshow', applyLaunchGate);

  function init() {
    applyLang(detectLang());

    // Point every "Enter Aurix" CTA at the canonical app URL (with ?lang=).
    updateAppLinks();

    // Language toggle
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.lang-btn');
      if (b) { applyLang(b.getAttribute('data-lang'), true); }   // M.03 B — click = elección explícita
    });

    // Header scroll state (rAF-throttled)
    var header = document.getElementById('siteHeader');
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        header.classList.toggle('scrolled', window.scrollY > 12);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Mobile menu
    var menuToggle = document.getElementById('menuToggle');
    var mobileMenu = document.getElementById('mobileMenu');
    function closeMenu() {
      document.body.classList.remove('menu-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      mobileMenu.setAttribute('aria-hidden', 'true');
    }
    menuToggle.addEventListener('click', function () {
      var open = !document.body.classList.contains('menu-open');
      document.body.classList.toggle('menu-open', open);
      menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      mobileMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
    mobileMenu.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeMenu();
    });

    // Reveal on scroll
    var reveals = document.querySelectorAll('.reveal');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      for (var r = 0; r < reveals.length; r++) reveals[r].classList.add('is-visible');
    } else {
      // El estado oculto sólo existe si este código llega a ejecutarse: sin JS (o si falla antes),
      // el contenido se ve tal cual.
      document.documentElement.classList.add('reveal-ready');
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      for (var k = 0; k < reveals.length; k++) io.observe(reveals[k]);
    }

    // Total-value counter — subtle count-up to the fictional figure on reveal.
    var cv = document.getElementById('countValue');
    if (cv) {
      if (reduce || !('IntersectionObserver' in window)) {
        cv.textContent = fmtWealth(WEALTH_TARGET);
      } else {
        var cio = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            cio.unobserve(en.target);
            cv.dataset.counting = '1';
            var dur = 1100, start = null;
            function step(ts) {
              if (start === null) start = ts;
              var p = Math.min(1, (ts - start) / dur);
              var eased = 1 - Math.pow(1 - p, 3);
              cv.textContent = fmtWealth(WEALTH_TARGET * eased);
              if (p < 1) requestAnimationFrame(step);
              else { cv.textContent = fmtWealth(WEALTH_TARGET); delete cv.dataset.counting; }
            }
            requestAnimationFrame(step);
          });
        }, { threshold: 0.6 });
        cio.observe(cv);
      }
    }

    // HOTFIX LANDING — the "Request Access" modal + waitlist form were removed with the Private
    // Beta section (Aurix is now open to the public; the single CTA is "Enter Aurix"). No modal
    // open/close, no waitlist submit, no Escape/backdrop handlers tied to it remain.

    // ── Market preview: tabs + animated chart ──────────────
    // Illustrative product preview (labelled, no real-time data): six tabs over a
    // chart that draws on viewport entry, with figures that count up on switch.
    initMarket();

    // ── Intelligence orb: desktop cursor sheen (WSPHERE.V3 #4) ──
    initOrbSheen();

    // Footer year (no Date pinning needed for a static label)
    var y = document.getElementById('year');
    if (y) { try { y.textContent = String(new Date().getFullYear()); } catch (_) {} }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
