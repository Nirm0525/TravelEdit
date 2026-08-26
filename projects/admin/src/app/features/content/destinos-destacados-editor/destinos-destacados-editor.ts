import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { SiteContentService } from '../../../core/services/site-content';
import { DestinationsService } from '../../../core/services/destinations';
import { Destination } from '../../../core/models/destination.model';
import { DestinationStatus } from '../../../core/models/destination-enums';
import { DESTINATION_STATUS_LABEL } from '../../../core/data/destination-options';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';
import { AdminModal } from '../../../shared/ui/admin-modal/admin-modal';

@Component({
  selector: 'app-destinos-destacados-editor',
  imports: [ReactiveFormsModule, DragDropModule, ContentEditorLayout, AdminModal],
  templateUrl: './destinos-destacados-editor.html',
  styleUrl: './destinos-destacados-editor.css'
})
export class DestinosDestacadosEditor {
  private readonly siteContent = inject(SiteContentService);
  private readonly destinationsService = inject(DestinationsService);
  private readonly fb = inject(FormBuilder);

  readonly statusLabel = DESTINATION_STATUS_LABEL;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  readonly selected = signal<Destination[]>([]);

  readonly pickerOpen = signal(false);
  readonly pickerStatus = signal<DestinationStatus>('published');
  readonly pickerSearch = signal('');
  readonly pickerResults = signal<Destination[]>([]);
  readonly pickerLoading = signal(false);

  readonly form = this.fb.group({
    eyebrow: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    headingLine1: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    headingLine2: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    headingLine3: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    support: this.fb.control('', { nonNullable: true, validators: [Validators.required] })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const content = await this.siteContent.getDestinosDestacados();
    this.form.patchValue(content);

    if (content.destinationIds.length > 0) {
      const found = await this.destinationsService.listByIds(content.destinationIds);
      const byId = new Map(found.map((d) => [d.id, d]));
      this.selected.set(content.destinationIds.map((id) => byId.get(id)).filter((d): d is Destination => !!d));
    }

    this.loading.set(false);
  }

  isUnavailable(destination: Destination): boolean {
    return destination.status !== 'published';
  }

  removeSelected(id: string): void {
    this.selected.update((list) => list.filter((d) => d.id !== id));
  }

  drop(event: CdkDragDrop<Destination[]>): void {
    const reordered = [...this.selected()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.selected.set(reordered);
  }

  openPicker(): void {
    this.pickerOpen.set(true);
    void this.loadPicker();
  }

  closePicker(): void {
    this.pickerOpen.set(false);
  }

  setPickerStatus(status: DestinationStatus): void {
    this.pickerStatus.set(status);
    void this.loadPicker();
  }

  onPickerSearch(event: Event): void {
    this.pickerSearch.set((event.target as HTMLInputElement).value);
    void this.loadPicker();
  }

  private async loadPicker(): Promise<void> {
    this.pickerLoading.set(true);
    try {
      const page = await this.destinationsService.list({
        page: 1,
        pageSize: 50,
        status: this.pickerStatus(),
        search: this.pickerSearch() || undefined
      });
      const selectedIds = new Set(this.selected().map((d) => d.id));
      this.pickerResults.set(page.items.filter((d) => !selectedIds.has(d.id)));
    } finally {
      this.pickerLoading.set(false);
    }
  }

  addDestination(destination: Destination): void {
    this.selected.update((list) => [...list, destination]);
    this.pickerResults.update((list) => list.filter((d) => d.id !== destination.id));
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.siteContent.updateDestinosDestacados({
        ...this.form.getRawValue(),
        destinationIds: this.selected().map((d) => d.id)
      });
      this.savedAt.set(new Date());
    } catch {
      this.error.set('No se pudieron guardar los cambios. Intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }
}
