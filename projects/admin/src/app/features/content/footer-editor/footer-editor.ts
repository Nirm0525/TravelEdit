import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { SiteContentService } from '../../../core/services/site-content';
import { FooterLink, FooterSocialLink } from '../../../core/models/site-content.model';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-footer-editor',
  imports: [ReactiveFormsModule, DragDropModule, ContentEditorLayout],
  templateUrl: './footer-editor.html',
  styleUrl: './footer-editor.css'
})
export class FooterEditor {
  private readonly siteContent = inject(SiteContentService);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  readonly explore = signal<FooterLink[]>([]);
  readonly company = signal<FooterLink[]>([]);
  readonly social = signal<FooterSocialLink[]>([]);

  readonly form = this.fb.group({
    exploreHeading: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    companyHeading: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    followHeading: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    newsletterHeading: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    copyrightText: this.fb.control('', { nonNullable: true, validators: [Validators.required] })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const content = await this.siteContent.getFooter();
    this.form.patchValue(content);
    this.explore.set(content.explore);
    this.company.set(content.company);
    this.social.set(content.social);
    this.loading.set(false);
  }

  updateLink(list: 'explore' | 'company', index: number, patch: Partial<FooterLink>): void {
    const target = list === 'explore' ? this.explore : this.company;
    target.update((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  addLink(list: 'explore' | 'company'): void {
    const target = list === 'explore' ? this.explore : this.company;
    target.update((items) => [...items, { label: '', href: '' }]);
  }

  removeLink(list: 'explore' | 'company', index: number): void {
    const target = list === 'explore' ? this.explore : this.company;
    target.update((items) => items.filter((_, i) => i !== index));
  }

  dropExplore(event: CdkDragDrop<FooterLink[]>): void {
    const reordered = [...this.explore()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.explore.set(reordered);
  }

  dropCompany(event: CdkDragDrop<FooterLink[]>): void {
    const reordered = [...this.company()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.company.set(reordered);
  }

  updateSocial(index: number, patch: Partial<FooterSocialLink>): void {
    this.social.update((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  addSocial(): void {
    this.social.update((items) => [...items, { platform: '', label: '', href: '' }]);
  }

  removeSocial(index: number): void {
    this.social.update((items) => items.filter((_, i) => i !== index));
  }

  dropSocial(event: CdkDragDrop<FooterSocialLink[]>): void {
    const reordered = [...this.social()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.social.set(reordered);
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.siteContent.updateFooter({
        ...this.form.getRawValue(),
        explore: this.explore(),
        company: this.company(),
        social: this.social()
      });
      this.savedAt.set(new Date());
    } catch {
      this.error.set('No se pudieron guardar los cambios. Intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }
}
