import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsService } from '../../../core/services/settings';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-contact-settings',
  imports: [ReactiveFormsModule, ContentEditorLayout],
  templateUrl: './contact-settings.html',
  styleUrl: './contact-settings.css'
})
export class ContactSettings {
  private readonly settings = inject(SettingsService);
  private readonly fb = inject(FormBuilder);

  readonly breadcrumb = [{ label: 'Panel', link: '/dashboard' }, { label: 'Configuración', link: '/configuracion' }, { label: 'Contacto' }];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    contact_email: this.fb.control('', { nonNullable: true, validators: [Validators.email] }),
    leads_admin_email: this.fb.control('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    contact_phone: this.fb.control('', { nonNullable: true }),
    contact_whatsapp: this.fb.control('', { nonNullable: true }),
    contact_address: this.fb.control('', { nonNullable: true }),
    contact_hours: this.fb.control('', { nonNullable: true })
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
      console.error('No se pudo cargar la configuración de contacto.', err);
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
      console.error('No se pudo guardar la configuración de contacto.', err);
      this.error.set('No se pudieron guardar los cambios.');
    } finally {
      this.saving.set(false);
    }
  }
}
