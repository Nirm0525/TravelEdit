import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsService } from '../../../core/services/settings';
import { LeadsService, LeadStats } from '../../../core/services/leads';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-leads-settings',
  imports: [ReactiveFormsModule, ContentEditorLayout],
  templateUrl: './leads-settings.html',
  styleUrl: './leads-settings.css'
})
export class LeadsSettings {
  private readonly settings = inject(SettingsService);
  private readonly leadsService = inject(LeadsService);
  private readonly fb = inject(FormBuilder);

  readonly breadcrumb = [{ label: 'Panel', link: '/dashboard' }, { label: 'Configuración', link: '/configuracion' }, { label: 'Leads' }];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  readonly stats = signal<LeadStats | null>(null);
  readonly statsError = signal<string | null>(null);

  readonly form = this.fb.group({
    leads_admin_email: this.fb.control('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    email_notifications_enabled: this.fb.control(true, { nonNullable: true }),
    customer_confirmation_enabled: this.fb.control(true, { nonNullable: true }),
    leads_phone_required: this.fb.control(true, { nonNullable: true }),
    leads_allow_no_destination: this.fb.control(true, { nonNullable: true })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.statsError.set(null);
    try {
      const settings = await this.settings.getSettings();
      this.form.patchValue(settings);
    } catch (err) {
      console.error('No se pudo cargar la configuración de leads.', err);
      this.error.set('No se pudo cargar la configuración.');
    } finally {
      this.loading.set(false);
    }

    try {
      this.stats.set(await this.leadsService.getStats());
    } catch (err) {
      console.error('No se pudieron cargar las estadísticas de email.', err);
      this.statsError.set('No pudimos cargar las estadísticas de email.');
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
      console.error('No se pudo guardar la configuración de leads.', err);
      this.error.set('No se pudieron guardar los cambios.');
    } finally {
      this.saving.set(false);
    }
  }
}
