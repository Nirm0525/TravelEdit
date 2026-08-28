import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { IMAGES } from '../../core/data/images';
import { LeadSubmissionService } from '../../core/services/lead-submission';
import { COUNTRY_CODES, DEFAULT_COUNTRY_DIAL_CODE } from '../../core/data/country-codes';
import { DatePicker } from '../../shared/ui/date-picker/date-picker';
import {
  BUDGET_RANGE_OPTIONS,
  FLIGHT_CLASS_OPTIONS,
  HEAR_ABOUT_US_OPTIONS,
  HOTEL_STYLE_OPTIONS,
  LeadTripDetails,
  OCCASION_OPTIONS,
  PACE_OPTIONS,
  STYLE_PREFERENCE_OPTIONS,
  StylePreference,
  TRAVELING_WITH_OPTIONS
} from '../../core/models/lead-trip-details';

@Component({
  selector: 'app-design-your-trip',
  imports: [ReactiveFormsModule, RouterLink, DatePicker],
  templateUrl: './design-your-trip.html',
  styleUrl: './design-your-trip.css'
})
export class DesignYourTrip {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly leadSubmission = inject(LeadSubmissionService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  readonly heroImage = IMAGES.designYourTrip;
  readonly countryCodes = COUNTRY_CODES;

  readonly submitting = signal(false);
  readonly submitted = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly totalSteps = 3;
  readonly currentStep = signal(1);

  readonly travelingWithOptions = TRAVELING_WITH_OPTIONS;
  readonly occasionOptions = OCCASION_OPTIONS;
  readonly stylePreferenceOptions = STYLE_PREFERENCE_OPTIONS;
  readonly paceOptions = PACE_OPTIONS;
  readonly hotelStyleOptions = HOTEL_STYLE_OPTIONS;
  readonly budgetRangeOptions = BUDGET_RANGE_OPTIONS;
  readonly flightClassOptions = FLIGHT_CLASS_OPTIONS;
  readonly hearAboutUsOptions = HEAR_ABOUT_US_OPTIONS;

  readonly form = this.fb.group({
    name: this.fb.control('', Validators.required),
    email: this.fb.control('', [Validators.required, Validators.email]),
    phoneCountryCode: this.fb.control(DEFAULT_COUNTRY_DIAL_CODE),
    phone: this.fb.control('', Validators.required),
    location: this.fb.control(''),
    travelingWith: this.fb.control<(typeof TRAVELING_WITH_OPTIONS)[number] | null>(null),
    adults: this.fb.control<number | null>(null),
    children: this.fb.control<number | null>(null),
    childrenAges: this.fb.control(''),

    destinationInterestText: this.fb.control(''),
    destinationNotes: this.fb.control(''),
    departureDate: this.fb.control(''),
    returnDate: this.fb.control(''),
    nights: this.fb.control<number | null>(null),
    datesFlexible: this.fb.control(false),
    occasion: this.fb.control<(typeof OCCASION_OPTIONS)[number] | null>(null),

    stylePreferences: this.fb.control<StylePreference[]>([]),
    pace: this.fb.control<(typeof PACE_OPTIONS)[number]['value'] | null>(null),
    hotelStyle: this.fb.control<(typeof HOTEL_STYLE_OPTIONS)[number] | null>(null),

    budgetRange: this.fb.control<(typeof BUDGET_RANGE_OPTIONS)[number] | null>(null),
    flightClass: this.fb.control<(typeof FLIGHT_CLASS_OPTIONS)[number] | null>(null),
    likesAndDislikes: this.fb.control(''),

    unforgettableNote: this.fb.control(''),
    hearAboutUs: this.fb.control<(typeof HEAR_ABOUT_US_OPTIONS)[number] | null>(null)
  });

  constructor() {
    this.title.setTitle('Diseña tu viaje | Travel Edit');
    this.meta.updateTag({
      name: 'description',
      content: 'Cuéntanos qué tienes en mente y diseñaremos una experiencia de viaje pensada especialmente para ti.'
    });
  }

  onDepartureDateSelected(formatted: string): void {
    this.form.controls.departureDate.setValue(formatted);
  }

  onReturnDateSelected(formatted: string): void {
    this.form.controls.returnDate.setValue(formatted);
  }

  toggleStylePreference(option: StylePreference): void {
    const current = this.form.controls.stylePreferences.value;
    const next = current.includes(option) ? current.filter((v) => v !== option) : [...current, option];
    this.form.controls.stylePreferences.setValue(next);
  }

  nextStep(): void {
    if (this.currentStep() === 1 && !this.isStepOneValid()) {
      this.form.controls.name.markAsTouched();
      this.form.controls.email.markAsTouched();
      this.form.controls.phone.markAsTouched();
      this.errorMessage.set('Revisa los campos obligatorios antes de continuar.');
      return;
    }

    this.errorMessage.set(null);
    this.currentStep.update((step) => Math.min(step + 1, this.totalSteps));
    this.scrollToTop();
  }

  previousStep(): void {
    this.errorMessage.set(null);
    this.currentStep.update((step) => Math.max(step - 1, 1));
    this.scrollToTop();
  }

  private isStepOneValid(): boolean {
    const { name, email, phone } = this.form.controls;
    return name.valid && email.valid && phone.valid;
  }

  private scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async submit(): Promise<void> {
    // Único gate real de campos: form.invalid solo depende de name/email/phone,
    // los únicos controles con Validators — ningún campo opcional puede bloquear
    // esto. markAllAsTouched() hace que se vea exactamente cuál falta.
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set('Revisa los campos obligatorios antes de enviar.');
      return;
    }

    // Clic repetido mientras ya se está enviando: se ignora en silencio (el
    // botón ya está disabled/"Enviando…", esto es solo un cinturón extra).
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    try {
      const raw = this.form.getRawValue();
      const details: LeadTripDetails = {
        location: raw.location,
        travelingWith: raw.travelingWith,
        adults: raw.adults,
        children: raw.children,
        childrenAges: raw.childrenAges,
        destinationNotes: raw.destinationNotes,
        departureDate: raw.departureDate,
        returnDate: raw.returnDate,
        nights: raw.nights,
        datesFlexible: raw.datesFlexible,
        occasion: raw.occasion,
        stylePreferences: raw.stylePreferences,
        pace: raw.pace,
        hotelStyle: raw.hotelStyle,
        budgetRange: raw.budgetRange,
        flightClass: raw.flightClass,
        likesAndDislikes: raw.likesAndDislikes,
        unforgettableNote: raw.unforgettableNote,
        hearAboutUs: raw.hearAboutUs
      };

      const result = await this.leadSubmission.submit({
        name: raw.name,
        email: raw.email,
        phone: `${raw.phoneCountryCode} ${raw.phone}`.trim(),
        destinationInterestText: raw.destinationInterestText,
        details
      });

      if (!result.ok) {
        this.errorMessage.set(result.error);
        return;
      }

      this.submitted.set(true);
    } catch (error) {
      // Nunca debería llegar acá (LeadSubmissionService ya atrapa sus propios
      // errores), pero sin este catch una excepción inesperada dejaría
      // `submitting` en true para siempre y el botón bloqueado.
      console.error('DesignYourTrip.submit: error inesperado', error);
      this.errorMessage.set('No pudimos enviar tu solicitud. Inténtalo nuevamente.');
    } finally {
      this.submitting.set(false);
    }
  }
}
