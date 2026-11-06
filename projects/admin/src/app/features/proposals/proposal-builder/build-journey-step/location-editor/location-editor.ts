import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { merge } from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MAX_ADDRESS_LENGTH,
  MAX_NAME_LENGTH,
  ProposalMapLocation,
  ProposalPlace,
  normalizeMapLocation,
  parseEmbedInput,
  toSafePlace
} from '../../../../../core/models/proposal-location';
import { ConfirmDialog } from '../../../../../shared/ui/confirm-dialog/confirm-dialog';
import { MapLocation } from '../../../../../shared/ui/map-location/map-location';
import {
  MIN_SUGGEST_LENGTH,
  PlaceBias,
  PlaceCandidate,
  PlaceSearchService,
  SUGGEST_DEBOUNCE_MS,
  candidatePlace,
  placeSearchMessage,
  suggestionPauseMessage
} from '../../../../../core/services/place-search';

let nextGroup = 0;

export type LocationPhase = 'idle' | 'saving' | 'saved' | 'error';

export interface LocationStatus {
  phase: LocationPhase;
  message?: string;
}

/**
 * Bloque opcional «Ubicación» de un día o de un servicio. Presentacional, igual que DayRecommendations: mantiene el
 * borrador y avisa con `save` / `remove`; quien lo usa persiste y devuelve el estado. Si el guardado falla, el borrador
 * no se toca. Lo pegado en el campo del mapa solo se interpreta con parseEmbedInput: nunca se renderiza ni se guarda.
 *
 * Dos formas de poner el mapa: buscar un lugar (la asesora elige y confirma un resultado, que NO se guarda hasta pulsar «Guardar
 * cambios») o el código de Google Maps pegado a mano. Son excluyentes: la última acción manda.
 *
 * Buscar un lugar tiene dos vías, ambas por la Edge Function geocode-place (misma caché y misma cuota diaria):
 *  - Sugerencias al escribir (combobox): desde 4 caracteres y tras 700 ms sin teclear. Solo reaccionan a lo que la asesora ESCRIBE
 *    (evento input), nunca al abrir el editor, cargar un documento, rellenar el campo desde datos guardados ni al enfocar.
 *  - «Buscar ubicación» (botón): búsqueda completa, siempre disponible (con la cuota agotada sirve lo ya cacheado).
 * Cambiar el texto después de elegir un resultado invalida la selección pendiente.
 */
@Component({
  selector: 'app-location-editor',
  imports: [ReactiveFormsModule, ConfirmDialog, MapLocation],
  templateUrl: './location-editor.html',
  styleUrl: './location-editor.css'
})
export class LocationEditor {
  /** Lo último guardado (undefined = sin ubicación). */
  readonly value = input<ProposalMapLocation | undefined>(undefined);
  /** Para etiquetas accesibles, ej. «del día 2» o «del servicio». */
  readonly subject = input.required<string>();
  readonly status = input<LocationStatus>({ phase: 'idle' });
  /** Consulta precargada (nombre del servicio, dirección y ciudad disponibles); la asesora puede editarla. */
  readonly queryHint = input<string>('');
  /** Coordenadas fiables cercanas (lugar guardado del día) como preferencia —nunca filtro— del autocompletado. */
  readonly biasPlace = input<PlaceBias | undefined>(undefined);

  readonly save = output<ProposalMapLocation | undefined>();
  readonly remove = output<void>();

  readonly maxName = MAX_NAME_LENGTH;
  readonly maxAddress = MAX_ADDRESS_LENGTH;
  readonly name = new FormControl('', { nonNullable: true });
  readonly address = new FormControl('', { nonNullable: true });
  readonly embed = new FormControl('', { nonNullable: true });
  readonly open = signal(false);
  readonly confirmingRemove = signal(false);
  readonly edited = signal(false);
  /** El error de «falta el nombre» se muestra solo después de intentar guardar. */
  readonly submitted = signal(false);
  private readonly draft = signal({ name: '', address: '', embed: '' });

