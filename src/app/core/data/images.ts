export interface ImageAsset {
  url: string;
  alt: string;
  credit?: string;
}

// TODO: reemplazar por fotografía propia de la marca cuando esté disponible.
// Stock libre de uso comercial (Unsplash / Pexels), verificado el 2026-08-14.
export const IMAGES = {
  hero: {
    url: 'https://images.unsplash.com/photo-1583844056361-4418a8f2a985?q=80&w=2400&h=1350&fit=crop&auto=format',
    alt: 'Vista panorámica de Positano en la Costa Amalfitana durante la hora azul, con el pueblo iluminado sobre el mar Tirreno',
    credit: 'Sebastian Leonhardt / Unsplash'
  },
  destinationAmalfi: {
    url: 'https://images.unsplash.com/photo-1568282167464-cb0d811b05c2?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Pueblo de la Costa Amalfitana construido sobre los acantilados frente al mar Mediterráneo',
    credit: 'Letizia Agosta / Unsplash'
  },
  destinationMaldives: {
    url: 'https://images.unsplash.com/photo-1470214203634-e436a8848e23?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Vista aérea de villas sobre el agua turquesa en un resort de Maldivas',
    credit: 'Ishan / Unsplash'
  },
  destinationKyoto: {
    url: 'https://images.unsplash.com/photo-1702564492961-3643703480c2?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Sendero entre los altos tallos verdes del bosque de bambú de Arashiyama, en Kyoto',
    credit: 'Marisca Kadharmestan / Unsplash'
  },
  destinationSerengeti: {
    url: 'https://images.unsplash.com/photo-1689479665299-0b31481ada35?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Jirafa en la sabana del Serengeti, Tanzania',
    credit: 'Crystal McClernon / Unsplash'
  },
  destinationPatagonia: {
    url: 'https://images.unsplash.com/photo-1681506511777-72980adfb815?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Lago rodeado de montañas en la Patagonia argentina, cerca de El Calafate',
    credit: 'Maria Samartino / Unsplash'
  },
  destinationDolomites: {
    url: 'https://images.unsplash.com/photo-1694630515448-344264b30507?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Cadena montañosa de los Dolomitas iluminada por la luz del atardecer',
    credit: 'Marek Piwnicki / Unsplash'
  },
  destinationIceland: {
    url: 'https://images.unsplash.com/photo-1476610182048-b716b8518aae?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Cascada de Seljalandsfoss en un paisaje idílico de Islandia',
    credit: 'Robert Lukeman / Unsplash'
  },
  destinationIstanbul: {
    url: 'https://images.unsplash.com/photo-1759347171702-e9cae049bc01?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Mezquita de Ortaköy junto al estrecho del Bósforo, en Istanbul',
    credit: 'Musa Ortaç / Unsplash'
  },
  experienceRomance: {
    url: 'https://images.pexels.com/photos/28408459/pexels-photo-28408459.jpeg?auto=compress&cs=tinysrgb&w=1400',
    alt: 'Mesa romántica para dos frente al mar al atardecer, decorada con velas y flores',
    credit: 'Asad Photo Maldives / Pexels'
  },
  experienceAdventure: {
    url: 'https://images.unsplash.com/photo-1675788555085-d244c05f1d10?q=80&w=1200&h=900&fit=crop&auto=format',
    alt: 'Excursionista con mochila contemplando un paisaje montañoso épico desde la cima',
    credit: 'Karl Paul Baldacchino / Unsplash'
  },
  experienceCulture: {
    url: 'https://images.unsplash.com/photo-1460722665083-c2599113f7e0?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Vista vertical del Coliseo de Roma mostrando su arquitectura clásica europea',
    credit: 'Melanie van Leeuwen / Unsplash'
  },
  experienceWellness: {
    url: 'https://images.unsplash.com/photo-1760564019062-7e7efdf4cc1d?q=80&w=1200&h=900&fit=crop&auto=format',
    alt: 'Personas relajándose en una piscina infinita frente al océano',
    credit: 'Meg von Haartman / Unsplash'
  },
  experienceCelebrate: {
    url: 'https://images.unsplash.com/photo-1647905555465-0f9004fbdaed?q=80&w=1200&h=900&fit=crop&auto=format',
    alt: 'Grupo de amigos brindando con copas de vino en un ambiente cálido y festivo',
    credit: 'Micaela Peduzi / Unsplash'
  },
  articleSlowTravel: {
    url: 'https://images.unsplash.com/photo-1760365942157-36df5ac3efd4?q=80&w=2400&h=1600&fit=crop&auto=format',
    alt: 'Paisaje de montañas verdes visto a través de la ventana de un tren en movimiento',
    credit: 'Soham Banerjee / Unsplash'
  },
  articleItaly: {
    url: 'https://images.unsplash.com/photo-1702742910382-76c82eca9b55?q=80&w=2400&h=1600&fit=crop&auto=format',
    alt: 'Vista aérea de un pueblo en la campiña de la Toscana, Italia',
    credit: 'Laura Chouette / Unsplash'
  },
  articleBaliHiddenGems: {
    url: 'https://images.unsplash.com/photo-1575573333701-d644e92a5160?q=80&w=2400&h=1600&fit=crop&auto=format',
    alt: 'Cascada escondida en la selva de Bali rodeada de vegetación tropical',
    credit: 'Khamkéo / Unsplash'
  },
  about: {
    url: '/images/The%20Travel%20Edit-16.jpg',
    alt: 'Retrato de la fundadora de The Travel Edit, sonriendo en un ambiente cálido y acogedor'
  },
  designYourTrip: {
    url: '/images/The%20Travel%20Edit-2.jpg',
    alt: 'Persona sosteniendo una tablet con el logo de The Travel Edit y una postal "Coming Soon" sobre un jardín de cactus'
  },
  finalCta: {
    url: 'https://images.unsplash.com/photo-1601445862636-aa4cae12f5c3?q=80&w=2400&h=1200&fit=crop&auto=format',
    alt: 'Vista de la Costa Amalfitana al amanecer en tonos suaves, apta como fondo oscurecido',
    credit: 'Dimitry B / Unsplash'
  }
} satisfies Record<string, ImageAsset>;
