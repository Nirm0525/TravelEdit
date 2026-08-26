import { IMAGES } from './images';

export interface Article {
  slug: string;
  category: string;
  title: string;
  excerpt: string;
  author: string;
  image: string;
  alt: string;
  body: string;
}

const SLOW_TRAVEL_BODY = `<p>There's a particular kind of temptation that comes with travel: the need to fit everything in.</p>
<p>Three cities in seven days. A different hotel every night. The landmark, the museum, the restaurant everyone told you not to miss—and somehow, a vacation starts to feel remarkably similar to a schedule.</p>
<p>Slow travel offers a different proposition: go fewer places, but experience them more deeply.</p>
<p>It doesn't necessarily mean traveling for weeks or abandoning plans altogether. It can be as simple as choosing one region instead of an entire country, spending four nights where you might normally spend two, or leaving an afternoon deliberately unplanned.</p>
<p>Because often, the moments we remember most are the ones we never put on the itinerary.</p>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1445116572660-236099ec97a0?q=80&w=1200&h=800&fit=crop&auto=format" alt="Prensa francesa y taza de café sobre una mesa de madera en una mañana tranquila" loading="lazy" decoding="async" /></figure>
<h2>Stay long enough to have a routine</h2>
<p>There's something special that happens around day three.</p>
<p>You know where to get your coffee. You recognize the street back to your hotel. You've found the table you like at the little restaurant around the corner.</p>
<p>A destination begins to feel less like somewhere you're visiting and more like somewhere you briefly belong.</p>
<p>Instead of Rome, Florence and Venice in one week, imagine Rome followed by a few days in the Tuscan countryside. Instead of racing through several Greek islands, choose one and learn its rhythm.</p>
<p>The goal isn't to see less for the sake of it. It's to give yourself enough time to actually notice where you are.</p>
<blockquote><p>A destination begins to feel less like somewhere you're visiting and more like somewhere you briefly belong.</p></blockquote>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1558670460-cad0c19b1840?q=80&w=1200&h=800&fit=crop&auto=format" alt="Amigos compartiendo una larga sobremesa con copas de vino" loading="lazy" decoding="async" /></figure>
<h2>Leave room for nothing</h2>
<p>Some of the best travel days have surprisingly little on the agenda.</p>
<p>A long lunch that turns into an afternoon. A swim before dinner. Wandering into a shop you didn't know existed. Ordering another bottle of wine because nobody needs to be anywhere.</p>
<p>We believe in reservations—especially the good ones—but not in scheduling every hour.</p>
<p>A thoughtful itinerary should have structure and space.</p>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1768734836337-fa47d15984b3?q=80&w=1200&h=800&fit=crop&auto=format" alt="Frutas frescas exhibidas en un puesto de mercado local" loading="lazy" decoding="async" /></figure>
<h2>Choose experiences that connect you to the place</h2>
<p>Slow travel is less about collecting attractions and more about understanding a destination through the things that make it distinct.</p>
<p>Stay at a family-run masseria in Puglia. Visit a vineyard with the person who makes the wine. Spend a morning at a market with a local chef. Take the train through the countryside instead of flying over it.</p>
<p>The experience doesn't have to be elaborate to be memorable.</p>
<p>Sometimes luxury is simply having enough time.</p>
<blockquote><p>Sometimes luxury is simply having enough time.</p></blockquote>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1784176538660-49077789a78c?q=80&w=1200&h=800&fit=crop&auto=format" alt="Camino sinuoso a través de campos verdes y dorados" loading="lazy" decoding="async" /></figure>
<h2>Travel by region, not checklist</h2>
<p>One of our favorite ways to slow down is to think geographically smaller.</p>
<p>You don't need to "do Italy." You can do Sicily.</p>
<p>You don't need to see all of France. Spend a week between Provence and the Côte d'Azur.</p>
<p>You don't need five islands in Greece. Choose Paros and Antiparos and settle in.</p>
<p>When you stop measuring a trip by the number of places you visited, you start measuring it by something much more interesting: how much you actually experienced.</p>
<p>And that may be the real luxury of travel today.</p>
<p>Not more.<br>More meaningful.</p>`;

