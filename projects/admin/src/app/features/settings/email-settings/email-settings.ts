import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsService } from '../../../core/services/settings';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';
import { StatusBadge } from '../../../shared/ui/status-badge/status-badge';

@Component({
  selector: 'app-email-settings',
  imports: [ReactiveFormsModule, ContentEditorLayout, StatusBadge],
  templateUrl: './email-settings.html',
  styleUrl: './email-settings.css'
})
export class EmailSettings {
  private readonly settings = inject(SettingsService);
  private readonly fb = inject(FormBuilder);

  readonly breadcrumb = [{ label: 'Panel', link: '/dashboard' }, { label: 'Configuración', link: '/configuracion' }, { label: 'Correos' }];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  readonly resendConfigured = signal<boolean | null>(null);
  readonly statusError = signal<string | null>(null);

  readonly form = this.fb.group({
    resend_from_email: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    leads_admin_email: this.fb.control('', { nonNullable: true, validators: [Validators.required, Validators.email] })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.statusError.set(null);
    try {
      const settings = await this.settings.getSettings();
      this.form.patchValue(settings);
    } catch (err) {
      console.error('No se pudo cargar la configuración de correos.', err);
      this.error.set('No se pudo cargar la configuración.');
    } finally {
      this.loading.set(false);
    }

    try {
      const status = await this.settings.getIntegrationStatus();
      this.resendConfigured.set(status.resendConfigured);
    } catch (err) {
      console.error('No se pudo consultar el estado de Resend.', err);
      this.statusError.set(err instanceof Error ? err.message : 'No pudimos consultar el estado de Resend.');
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
      console.error('No se pudo guardar la configuración de correos.', err);
      this.error.set('No se pudieron guardar los cambios.');
    } finally {
      this.saving.set(false);
    }
  }
}
