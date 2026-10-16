import { Component, OnDestroy, OnInit, inject, input, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DomSanitizer, Meta, SafeHtml, Title } from '@angular/platform-browser';
import { PROPOSAL_SESSION_PREFIX, PublicProposalService } from '../../core/services/public-proposal';
import { sanitizeRichHtml } from '../../core/utils/sanitize-rich-html';

type Phase = 'loading' | 'ready' | 'unavailable';

/** Un punto del acordeón: el título (h1/h2 del texto) y todo lo que sigue hasta el próximo título. */
interface TermsSection {
  id: string;
  title: string;
  body: SafeHtml;
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
export class PrivateProposalTerms implements OnInit, OnDestroy {
  private readonly publicProposal = inject(PublicProposalService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  readonly token = input.required<string>();

  readonly phase = signal<Phase>('loading');
  readonly heading = signal('Términos y condiciones');
  /** Texto completo, solo cuando el contenido no tiene títulos para armar el acordeón. */
  readonly body = signal<SafeHtml | null>(null);
  /** Lo que va antes del primer título (la introducción), siempre visible. */
  readonly intro = signal<SafeHtml | null>(null);
  /** Un desplegable por título: al abrirlo el texto aparece ahí mismo. */
  readonly sections = signal<TermsSection[]>([]);

  constructor() {
    this.document.documentElement.classList.add('no-scrollbar');
    this.title.setTitle('Términos y condiciones | The Travel Edit');
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
  }

  ngOnDestroy(): void {
    this.document.documentElement.classList.remove('no-scrollbar');
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
      const clean = sanitizeRichHtml(rawBody);
      const parts = this.splitBySections(clean);
      // sanitizeRichHtml() ya limpió el HTML; Angular borraría los `style` del
      // contenido si lo volviera a sanitizar (mismo caso que en la propuesta).
      const trust = (html: string) => this.sanitizer.bypassSecurityTrustHtml(html);
      if (parts && parts.sections.length > 1) {
        this.intro.set(parts.intro ? trust(parts.intro) : null);
        this.sections.set(parts.sections.map((s) => ({ id: s.id, title: s.title, body: trust(s.body) })));
        this.body.set(null);
      } else {
        this.body.set(trust(clean));
      }
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

  /** Parte el texto en una introducción y una sección por cada h1/h2 (con todo
   *  lo que le sigue hasta el próximo título). null si no se puede analizar. */
  private splitBySections(html: string): { intro: string; sections: { id: string; title: string; body: string }[] } | null {
    if (typeof DOMParser === 'undefined') {
      return null;
    }
    const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild;
    if (!root) {
      return null;
    }
    let intro = '';
    const sections: { id: string; title: string; body: string }[] = [];
    for (const node of Array.from(root.childNodes)) {
      const isHeading = node instanceof Element && /^H[12]$/.test(node.tagName) && !!node.textContent?.trim();
      const markup = node instanceof Element ? node.outerHTML : (node.textContent ?? '');
      if (isHeading) {
        sections.push({ id: `terms-section-${sections.length + 1}`, title: node.textContent!.trim(), body: '' });
      } else if (sections.length > 0) {
        sections[sections.length - 1].body += markup;
      } else {
        intro += markup;
      }
    }
    return { intro, sections };
  }
}