const ITALY_BEYOND_BODY = `<p>We'll always love Rome. We'll never say no to a few days in Florence. And there are few things more beautiful than arriving in Venice for the first time.</p>
<p>But Italy becomes particularly interesting when you stop treating it like a checklist.</p>
<p>Beyond the cities everyone knows is another Italy: small towns built into cliffs, islands where lunch lasts all afternoon, countryside hotels you don't really want to leave, and places that somehow still feel like a discovery.</p>
<p>These are a few we'd happily return to.</p>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1694974247491-ea3f789292ce?q=80&w=1200&h=800&fit=crop&auto=format" alt="Colina con un pueblo medieval en la campiña de la Toscana" loading="lazy" decoding="async" /></figure>
<h2>Val d'Orcia, Tuscany</h2>
<p><strong>For:</strong> countryside, wine and doing very little exceptionally well.</p>
<p>This is the Tuscany you've imagined: rolling hills, cypress-lined roads, medieval villages and vineyards stretching toward the horizon.</p>
<p>Base yourself somewhere beautiful outside Pienza or Montepulciano and resist the urge to move hotels every night.</p>
<p>Drive to tiny hill towns. Stop for pecorino in Pienza. Spend an afternoon tasting Brunello around Montalcino. Book a long lunch overlooking the countryside and make dinner plans only if you're hungry again.</p>
<p><strong>The Travel Edit way:</strong> three or four nights at a countryside hotel, preferably somewhere with a pool, a great restaurant and a view worth staying in for.</p>
<blockquote><p>This is the Tuscany you've imagined: rolling hills, cypress-lined roads, medieval villages and vineyards stretching toward the horizon.</p></blockquote>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1778059125257-7f5221918d7d?q=80&w=1200&h=800&fit=crop&auto=format" alt="Casas trulli blancas con flores rosadas en Alberobello, Puglia" loading="lazy" decoding="async" /></figure>
<h2>Puglia</h2>
<p><strong>For:</strong> masserias, beach clubs and long summer dinners.</p>
<p>Puglia feels different from the Italy of grand museums and famous monuments. The architecture is whiter, the landscapes are dotted with ancient olive trees, and life seems to happen outdoors.</p>
<p>We'd divide the time between the countryside and the coast.</p>
<p>Explore Ostuni, Locorotondo and Cisternino, stay in a restored masseria, then head toward the Adriatic for swimming and seafood. Polignano a Mare is beautiful, but some of the best moments happen away from the most photographed streets.</p>
<p><strong>The Travel Edit way:</strong> rent a car, stay at least four nights and make the masseria part of the experience—not simply somewhere to sleep.</p>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1773601113269-7b52039a4510?q=80&w=1200&h=800&fit=crop&auto=format" alt="Techos y edificios de un pueblo histórico en el sureste de Sicilia" loading="lazy" decoding="async" /></figure>
<h2>Noto &amp; Southeast Sicily</h2>
<p><strong>For:</strong> baroque towns, incredible food and a Sicily worth slowing down for.</p>
<p>Sicily deserves its own trip.</p>
<p>In the southeast, Noto makes an ideal starting point for exploring Modica, Ragusa Ibla, Marzamemi and Ortigia.</p>
<p>The days here can be wonderfully simple: granita in the morning, a baroque town before lunch, a swim in the afternoon and dinner outside after sunset.</p>
<p>And then there's the food—pistachios, citrus, seafood, tomatoes, chocolate from Modica and more pasta than you planned on eating.</p>
<p><strong>The Travel Edit way:</strong> combine a few nights around Noto with Ortigia or Taormina rather than trying to circle the entire island in one trip.</p>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1717166149666-fbe4cd47bbfc?q=80&w=1200&h=800&fit=crop&auto=format" alt="Vista del Lago Maggiore con montañas al fondo" loading="lazy" decoding="async" /></figure>
<h2>Lake Maggiore</h2>
<p><strong>For:</strong> Italian lake life with a little less noise.</p>
<p>Lake Como gets most of the attention, and deservedly so. But if you've already been—or simply want something different—look toward Lake Maggiore.</p>
<p>Grand hotels sit along the water, boats connect elegant lakeside towns, and the Borromean Islands make an easy day out.</p>
<p>There's a slower, old-world quality here that feels wonderfully Italian.</p>
<p><strong>The Travel Edit way:</strong> stay directly on the lake, take a private boat out for the day and give yourself at least one afternoon with absolutely nowhere to go.</p>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1678147407075-057c937baf3b?q=80&w=1200&h=800&fit=crop&auto=format" alt="Castillo Aragonés sobre un acantilado junto al mar en Ischia" loading="lazy" decoding="async" /></figure>
<h2>Ischia</h2>
<p><strong>For:</strong> the Italian island we'd choose when we want to actually relax.</p>
<p>Capri is iconic. Ischia is where we'd go when the objective is less seeing and more staying.</p>
<p>The volcanic island is known for thermal waters, beautiful coves, gardens and an easy Mediterranean rhythm. You can spend the morning on a boat, disappear into a thermal spa for the afternoon and still have time for aperitivo before dinner.</p>
<p>It's glamorous without trying quite so hard.</p>
<p><strong>The Travel Edit way:</strong> arrive after a few busy days in Naples or Rome and finish the trip here. Stay near the water and save one day for a boat around the island.</p>
<blockquote><p>Capri is iconic. Ischia is where we'd go when the objective is less seeing and more staying.</p></blockquote>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1683623210055-b76c134c21bd?q=80&w=1200&h=800&fit=crop&auto=format" alt="Pueblo a orillas del Lago Como con montañas al fondo" loading="lazy" decoding="async" /></figure>
<h2>The Italy we love most</h2>
<p>There isn't one "best" Italy.</p>
<p>Sometimes it's a terrace overlooking Lake Como. Sometimes it's an espresso standing at a bar in Rome. And sometimes it's a tiny Sicilian town you added to the itinerary almost as an afterthought.</p>
<p>That's precisely why we keep returning.</p>
<p>Italy rewards curiosity.</p>
<p>Go back. Take a different road. Stay a little longer.</p>
<p>There is always another Italy waiting.</p>`;

