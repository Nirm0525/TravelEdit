import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DestinationsService } from '../../../core/services/destinations';
import { Season, TripType } from '../../../core/models/destination-enums';
import { SEASON_OPTIONS, TRIP_TYPE_OPTIONS } from '../../../core/data/destination-options';
import { AdminPageHeader } from '../../../shared/ui/admin-page-header/admin-page-header';
import { slugify } from '../../../core/utils/slugify';

interface PostgrestError {
  code?: string;
  message?: string;
}

@Component({
  selector: 'app-destination-create',
  imports: [ReactiveFormsModule, RouterLink, AdminPageHeader],
  templateUrl: './destination-create.html',
  styleUrl: './destination-create.css'
})
export class DestinationCreate {
  private readonly destinationsService = inject(DestinationsService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly tripTypeOptions = TRIP_TYPE_OPTIONS;
  readonly seasonOptions = SEASON_OPTIONS;
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  private slugTouched = false;

  readonly form = this.fb.group({
    title: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    slug: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)]
    }),
    countryRegion: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    tripType: this.fb.control<TripType | null>(null, { validators: [Validators.required] }),
    durationDays: this.fb.control(1, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
    season: this.fb.control<Season | null>(null),
    priceRangeMin: this.fb.control<number | null>(null),
    priceRangeMax: this.fb.control<number | null>(null),
    shortDescription: this.fb.control('', { nonNullable: true, validators: [Validators.maxLength(200)] })
  });

  constructor() {
    this.form.controls.slug.valueChanges.subscribe(() => {
      this.slugTouched = true;
    });
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
      if (!this.form.controls.tripType.value) {
        this.error.set('Selecciona un tipo de viaje.');
      } else if (!this.form.controls.title.value) {
        this.error.set('El título es obligatorio.');
      }
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      const raw = this.form.getRawValue();
      const destination = await this.destinationsService.create({
        title: raw.title,
        slug: raw.slug,
        countryRegion: raw.countryRegion,
        tripType: raw.tripType!,
        durationDays: raw.durationDays,
        season: raw.season,
        priceRangeMin: raw.priceRangeMin,
        priceRangeMax: raw.priceRangeMax,
        shortDescription: raw.shortDescription
      });
      await this.router.navigate(['/destinos', destination.id, 'general']);
    } catch (err) {
      const pgError = err as PostgrestError;
      if (pgError?.code === '23505') {
        this.error.set('El slug ya existe. Elige uno distinto.');
      } else {
        this.error.set('No se pudo crear el destino. Intenta de nuevo.');
      }
    } finally {
      this.saving.set(false);
    }
  }
}
