import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsService } from '../../../core/services/settings';
import { SiteStatus } from '../../../core/models/site-settings.model';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-general-settings',
  imports: [ReactiveFormsModule, ContentEditorLayout],
  templateUrl: './general-settings.html',
  styleUrl: './general-settings.css'
})
export class GeneralSettings {
  private readonly settings = inject(SettingsService);
  private readonly fb = inject(FormBuilder);

  readonly breadcrumb = [{ label: 'Panel', link: '/dashboard' }, { label: 'Configuración', link: '/configuracion' }, { label: 'General' }];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    site_name: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    company_name: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    public_site_url: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    timezone: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    language: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    site_status: this.fb.control<SiteStatus>('active', { nonNullable: true })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const settings = await this.settings.getSettings();
      this.form.patchValue(settings);
    } catch (err) {
      console.error('No se pudo cargar la configuración general.', err);
      this.error.set('No se pudo cargar la configuración.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.settings.updateSettings(this.form.getRawValue());
      this.savedAt.set(new Date());
    } catch (err) {
      console.error('No se pudo guardar la configuración general.', err);
      this.error.set('No se pudieron guardar los cambios.');
    } finally {
      this.saving.set(false);
    }
  }
}
