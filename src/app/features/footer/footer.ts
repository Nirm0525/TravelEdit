import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NewsletterService } from '../../core/services/newsletter';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';
import { SiteContentService } from '../../core/services/site-content';

type SubmitState = 'idle' | 'loading' | 'ok' | 'invalid' | 'duplicate' | 'error';

interface FooterLink {
  label: string;
  href: string;
}

interface FooterSocialLink {
  platform: string;
  label: string;
  href: string;
}

interface FooterContent {
  exploreHeading: string;
  explore: FooterLink[];
  companyHeading: string;
  company: FooterLink[];
  followHeading: string;
  social: FooterSocialLink[];
  newsletterHeading: string;
  copyrightText: string;
}

const FOOTER_DEFAULT: FooterContent = {
  exploreHeading: 'Explore',
  explore: [
    { label: 'Destinations', href: '#destinos' },
    { label: 'Experiences', href: '#experiencias' },
    { label: 'The Edit', href: '#the-edit' }
  ],
  companyHeading: 'Company',
  company: [
    { label: 'About Us', href: '#about' },
    { label: 'Contact', href: 'mailto:nora.rivas@traveldiunsa.com' }
  ],
  followHeading: 'Follow',
  social: [{ platform: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/thetraveledithn/' }],
  newsletterHeading: 'Travel inspiration, thoughtfully edited.',
  copyrightText: '© The Travel Edit 2026'
};

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [AnimatedButton],
  templateUrl: './footer.html',
  styleUrl: './footer.css'
})
export class Footer {
  private readonly newsletter = inject(NewsletterService);
  private readonly siteContent = inject(SiteContentService);
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');

  readonly state = signal<SubmitState>('idle');
  readonly content = signal<FooterContent>(FOOTER_DEFAULT);

  readonly message: Record<SubmitState, string> = {
    idle: '',
    loading: '',
    ok: '¡Gracias! Ya estás suscrita/o.',
    invalid: 'Ingresa un email válido.',
    duplicate: 'Ese email ya está suscrito.',
    error: 'Algo salió mal. Intenta de nuevo.'
  };

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const data = await this.siteContent.getFooter();
    if (data) {
      this.content.update((current) => ({ ...current, ...data }));
    }
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const input = this.emailInput()?.nativeElement;
    if (!input) {
      return;
    }

    this.state.set('loading');
    const result = await this.newsletter.subscribe(input.value);
    this.state.set(result.status);

    if (result.status === 'ok') {
      input.value = '';
    }
  }
}
