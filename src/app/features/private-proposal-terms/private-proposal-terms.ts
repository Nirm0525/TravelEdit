import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, Meta, SafeHtml, Title } from '@angular/platform-browser';
import { PROPOSAL_SESSION_PREFIX, PublicProposalService } from '../../core/services/public-proposal';
import { sanitizeRichHtml } from '../../core/utils/sanitize-rich-html';

type Phase = 'loading' | 'ready' | 'unavailable';

interface TermsHeading {
  id: string;
  text: string;
}

/**
 * /private/:token/terminos — los términos y condiciones de la propuesta en su
 * propia página. Igual que la propuesta, nunca muestra contenido sin una
 * sesión válida: lee la misma sesión que PrivateProposal guardó en
 * sessionStorage al ingresar el código (misma pestaña, por eso el enlace de
 * la propuesta navega en la misma pestaña) y pide el contenido con
 * get_proposal_content(). Sin sesión, manda de vuelta a la propuesta.
 */
@Component({
  selector: 'app-private-proposal-terms',
  imports: [RouterLink],
  templateUrl: './private-proposal-terms.html',
  styleUrl: './private-proposal-terms.css'
})
export class PrivateProposalTerms implements OnInit {
  private readonly publicProposal = inject(PublicProposalService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  readonly token = input.required<string>();

  readonly phase = signal<Phase>('loading');
  readonly heading = signal('Términos y condiciones');
  readonly body = signal<SafeHtml | null>(null);
  /** Resumen con enlaces a cada título (h1/h2) del texto — solo si hay más de uno. */
  readonly summary = signal<TermsHeading[]>([]);

  constructor() {
    this.title.setTitle('Términos y condiciones | The Travel Edit');
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
  }

  // `token` (input required) todavía no tiene valor dentro del constructor.
  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const sessionToken = this.readSession();
    if (!sessionToken) {
      this.phase.set('unavailable');
      return;
    }
    try {
      const data = await this.publicProposal.getContent(this.token(), sessionToken);
      const rawBody = data.content.terms.body;
      if (!rawBody || !rawBody.replace(/<[^>]*>/g, '').trim()) {
        this.phase.set('unavailable');
        return;
      }
      this.heading.set(data.content.terms.title || 'Términos y condiciones');
      const { html, headings } = this.withAnchors(sanitizeRichHtml(rawBody));
      this.summary.set(headings.length > 1 ? headings : []);
      // sanitizeRichHtml() ya limpió el HTML; Angular borraría los `style` del
      // contenido si lo volviera a sanitizar (mismo caso que en la propuesta).
      this.body.set(this.sanitizer.bypassSecurityTrustHtml(html));
      this.phase.set('ready');
    } catch (error) {
      console.error('No se pudieron cargar los términos.', error);
      this.phase.set('unavailable');
    }
  }

  private readSession(): string | null {
    try {
      const raw = sessionStorage.getItem(`${PROPOSAL_SESSION_PREFIX}${this.token()}`);
      return raw ? ((JSON.parse(raw) as { sessionToken?: string }).sessionToken ?? null) : null;
    } catch {
      return null;
    }
  }

  /** Le pone un id a cada h1/h2 del texto para poder armar el resumen. */
  private withAnchors(html: string): { html: string; headings: TermsHeading[] } {
    if (typeof DOMParser === 'undefined') {
      return { html, headings: [] };
    }
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const headings: TermsHeading[] = [];
    doc.querySelectorAll('h1, h2').forEach((el, index) => {
      const text = el.textContent?.trim();
      if (!text) {
        return;
      }
      const id = `terms-section-${index + 1}`;
      el.id = id;
      headings.push({ id, text });
    });
    return { html: doc.body.firstElementChild?.innerHTML ?? html, headings };
  }

  goTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
