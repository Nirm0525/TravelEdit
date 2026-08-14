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
  destinationParis: {
    url: 'https://images.unsplash.com/photo-1637851059418-25af92e003bf?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Vista elevada de la Torre Eiffel y los tejados de París al atardecer',
    credit: 'Bastien Nvs / Unsplash'
  },
  destinationSantorini: {
    url: 'https://images.unsplash.com/photo-1536253253742-6c8195fd0c1e?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Cúpulas azules tradicionales de Santorini con vista al mar Egeo al atardecer',
    credit: 'Héctor J. Rivas / Unsplash'
  },
  destinationBali: {
    url: 'https://images.unsplash.com/photo-1557093793-d149a38a1be8?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Terrazas de arroz de Tegalalang en Bali bañadas por luz dorada',
    credit: 'Radoslav Bali / Unsplash'
  },
  destinationMaldives: {
    url: 'https://images.unsplash.com/photo-1470214203634-e436a8848e23?q=80&w=900&h=1200&fit=crop&auto=format',
    alt: 'Vista aérea de villas sobre el agua turquesa en un resort de Maldivas',
    credit: 'Ishan / Unsplash'
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
    url: 'https://images.unsplash.com/photo-1760365942157-36df5ac3efd4?q=80&w=1200&h=800&fit=crop&auto=format',
    alt: 'Paisaje de montañas verdes visto a través de la ventana de un tren en movimiento',
    credit: 'Soham Banerjee / Unsplash'
  },
  articleParisWeekend: {
    url: 'https://images.unsplash.com/photo-1632606469465-d148fd8e148d?q=80&w=1200&h=800&fit=crop&auto=format',
    alt: 'Vista desde un balcón parisino hacia los edificios de estilo Haussmanniano',
    credit: 'Fiona Murray-deGraaff / Unsplash'
  },
  articleBaliHiddenGems: {
    url: 'https://images.unsplash.com/photo-1575573333701-d644e92a5160?q=80&w=1200&h=800&fit=crop&auto=format',
    alt: 'Cascada escondida en la selva de Bali rodeada de vegetación tropical',
    credit: 'Khamkéo / Unsplash'
  },
  about: {
    url: 'https://images.unsplash.com/photo-1755920214570-df0f27f574fb?q=80&w=1000&h=1250&fit=crop&auto=format',
    alt: 'Silueta de una persona contemplando el paisaje desde un balcón, en actitud reflexiva de viaje',
    credit: 'Adrian Kusznirewicz / Unsplash'
  },
  finalCta: {
    url: 'https://images.unsplash.com/photo-1601445862636-aa4cae12f5c3?q=80&w=2400&h=1200&fit=crop&auto=format',
    alt: 'Vista de la Costa Amalfitana al amanecer en tonos suaves, apta como fondo oscurecido',
    credit: 'Dimitry B / Unsplash'
  }
} satisfies Record<string, ImageAsset>;