const WHERE_TO_GO_NEXT_BODY = `<p>Some destinations are classics for a reason. Others make you wonder why you haven't thought about going sooner.</p>
<p>For this edit, we wanted places that sit somewhere in between: not exactly undiscovered, but still capable of surprising you.</p>
<p>From Mediterranean beaches to a quieter side of Japan, these are five destinations we think are worth having on your radar.</p>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1564087558267-9e36fae557b7?q=80&w=1200&h=800&fit=crop&auto=format" alt="Costa rocosa y playa de aguas turquesas en Menorca, España" loading="lazy" decoding="async" /></figure>
<h2>01. Menorca, Spain</h2>
<p><em>The quieter side of the Balearics.</em></p>
<p>Menorca has everything you want from a Mediterranean summer: impossibly blue water, hidden coves, whitewashed towns and long lunches by the sea.</p>
<p>But compared with its Balearic neighbors, life here moves at a different pace.</p>
<p>Days are best spent driving between calas, stopping for lunch when somewhere looks good and returning to Ciutadella in time for an evening walk and dinner.</p>
<p>And while the beaches might be what first gets your attention, Menorca's countryside hotels, small towns and laid-back food scene are what make it somewhere we'd stay longer.</p>
<p><strong>Go for:</strong> turquoise water, beautiful beaches, seafood and a slower Mediterranean summer.</p>
<p><strong>The Travel Edit:</strong> Rent a car and stay at least four or five nights. Don't try to visit every cala—find a favorite and go back.</p>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1523365154888-8a758819b722?q=80&w=1200&h=800&fit=crop&auto=format" alt="Casa junto a un acantilado con vista al mar en la costa de Sicilia" loading="lazy" decoding="async" /></figure>
<h2>02. Sicily, Italy</h2>
<p><em>If you love Italy, this should be next.</em></p>
<p>There's Italy, and then there's Sicily.</p>
<p>The island has its own rhythm, flavors and landscapes—from the glamorous terraces of Taormina and vineyards surrounding Mount Etna to the baroque streets of Noto and waterfront evenings in Ortigia.</p>
<p>And then there's the food.</p>
<p>Granita for breakfast. Pasta alla Norma. Pistachios from Bronte. Seafood by the water. Chocolate from Modica. Sicily is one of those destinations where what you eat becomes as memorable as what you see.</p>
<p>The mistake is trying to experience the entire island at once.</p>
<p><strong>Go for:</strong> food, coastline, history, wine and a different side of Italy.</p>
<p><strong>The Travel Edit:</strong> For a first trip, combine Taormina with Southeast Sicily. Give yourself enough time to stop along the way—the detours are often the best part.</p>
<blockquote><p>There's Italy, and then there's Sicily.</p></blockquote>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1513622470522-26c3c8a854bc?q=80&w=1200&h=800&fit=crop&auto=format" alt="Botes amarrados frente a coloridos edificios en el canal de Nyhavn, Copenhague" loading="lazy" decoding="async" /></figure>
<h2>03. Copenhagen, Denmark</h2>
<p><em>The city break we keep recommending.</em></p>
<p>Some cities impress you with landmarks. Copenhagen wins you over with the details.</p>
<p>A bakery you suddenly want to visit every morning. Beautifully designed restaurants. Bikes everywhere. Independent shops you didn't plan on finding. A harbor full of people swimming on a summer afternoon.</p>
<p>The city feels stylish without feeling overly polished.</p>
<p>Food is a major reason to come, from destination restaurants to cardamom buns and neighborhood cafés, but Copenhagen is equally good when you have nothing planned at all.</p>
<p>Walk. Shop. Stop for coffee. Have another glass of wine.</p>
<p>Repeat.</p>
<p><strong>Go for:</strong> food, design, shopping and an easy European city escape.</p>
<p><strong>The Travel Edit:</strong> Three or four nights is ideal. Stay somewhere central, explore mostly on foot and book the restaurants you really want in advance.</p>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1597212618440-806262de4f6b?q=80&w=1200&h=800&fit=crop&auto=format" alt="Minarete de la mezquita Koutoubia con las montañas del Atlas nevadas al fondo, Marrakech" loading="lazy" decoding="async" /></figure>
<h2>04. Marrakech, Morocco</h2>
<p><em>For when Europe feels a little too familiar.</em></p>
<p>Marrakech feels like a change of scenery from the moment you arrive.</p>
<p>Terracotta walls, tiled courtyards, hidden gardens, spice-filled souks and some seriously beautiful hotels create a destination that feels both chaotic and incredibly glamorous.</p>
<p>Spend the morning exploring the Medina. Stop for mint tea. Shop for rugs, ceramics and pieces you definitely didn't plan on fitting into your suitcase. Then retreat to your hotel for a few hours before heading back out for dinner.</p>
<p>Marrakech is at its best when you embrace the contrast.</p>
<p>Old and new. Busy and peaceful. Elaborate and wonderfully simple.</p>
<p><strong>Go for:</strong> design, culture, shopping, food and exceptional hotels.</p>
<p><strong>The Travel Edit:</strong> Three or four nights is enough to experience the city without rushing. If you have extra time, add a night in the Agafay Desert for a completely different setting just outside Marrakech.</p>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1716290285309-540022da70d7?q=80&w=1200&h=800&fit=crop&auto=format" alt="Calle tradicional con edificios de madera en Kanazawa, Japón" loading="lazy" decoding="async" /></figure>
<h2>05. Kanazawa, Japan</h2>
<p><em>The Japan you might not have thought about—yet.</em></p>
<p>Tokyo has the energy. Kyoto has the temples. Kanazawa offers something quieter.</p>
<p>Once one of Japan's most important cultural centers, the city is known for beautifully preserved samurai and geisha districts, traditional gardens, contemporary art and an exceptional food scene—all without the same crowds you'll find in Japan's most visited cities.</p>
<p>Start the morning at Kenroku-en, wander through the old streets of Higashi Chaya, stop for lunch at Omicho Market and leave an afternoon for the 21st Century Museum of Contemporary Art.</p>
<p>But part of Kanazawa's appeal is simply its pace.</p>
<p>It gives you room to notice the details that make Japan so fascinating.</p>
<p><strong>Go for:</strong> Japanese culture, gardens, art, seafood and a slower side of Japan.</p>
<p><strong>The Travel Edit:</strong> Two or three nights is perfect. Kanazawa works beautifully between Tokyo and Kyoto, especially if you want to see a different side of Japan without venturing too far off the traditional route.</p>
<blockquote><p>Tokyo has the energy. Kyoto has the temples. Kanazawa offers something quieter.</p></blockquote>
<figure class="article-figure"><img src="https://images.unsplash.com/photo-1764251105292-7a495215a398?q=80&w=1200&h=800&fit=crop&auto=format" alt="Pantalla de información de vuelos en un aeropuerto" loading="lazy" decoding="async" /></figure>
<h2>Where next?</h2>
<p>The places worth traveling to next aren't necessarily the newest, most remote or hardest to reach.</p>
<p>Sometimes they're simply places we've been overlooking.</p>
<p>An island beyond Ibiza. An Italy beyond the usual route. A European city worth visiting for the food alone. A few days somewhere completely different. A Japanese city that hasn't made everyone's itinerary—yet.</p>
<p>That's the kind of travel we're interested in.</p>
<p>Familiar enough to draw you in. Different enough to surprise you.</p>`;

export const ARTICLES: Article[] = [
  {
    slug: 'the-art-of-slow-travel',
    category: 'THE EDIT',
    title: 'The Art of Slow Travel',
    excerpt: 'Why seeing less can mean experiencing more.',
    author: 'The Travel Edit',
    image: IMAGES.articleSlowTravel.url,
    alt: IMAGES.articleSlowTravel.alt,
    body: SLOW_TRAVEL_BODY
  },
  {
    slug: 'italy-beyond-the-obvious',
    category: 'PLACES',
    title: 'Italy, Beyond the Obvious',
    excerpt: "The places we'd return to—and how we'd experience them.",
    author: 'The Travel Edit',
    image: IMAGES.articleItaly.url,
    alt: IMAGES.articleItaly.alt,
    body: ITALY_BEYOND_BODY
  },
  {
    slug: 'where-to-go-next',
    category: 'JOURNAL',
    title: 'Where to Go Next',
    excerpt: 'Five destinations worth having on your radar.',
    author: 'The Travel Edit',
    image: IMAGES.articleBaliHiddenGems.url,
    alt: IMAGES.articleBaliHiddenGems.alt,
    body: WHERE_TO_GO_NEXT_BODY
  }
];
