import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DestinationsService } from '../../../../core/services/destinations';
import { RichContentService } from '../../../../core/services/rich-content';
import { TripType, Season } from '../../../../core/models/destination-enums';
import { TRIP_TYPE_OPTIONS, SEASON_OPTIONS } from '../../../../core/data/destination-options';
import { RichTextEditor } from '../../../../shared/ui/rich-text-editor/rich-text-editor';
import { slugify } from '../../../../core/utils/slugify';
import { HasUnsavedChanges } from '../../../../core/guards/unsaved-changes-guard';

@Component({
  selector: 'app-destination-general',
  imports: [ReactiveFormsModule, RichTextEditor],
  templateUrl: './general.html',
  styleUrl: './general.css'
})
export class General implements HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly destinationsService = inject(DestinationsService);
  private readonly richContent = inject(RichContentService);
  private readonly fb = inject(FormBuilder);

  readonly tripTypeOptions = TRIP_TYPE_OPTIONS;
  readonly seasonOptions = SEASON_OPTIONS;
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly saveError = signal<string | null>(null);
  private slugTouched = false;
  private readonly destinationId = this.route.parent!.snapshot.paramMap.get('id')!;
  private loadedValues: ReturnType<General['form']['getRawValue']> | null = null;

  readonly form = this.fb.group({
    title: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    slug: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)]
    }),
    countryRegion: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    tripType: this.fb.control<TripType>('otro', { nonNullable: true, validators: [Validators.required] }),
    durationDays: this.fb.control(1, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
    season: this.fb.control<Season | null>(null),
    priceRangeMin: this.fb.control<number | null>(null),
    priceRangeMax: this.fb.control<number | null>(null),
    shortDescription: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)]
    }),
    longDescription: this.fb.control('', { nonNullable: true })
  });

  constructor() {
    void this.load();

    this.form.controls.slug.valueChanges.subscribe(() => {
      this.slugTouched = true;
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const destination = await this.destinationsService.getById(this.destinationId);
      if (!destination) {
        this.loadError.set('No se encontró el destino.');
        return;
      }
      this.form.patchValue({
        title: destination.title,
        slug: destination.slug,
        countryRegion: destination.countryRegion,
        tripType: destination.tripType,
        durationDays: destination.durationDays,
        season: destination.season,
        priceRangeMin: destination.priceRangeMin,
        priceRangeMax: destination.priceRangeMax,
        shortDescription: destination.shortDescription,
        longDescription: destination.longDescription
      });
      this.slugTouched = true;
      this.loadedValues = this.form.getRawValue();
      this.form.markAsPristine();
    } catch (error) {
      console.error('No se pudo cargar el destino.', error);
      this.loadError.set('No se pudo cargar el destino. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty;
  }

  cancel(): void {
    if (this.loadedValues) {
      this.form.reset(this.loadedValues);
      this.form.markAsPristine();
    }
  }

  onTitleInput(): void {
    if (this.slugTouched) {
      return;
    }
    this.form.controls.slug.setValue(slugify(this.form.controls.title.value), { emitEvent: false });
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    try {
      const { longDescription, ...rest } = this.form.getRawValue();

      const available = await this.destinationsService.isSlugAvailable(rest.slug, this.destinationId);
      if (!available) {
        this.saveError.set('Ese slug ya está en uso por otro destino.');
        return;
      }

      await this.destinationsService.update(this.destinationId, rest);
      await this.richContent.save('destinations', this.destinationId, longDescription);
      this.savedAt.set(new Date());
      this.loadedValues = this.form.getRawValue();
      this.form.markAsPristine();
    } catch (error) {
      console.error('No se pudo guardar el destino.', error);
      this.saveError.set('No se pudo guardar el destino. Inténtalo nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }
}
