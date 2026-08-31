import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsService } from '../../../core/services/settings';
import { SiteContentImagesService } from '../../../core/services/site-content-images';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-appearance-settings',
  imports: [ReactiveFormsModule, ContentEditorLayout],
  templateUrl: './appearance-settings.html',
  styleUrl: './appearance-settings.css'
})
export class AppearanceSettings {
  private readonly settings = inject(SettingsService);
  private readonly images = inject(SiteContentImagesService);
  private readonly fb = inject(FormBuilder);

  readonly breadcrumb = [{ label: 'Panel', link: '/dashboard' }, { label: 'Configuración', link: '/configuracion' }, { label: 'Apariencia' }];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);
  readonly uploadingLogo = signal(false);
  readonly logoUploadError = signal<string | null>(null);

  readonly form = this.fb.group({
    site_name: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    appearance_logo_url: this.fb.control('', { nonNullable: true }),
    appearance_favicon_url: this.fb.control('', { nonNullable: true }),
    appearance_accent_color: this.fb.control('#7A2338', { nonNullable: true, validators: [Validators.pattern(/^#[0-9A-Fa-f]{6}$/)] })
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
      console.error('No se pudo cargar la configuración de apariencia.', err);
      this.error.set('No se pudo cargar la configuración.');
    } finally {
      this.loading.set(false);
    }
  }

  async onLogoFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    this.uploadingLogo.set(true);
    this.logoUploadError.set(null);
    try {
      const url = await this.images.uploadLogoImage(file);
      this.form.controls.appearance_logo_url.setValue(url);
      this.form.controls.appearance_logo_url.markAsDirty();
    } catch (err) {
      console.error('No se pudo subir el logo.', err);
      this.logoUploadError.set('No se pudo subir la imagen. Inténtalo nuevamente.');
    } finally {
      this.uploadingLogo.set(false);
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
      console.error('No se pudo guardar la configuración de apariencia.', err);
      this.error.set('No se pudieron guardar los cambios.');
    } finally {
      this.saving.set(false);
    }
  }
}
