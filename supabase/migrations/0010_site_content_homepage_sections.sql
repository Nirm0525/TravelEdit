-- Fase 3 del CMS: siembra una fila por cada sección nueva del home en la misma
-- tabla genérica site_content (section_key/content) que ya usa 'hero' — sin
-- tablas nuevas, sin cambios de RLS (site_content_select/insert/update de
-- 0005/0007 ya cubren cualquier section_key) y sin tocar el trigger de
-- auditoría (trg_log_site_content_update es genérico por tabla, no por fila).
--
-- El contenido de cada fila es una copia exacta de lo que hoy está hardcodeado
-- en el sitio público (src/app/core/data/*.ts y cada componente de sección),
-- para que los editores del admin abran mostrando lo mismo que ve un visitante
-- — mismo criterio que la fila 'hero' original. `destinos_destacados` arranca
-- con `destinationIds` vacío a propósito: hasta que un admin guarde una
-- selección real, el sitio público sigue usando su fallback hardcodeado.
-- Se usa dollar-quoting ($$...$$) para no tener que escapear los apóstrofes
-- del contenido en inglés/español.

insert into site_content (section_key, content)
values (
  'destinos_destacados',
  $$
  {
    "eyebrow": "Destinations",
    "headingLine1": "Where will",
    "headingLine2": "your story",
    "headingLine3": "begin?",
    "support": "Places worth discovering.\nStories worth living.",
    "destinationIds": []
  }
  $$::jsonb
)
on conflict (section_key) do nothing;

insert into site_content (section_key, content)
values (
  'travel_process',
  $$
  {
    "titleLine1": "Not a trip.",
    "titleLine2": "Your edit.",
    "steps": [
      {
        "number": "01",
        "title": "We get to know you",
        "text": "Tell us how you love to travel. Your style, pace, interests and what matters most to you.",
        "icon": "person"
      },
      {
        "number": "02",
        "title": "We create your Travel Edit",
        "text": "First, we design the journey. Then we curate the stays, experiences and details that bring it to life.",
        "icon": "curate"
      },
      {
        "number": "03",
        "title": "You experience it",
        "text": "Everything thoughtfully arranged. You simply travel, experience and enjoy.",
        "icon": "plane"
      }
    ]
  }
  $$::jsonb
)
on conflict (section_key) do nothing;

insert into site_content (section_key, content)
values (
  'experiencias',
  $$
  {
    "eyebrow": "Experiences",
    "headingLine1": "How do you",
    "headingLine2": "want to feel?",
    "support": "Every journey starts with how you want to experience it.",
    "items": [
      {
        "slug": "romance",
        "name": "Romance",
        "icon": "heart",
        "image": "https://images.pexels.com/photos/28408459/pexels-photo-28408459.jpeg?auto=compress&cs=tinysrgb&w=1400",
        "alt": "Mesa romántica para dos frente al mar al atardecer, decorada con velas y flores"
      },
      {
        "slug": "adventure",
        "name": "Adventure",
        "icon": "compass",
        "image": "https://images.unsplash.com/photo-1675788555085-d244c05f1d10?q=80&w=1200&h=900&fit=crop&auto=format",
        "alt": "Excursionista con mochila contemplando un paisaje montañoso épico desde la cima"
      },
      {
        "slug": "culture",
        "name": "Culture",
        "icon": "column",
        "image": "https://images.unsplash.com/photo-1460722665083-c2599113f7e0?q=80&w=900&h=1200&fit=crop&auto=format",
        "alt": "Vista vertical del Coliseo de Roma mostrando su arquitectura clásica europea"
      },
      {
        "slug": "wellness",
        "name": "Wellness",
        "icon": "lotus",
        "image": "https://images.unsplash.com/photo-1760564019062-7e7efdf4cc1d?q=80&w=1200&h=900&fit=crop&auto=format",
        "alt": "Personas relajándose en una piscina infinita frente al océano"
      },
      {
        "slug": "celebrate",
        "name": "Celebrate",
        "icon": "sparkle",
        "image": "https://images.unsplash.com/photo-1647905555465-0f9004fbdaed?q=80&w=1200&h=900&fit=crop&auto=format",
        "alt": "Grupo de amigos brindando con copas de vino en un ambiente cálido y festivo"
      }
    ]
  }
  $$::jsonb
)
on conflict (section_key) do nothing;

insert into site_content (section_key, content)
values (
  'the_edit',
  $$
  {
    "eyebrow": "The Edit",
    "headingLine1": "Stories worth",
    "headingLine2": "collecting.",
    "supportLine1": "Inspiration. Curated.",
    "supportLine2": "For the curious soul.",
    "ctaLabel": "EXPLORE THE EDIT",
    "ctaHref": "#the-edit",
    "articles": [
      {
        "category": "THE EDIT",
        "title": "The Art of Slow Travel",
        "excerpt": "Why seeing less can mean experiencing more.",
        "image": "https://images.unsplash.com/photo-1760365942157-36df5ac3efd4?q=80&w=1200&h=800&fit=crop&auto=format",
        "alt": "Paisaje de montañas verdes visto a través de la ventana de un tren en movimiento"
      },
      {
        "category": "PLACES",
        "title": "Italy, Beyond the Obvious",
        "excerpt": "The places we'd return to—and how we'd experience them.",
        "image": "https://images.unsplash.com/photo-1702742910382-76c82eca9b55?q=80&w=1200&h=800&fit=crop&auto=format",
        "alt": "Vista aérea de un pueblo en la campiña de la Toscana, Italia"
      },
      {
        "category": "JOURNAL",
        "title": "Where to Go Next",
        "excerpt": "Five destinations worth having on your radar.",
        "image": "https://images.unsplash.com/photo-1575573333701-d644e92a5160?q=80&w=1200&h=800&fit=crop&auto=format",
        "alt": "Cascada escondida en la selva de Bali rodeada de vegetación tropical"
      }
    ]
  }
  $$::jsonb
)
on conflict (section_key) do nothing;

insert into site_content (section_key, content)
values (
  'about',
  $$
  {
    "eyebrow": "Our Story",
    "titleLine1": "Travel should",
    "titleLine2": "feel personal.",
    "paragraph1": "The Travel Edit nació de una forma diferente de entender los viajes: creemos que el lujo no está en hacer más, sino en elegir mejor.",
    "paragraph2": "En conocer lugares extraordinarios, vivir experiencias auténticas y tener el tiempo para realmente disfrutarlas.",
    "paragraph3": "Por eso, cada viaje comienza contigo. Con lo que te inspira, lo que disfrutas y la forma en que quieres descubrir el mundo.",
    "words": ["Intentional.", "Personal.", "Curated.", "Meaningful."],
    "imageUrl": "/images/The%20Travel%20Edit-16.jpg",
    "imageAlt": "Retrato de la fundadora de The Travel Edit, sonriendo en un ambiente cálido y acogedor"
  }
  $$::jsonb
)
on conflict (section_key) do nothing;

insert into site_content (section_key, content)
values (
  'cta_final',
  $$
  {
    "eyebrow": "Your Next Story Starts Here",
    "titleLine1": "Where",
    "titleLine2": "to next?",
    "text": "Let's create something unforgettable.",
    "ctaLabel": "START YOUR JOURNEY",
    "imageUrl": "https://images.unsplash.com/photo-1601445862636-aa4cae12f5c3?q=80&w=2400&h=1200&fit=crop&auto=format",
    "imageAlt": "Vista de la Costa Amalfitana al amanecer en tonos suaves, apta como fondo oscurecido",
    "links": [
      { "label": "Instagram", "href": "#" },
      { "label": "WhatsApp", "href": "https://wa.me/50433070330" },
      { "label": "Email", "href": "mailto:marcela@travelinternational.org" }
    ]
  }
  $$::jsonb
)
on conflict (section_key) do nothing;

insert into site_content (section_key, content)
values (
  'footer',
  $$
  {
    "exploreHeading": "Explore",
    "explore": [
      { "label": "Destinations", "href": "#destinos" },
      { "label": "Experiences", "href": "#experiencias" },
      { "label": "The Edit", "href": "#the-edit" }
    ],
    "companyHeading": "Company",
    "company": [
      { "label": "About Us", "href": "#about" },
      { "label": "Contact", "href": "mailto:nora.rivas@traveldiunsa.com" }
    ],
    "followHeading": "Follow",
    "social": [
      { "platform": "instagram", "label": "Instagram", "href": "https://www.instagram.com/thetraveledithn/" }
    ],
    "newsletterHeading": "Travel inspiration, thoughtfully edited.",
    "copyrightText": "© The Travel Edit 2026"
  }
  $$::jsonb
)
on conflict (section_key) do nothing;
