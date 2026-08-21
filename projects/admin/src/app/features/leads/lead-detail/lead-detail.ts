import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { LeadsService } from '../../../core/services/leads';
import { AuthService } from '../../../core/services/auth';
import { ProfilesService } from '../../../core/services/profiles';
import { Lead, LeadNote } from '../../../core/models/lead.model';
import { LeadStatus } from '../../../core/models/lead-enums';
import { LEAD_STATUS_OPTIONS } from '../../../core/data/lead-options';

@Component({
  selector: 'app-lead-detail',
  imports: [DatePipe],
  templateUrl: './lead-detail.html',
  styleUrl: './lead-detail.css'
})
export class LeadDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly leadsService = inject(LeadsService);
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfilesService);

  private readonly leadId = this.route.snapshot.paramMap.get('id')!;

  readonly statusOptions = LEAD_STATUS_OPTIONS;
  readonly isAdmin = this.auth.isAdmin;

  readonly lead = signal<Lead | null>(null);
  readonly notes = signal<LeadNote[]>([]);
  readonly staffNames = signal<Map<string, string>>(new Map());
  readonly loading = signal(true);
  readonly newNote = signal('');
  readonly savingNote = signal(false);
  readonly deleteConfirming = signal(false);

  readonly detailFields: Array<{ label: string; value: () => string | null }> = [
    { label: 'Dónde vive', value: () => this.lead()?.details.location || null },
    { label: 'Viaja con', value: () => this.lead()?.details.travelingWith || null },
    { label: 'Viajeros', value: () => this.travelersLabel() },
    { label: 'Notas sobre el destino', value: () => this.lead()?.details.destinationNotes || null },
    { label: 'Fecha de salida', value: () => this.lead()?.details.departureDate || null },
    { label: 'Regreso / noches', value: () => this.lead()?.details.returnDate || null },
    { label: 'Fechas flexibles', value: () => (this.lead()?.details.datesFlexible ? 'Sí' : null) },
    { label: 'Ocasión', value: () => this.lead()?.details.occasion || null },
    { label: 'Estilo de viaje', value: () => this.lead()?.details.stylePreferences?.join(', ') || null },
    { label: 'Ritmo', value: () => this.lead()?.details.pace || null },
    { label: 'Estilo de hotel', value: () => this.lead()?.details.hotelStyle || null },
    { label: 'Presupuesto', value: () => this.lead()?.details.budgetRange || null },
    { label: 'Clase de vuelo', value: () => this.lead()?.details.flightClass || null },
    { label: 'Le gusta / evita', value: () => this.lead()?.details.likesAndDislikes || null },
    { label: 'Qué haría el viaje inolvidable', value: () => this.lead()?.details.unforgettableNote || null },
    { label: 'Cómo nos conoció', value: () => this.lead()?.details.hearAboutUs || null }
  ];

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const [lead, notes, staffNames] = await Promise.all([
      this.leadsService.getById(this.leadId),
      this.leadsService.listNotes(this.leadId),
      this.profiles.nameMap()
    ]);
    this.lead.set(lead);
    this.notes.set(notes);
    this.staffNames.set(staffNames);
    this.loading.set(false);
  }

  authorName(authorId: string): string {
    return this.staffNames().get(authorId) ?? 'Alguien del equipo';
  }

  assignedToName(): string | null {
    const assignedTo = this.lead()?.assignedTo;
    if (!assignedTo) {
      return null;
    }
    return this.staffNames().get(assignedTo) ?? 'Un miembro del equipo';
  }

  private travelersLabel(): string | null {
    const details = this.lead()?.details;
    if (!details) {
      return null;
    }
    const parts: string[] = [];
    if (details.adults != null) {
      parts.push(`${details.adults} adultos`);
    }
    if (details.children != null && details.children > 0) {
      parts.push(`${details.children} niños${details.childrenAges ? ` (${details.childrenAges})` : ''}`);
    }
    return parts.length > 0 ? parts.join(', ') : null;
  }

  async setStatus(status: LeadStatus): Promise<void> {
    const current = this.lead();
    if (!current) {
      return;
    }
    this.lead.set(await this.leadsService.updateStatus(current.id, status));
  }

  async assignToMe(): Promise<void> {
    const current = this.lead();
    if (!current) {
      return;
    }
    this.lead.set(await this.leadsService.assignToMe(current.id));
  }

  isAssignedToMe(): boolean {
    return this.lead()?.assignedTo === this.auth.profile()?.id;
  }

  onNoteInput(event: Event): void {
    this.newNote.set((event.target as HTMLTextAreaElement).value);
  }

  async addNote(): Promise<void> {
    const body = this.newNote().trim();
    if (!body || this.savingNote()) {
      return;
    }

    this.savingNote.set(true);
    try {
      const note = await this.leadsService.addNote(this.leadId, body);
      this.notes.update((notes) => [...notes, note]);
      this.newNote.set('');
    } finally {
      this.savingNote.set(false);
    }
  }

  requestDelete(): void {
    if (this.deleteConfirming()) {
      void this.remove();
      return;
    }
    this.deleteConfirming.set(true);
  }

  private async remove(): Promise<void> {
    await this.leadsService.remove(this.leadId);
    await this.router.navigateByUrl('/solicitudes');
  }
}