  private readonly places = inject(PlaceSearchService);

  /**
   * Hasta cuándo no se puede volver a buscar (espera interna breve o pausa del proveedor, respetando Retry-After). Solo desactiva
   * el botón: NUNCA se reintenta automáticamente.
   */
  readonly cooldownUntil = signal(0);
  private readonly clock = signal(Date.now());
  readonly cooldownSeconds = computed(() => Math.max(0, Math.ceil((this.cooldownUntil() - this.clock()) / 1000)));
  /** Solo se limita lo que se MUESTRA (más de 1 h → «más de 1 h»); el bloqueo del botón usa la espera completa. */
  readonly cooldownLabel = computed(() => {
    const s = this.cooldownSeconds();
    if (s > 3600) {
      return 'más de 1 h';
    }
    return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
  });
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  readonly groupName = `loc-result-${++nextGroup}`;
  readonly listboxId = `loc-suggest-${nextGroup}`;
  optionId(index: number): string {
    return `${this.listboxId}-opt-${index}`;
  }
  readonly query = new FormControl('', { nonNullable: true });
  readonly searching = signal(false);
  /** null = todavía no se ha buscado; [] = sin resultados. */
  readonly candidates = signal<PlaceCandidate[] | null>(null);
  readonly searchedFor = signal('');
  readonly searchError = signal<string | null>(null);
  readonly selectedIndex = signal<number | null>(null);
  /** Lugar elegido y confirmado con «Buscar ubicación» (aún sin guardar). */
  readonly place = signal<ProposalPlace | null>(null);
  private readonly placeDirty = signal(false);

  // ---- Sugerencias al escribir (combobox)
  readonly suggestions = signal<PlaceCandidate[]>([]);
  readonly suggestOpen = signal(false);
  readonly suggestLoading = signal(false);
  /** null = aún sin respuesta para el texto actual; true = respondió y no hubo sugerencias. */
  readonly suggestEmpty = signal(false);
  readonly suggestError = signal<string | null>(null);
  readonly activeIndex = signal(-1);
  /** Las sugerencias se detienen solas (cuota agotada o pausa del proveedor); el botón de buscar sigue disponible. */
  readonly suggestPausedMessage = signal<string | null>(null);
  /** Sugerencia elegida y aún sin confirmar: se muestra con su mapa y se invalida si cambia el texto. */
  readonly pending = signal<PlaceCandidate | null>(null);
  readonly pendingLocation = computed(() => {
    const candidate = this.pending();
    return candidate ? this.candidateLocation(candidate) : undefined;
  });
  /** Estado para lectores de pantalla (región viva): solo cambia con resultados reales, no con cada tecla. */
  readonly suggestStatus = computed(() => {
    if (this.suggestLoading()) {
      return 'Buscando sugerencias…';
    }
    if (this.suggestError()) {
      return this.suggestError();
    }
    if (this.suggestEmpty()) {
      return 'No hay sugerencias para esta búsqueda.';
    }
    const count = this.suggestions().length;
    return this.suggestOpen() && count ? `${count} ${count === 1 ? 'sugerencia disponible' : 'sugerencias disponibles'}. Usa las flechas para elegir.` : '';
  });
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private suggestAbort: AbortController | null = null;
  /** Identifica la última petición lanzada: una respuesta de otra anterior se descarta. */
  private suggestSeq = 0;
  /** Clave (texto + preferencia) de la consulta en curso o ya mostrada: evita repetir una idéntica por foco, flechas o renderizado. */
  private suggestKey = '';
  /** Respuestas ya recibidas en este editor (solo memoria): volver a un texto idéntico no consulta otra vez. */
  private readonly suggestMemory = new Map<string, PlaceCandidate[]>();
  private readonly bias = computed<PlaceBias | undefined>(() => {
    const saved = toSafePlace(this.value()?.place);
    return saved ? { lat: saved.lat, lon: saved.lon } : this.biasPlace();
  });

