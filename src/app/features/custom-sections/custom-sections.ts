import { Component, inject, signal } from '@angular/core';
import { CustomSection, SiteContentService } from '../../core/services/site-content';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';

@Component({
  selector: 'app-custom-sections',
  standalone: true,
  imports: [RevealOnScrollDirective],
  templateUrl: './custom-sections.html',
  styleUrl: './custom-sections.css'
})
export class CustomSections {
  private readonly siteContent = inject(SiteContentService);

  readonly sections = signal<CustomSection[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const data = await this.siteContent.getCustomSections();
    if (data?.sections) {
      this.sections.set(data.sections);
    }
  }
}