  /** Resultado de interpretar lo pegado; null = campo vacío (el mapa es opcional). */
  readonly parsed = computed(() => {
    const text = this.draft().embed;
    return text.trim() ? parseEmbedInput(text) : null;
  });
  readonly embedError = computed(() => {
    const result = this.parsed();
    return result && !result.ok ? result.message : null;
  });
  readonly nameError = computed(() =>
    this.submitted() && !this.draft().name.trim() ? 'Escribe el nombre del lugar.' : null
  );
  /** Lo que verá el viajero con el borrador actual (mapa solo si lo pegado es válido). */
  readonly previewLocation = computed(() => {
    const { name, address } = this.draft();
    const result = this.parsed();
    return normalizeMapLocation(name, address, result?.ok ? result.url : null, this.place());
  });
  readonly canSave = computed(() => !this.embedError() && this.status().phase !== 'saving');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopClock();
      this.cancelSuggestions();
      if (this.pauseTimer) {
        clearTimeout(this.pauseTimer);
      }
    });
    merge(this.name.valueChanges, this.address.valueChanges, this.embed.valueChanges).subscribe(() => {
      this.edited.set(true);
      this.draft.set({ name: this.name.value, address: this.address.value, embed: this.embed.value });
    });
    // Pegar un código de Google Maps sustituye al lugar buscado (son excluyentes).
    this.embed.valueChanges.subscribe((text) => {
      if (text.trim() && this.place()) {
        this.place.set(null);
        this.placeDirty.set(true);
      }
    });
    // La consulta sigue a la sugerencia (nombre + dirección + ciudad) hasta que la asesora la edita.
    effect(() => {
      const hint = this.queryHint();
      if (!this.query.dirty) {
        this.query.setValue(hint, { emitEvent: false });
      }
    });
    // Mientras el asesor no haya tocado nada, el formulario sigue a lo guardado (carga, recarga, otro guardado).
    effect(() => {
      const saved = this.value();
      if (this.isDirty()) {
        return;
      }
      this.place.set(toSafePlace(saved?.place) ?? null);
      this.setControls(saved?.name ?? '', saved?.address ?? '', saved?.embedUrl ?? '');
      if (saved) {
        this.open.set(true);
      }
    });
    // Un guardado exitoso deja el borrador como «limpio»; uno fallido lo conserva tal cual.
    effect(() => {
      if (this.status().phase === 'saved') {
        this.markPristine();
        this.edited.set(false);
      }
    });
  }

  private setControls(name: string, address: string, embed: string): void {
    this.name.setValue(name, { emitEvent: false });
    this.address.setValue(address, { emitEvent: false });
    this.embed.setValue(embed, { emitEvent: false });
    this.draft.set({ name, address, embed });
  }

  private markPristine(): void {
    this.name.markAsPristine();
    this.address.markAsPristine();
    this.embed.markAsPristine();
    this.placeDirty.set(false);
  }

  private isDirty(): boolean {
    return this.name.dirty || this.address.dirty || this.embed.dirty || this.placeDirty();
  }

  show(): void {
    this.open.set(true);
  }

  /** Única forma de consultar al proveedor: el botón «Buscar ubicación». No hay búsqueda al escribir. */
  async search(): Promise<void> {
    if (this.searching() || this.cooldownUntil() > Date.now()) {
      return;
    }
    const text = this.query.value.trim();
    if (text.length < 3) {
      this.searchError.set(placeSearchMessage('invalid_query'));
      return;
    }
    this.cancelSuggestions();
    this.closeSuggestions();
    this.pending.set(null);
    this.searching.set(true);
    this.searchError.set(null);
    this.candidates.set(null);
    this.selectedIndex.set(null);
    try {
      const response = await this.places.search(text);
      if (!response.success) {
        this.searchError.set(placeSearchMessage(response.error, response.retryAfterSeconds, response));
        // Con el límite diario agotado el botón NO se desactiva: las búsquedas ya cacheadas siguen funcionando; solo las nuevas reciben el aviso.
        if (response.error !== 'quota_exhausted' && response.retryAfterSeconds && response.retryAfterSeconds > 0) {
          this.startCooldown(response.retryAfterSeconds);
        }
        return;
      }
      this.searchedFor.set(text);
      this.candidates.set(response.results ?? []);
    } catch {
      this.searchError.set(placeSearchMessage(undefined));
    } finally {
      this.searching.set(false);
    }
  }

  private startCooldown(seconds: number): void {
    this.cooldownUntil.set(Date.now() + seconds * 1000);
    this.clock.set(Date.now());
    if (!this.clockTimer) {
      this.clockTimer = setInterval(() => {
        this.clock.set(Date.now());
        if (this.cooldownUntil() <= Date.now()) {
          this.stopClock();
        }
      }, 1000);
    }
  }

  private stopClock(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  select(index: number): void {
    this.selectedIndex.set(index);
  }

  // ------------------------------------------------------------------ sugerencias al escribir

  /**
   * ÚNICA entrada del autocompletado: el evento `input` del campo, que solo ocurre cuando la asesora escribe. Cualquier cambio de texto
   * invalida la selección pendiente y cancela lo que estuviera en camino; después de 700 ms sin teclear (y con ≥ 4 caracteres) pide
   * sugerencias, salvo que estén en pausa.
   */
  onQueryInput(raw: string): void {
    this.invalidateSelection();
    this.cancelSuggestions();
    this.suggestError.set(null);
    this.suggestEmpty.set(false);
    this.activeIndex.set(-1);
    const text = raw.trim();
    if (text.length < MIN_SUGGEST_LENGTH) {
      this.suggestions.set([]);
      this.suggestKey = '';
      this.suggestOpen.set(false);
      return;
    }
    if (this.suggestPausedMessage()) {
      this.suggestions.set([]);
      this.suggestOpen.set(false);
      return;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.fetchSuggestions(text);
    }, SUGGEST_DEBOUNCE_MS);
  }

  private invalidateSelection(): void {
    this.pending.set(null);
    this.selectedIndex.set(null);
    this.candidates.set(null);
    this.searchError.set(null);
  }

  private keyFor(text: string): string {
    const bias = this.bias();
    return `${text.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('es')}|${bias ? `${bias.lat.toFixed(1)},${bias.lon.toFixed(1)}` : '-'}`;
  }

  private async fetchSuggestions(text: string): Promise<void> {
    const key = this.keyFor(text);
    // Idéntica a la consulta en curso o ya mostrada: no se repite.
    if (key === this.suggestKey && (this.suggestLoading() || this.suggestions().length > 0 || this.suggestEmpty())) {
      this.suggestOpen.set(true);
      return;
    }
    this.suggestKey = key;
    const remembered = this.suggestMemory.get(key);
    if (remembered) {
      this.showSuggestions(remembered);
      return;
    }
    const seq = ++this.suggestSeq;
    const controller = new AbortController();
    this.suggestAbort = controller;
    this.suggestLoading.set(true);
    this.suggestOpen.set(true);
    let response;
    try {
      response = await this.places.suggest(text, this.bias(), controller.signal);
    } catch {
      response = { success: false as const, error: 'network_failure' };
    }
    // Respuesta obsoleta (escribió algo más, buscó, cerró o destruyó el editor): se descarta sin tocar nada.
    if (seq !== this.suggestSeq || controller.signal.aborted) {
      return;
    }
    this.suggestAbort = null;
    this.suggestLoading.set(false);
    if (!response.success) {
      this.suggestKey = '';
      this.suggestions.set([]);
      if (response.error === 'quota_exhausted' || response.error === 'provider_limited' || response.error === 'provider_blocked' || response.error === 'provider_unavailable') {
        this.pauseSuggestions(response.error, response.retryAfterSeconds);
        return;
      }
      if (response.error === 'autocomplete_unsupported') {
        this.pauseSuggestions(response.error, 365 * 86400);
        return;
      }
      this.suggestError.set(placeSearchMessage(response.error, response.retryAfterSeconds, response));
      this.suggestOpen.set(true);
      return;
    }
    const results = response.results ?? [];
    this.rememberSuggestions(key, results);
    this.showSuggestions(results);
  }

  private showSuggestions(results: PlaceCandidate[]): void {
    this.suggestions.set(results);
    this.suggestEmpty.set(results.length === 0);
    this.suggestOpen.set(true);
    this.activeIndex.set(-1);
  }

  private rememberSuggestions(key: string, results: PlaceCandidate[]): void {
    if (this.suggestMemory.size >= 30) {
      this.suggestMemory.delete(this.suggestMemory.keys().next().value!);
    }
    this.suggestMemory.set(key, results);
  }

  /** Detiene las sugerencias hasta que pase la pausa (se reanudan al escribir de nuevo). No reintenta ni toca «Buscar ubicación». */
  private pauseSuggestions(error: string, retryAfterSeconds: number | undefined): void {
    this.suggestOpen.set(false);
    this.suggestEmpty.set(false);
    this.suggestPausedMessage.set(error === 'autocomplete_unsupported' ? placeSearchMessage(error) : suggestionPauseMessage(error, retryAfterSeconds));
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
    }
    const ms = Math.min(Math.max(1, retryAfterSeconds ?? 60) * 1000, 2 ** 31 - 1);
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      this.suggestPausedMessage.set(null);
    }, ms);
  }

  /** Cancela el temporizador y la petición del navegador. (Si el servidor ya llamó al proveedor, esa llamada ya contó en la cuota.) */
  private cancelSuggestions(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.suggestSeq++;
    this.suggestAbort?.abort();
    this.suggestAbort = null;
    this.suggestLoading.set(false);
  }

  private closeSuggestions(): void {
    this.suggestOpen.set(false);
    this.activeIndex.set(-1);
  }

  /** Foco en el campo: solo reabre lo que ya se tenía para ESTE texto; nunca consulta. */
  onQueryFocus(): void {
    if (this.suggestions().length > 0 && this.keyFor(this.query.value.trim()) === this.suggestKey) {
      this.suggestOpen.set(true);
    }
  }

  /** El foco salió del combobox (campo + lista): se cierra la lista sin consultar. */
  onComboboxFocusOut(event: FocusEvent, container: HTMLElement): void {
    if (!container.contains(event.relatedTarget as Node | null)) {
      this.closeSuggestions();
    }
  }

  /** Teclado del combobox: flechas, Enter (elige la opción activa) y Escape (cierra). */
  onQueryKeydown(event: KeyboardEvent): void {
    const count = this.suggestions().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (count === 0) {
          return;
        }
        event.preventDefault();
        if (!this.suggestOpen()) {
          this.suggestOpen.set(true);
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const current = this.activeIndex();
        this.activeIndex.set(current < 0 ? (step === 1 ? 0 : count - 1) : (current + step + count) % count);
        return;
      }
      case 'Enter':
        if (this.suggestOpen() && this.activeIndex() >= 0) {
          event.preventDefault();
          this.pickSuggestion(this.activeIndex());
        }
        return;
      case 'Escape':
        if (this.suggestOpen()) {
          event.preventDefault();
          this.closeSuggestions();
        }
        return;
    }
  }

  /**
   * Elegir una sugerencia: queda como selección PENDIENTE (con su mapa) hasta pulsar «Confirmar ubicación». No se guarda nada ni se
   * toma nunca la primera por sí sola. Las coordenadas ya vienen en la sugerencia: no hace falta otra llamada.
   */
  pickSuggestion(index: number): void {
    const candidate = this.suggestions()[index];
    if (!candidate || !candidatePlace(candidate)) {
      return;
    }
    this.cancelSuggestions();
    this.pending.set(candidate);
    this.candidates.set(null);
    this.selectedIndex.set(null);
    // Rellena el campo con lo elegido SIN disparar sugerencias (no es teclear).
    this.query.setValue([candidate.name, candidate.city, candidate.country].filter(Boolean).join(', '), { emitEvent: false });
    this.query.markAsDirty();
    this.suggestKey = '';
    this.suggestions.set([]);
    this.closeSuggestions();
  }

  confirmPending(): void {
    const candidate = this.pending();
    if (candidate) {
      this.applyCandidate(candidate);
    }
  }

  /** Línea secundaria de una sugerencia: dirección (sin repetir ciudad ni país) más ciudad y país si faltan. */
  suggestionDetail(candidate: PlaceCandidate): string {
    const parts = [candidate.address, candidate.city, candidate.country].map((part) => (part ?? '').trim()).filter(Boolean);
    return parts.filter((part, i) => !parts.slice(0, i).some((before) => before.toLowerCase().includes(part.toLowerCase()))).join(' · ');
  }

  /** Lo que muestra la tarjeta de un candidato (el mismo componente que verá el viajero). */
  candidateLocation(candidate: PlaceCandidate): ProposalMapLocation | undefined {
    return normalizeMapLocation(candidate.name, candidate.address, null, candidatePlace(candidate));
  }

  /**
   * Confirma el candidato elegido: pasa al borrador (nombre y dirección solo si están vacíos, para no pisar lo que escribió la
   * asesora). NO guarda: se guarda con «Guardar cambios», por la cola de guardado de siempre.
   */
  confirmSelection(): void {
    const index = this.selectedIndex();
    const candidate = index === null ? undefined : this.candidates()?.[index];
    if (candidate) {
      this.applyCandidate(candidate);
    }
  }

  private applyCandidate(candidate: PlaceCandidate): void {
    const place = candidatePlace(candidate);
    if (!place) {
      return;
    }
    if (!this.name.value.trim()) {
      this.name.setValue(candidate.name);
      this.name.markAsDirty();
    }
    if (!this.address.value.trim()) {
      this.address.setValue(candidate.address);
      this.address.markAsDirty();
    }
    this.embed.setValue('', { emitEvent: false });
    this.draft.update((d) => ({ ...d, embed: '' }));
    this.place.set(place);
    this.placeDirty.set(true);
    this.edited.set(true);
    this.candidates.set(null);
    this.selectedIndex.set(null);
    this.pending.set(null);
  }

  clearPlace(): void {
    this.place.set(null);
    this.placeDirty.set(true);
    this.edited.set(true);
  }

  submit(): void {
    this.submitted.set(true);
    const location = this.previewLocation();
    if (!location || this.embedError()) {
      return;
    }
    this.edited.set(false);
    this.save.emit(location);
  }

  requestRemove(): void {
    const hasDraft = !!(this.value() || this.place() || this.name.value.trim() || this.address.value.trim() || this.embed.value.trim());
    if (hasDraft) {
      this.confirmingRemove.set(true);
    } else {
      this.open.set(false);
    }
  }

  cancelRemove(): void {
    this.confirmingRemove.set(false);
  }

  confirmRemove(): void {
    this.confirmingRemove.set(false);
    this.setControls('', '', '');
    this.place.set(null);
    this.candidates.set(null);
    this.selectedIndex.set(null);
    this.pending.set(null);
    this.cancelSuggestions();
    this.suggestions.set([]);
    this.closeSuggestions();
    this.markPristine();
    this.submitted.set(false);
    this.edited.set(false);
    if (this.value()) {
      this.remove.emit();
    }
    this.open.set(false);
  }
}
