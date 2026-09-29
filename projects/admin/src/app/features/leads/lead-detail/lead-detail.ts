import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LeadsService } from '../../../core/services/leads';
import { AuthService } from '../../../core/services/auth';
import { ProfilesService } from '../../../core/services/profiles';
import { AuditLogService } from '../../../core/services/audit-log';
import { ProposalsService, CreateProposalPayload } from '../../../core/services/proposals';
import { Lead, LeadNote } from '../../../core/models/lead.model';
import { LeadEmailStatus, LeadStatus } from '../../../core/models/lead-enums';
import { Proposal } from '../../../core/models/proposal.model';
import {
  LEAD_EMAIL_STATUS_LABEL,
  LEAD_ORIGIN_LABEL,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_OPTIONS
} from '../../../core/data/lead-options';
import { StatusBadge, StatusBadgeVariant } from '../../../shared/ui/status-badge/status-badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';

const EMAIL_STATUS_VARIANT: Record<LeadEmailStatus, StatusBadgeVariant> = {
  pending: 'warning',
  sent: 'success',
  partial: 'warning',
  failed: 'danger',
  not_configured: 'neutral'
};

@Component({
  selector: 'app-lead-detail',
  imports: [DatePipe, RouterLink, StatusBadge, ConfirmDialog],
  templateUrl: './lead-detail.html',
  styleUrl: './lead-detail.css'
})
export class LeadDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly leadsService = inject(LeadsService);
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfilesService);
  private readonly auditLog = inject(AuditLogService);
  private readonly proposalsService = inject(ProposalsService);

  private readonly leadId = this.route.snapshot.paramMap.get('id')!;

  readonly statusOptions = LEAD_STATUS_OPTIONS;
  readonly emailStatusLabel = LEAD_EMAIL_STATUS_LABEL;
  readonly emailStatusVariant = EMAIL_STATUS_VARIANT;
  readonly isAdmin = this.auth.isAdmin;
  readonly statusLabel = LEAD_STATUS_LABEL;
  readonly originLabel = LEAD_ORIGIN_LABEL;

  readonly lead = signal<Lead | null>(null);
  readonly notes = signal<LeadNote[]>([]);
  readonly staffNames = signal<Map<string, string>>(new Map());
  readonly lastActivityActor = signal<string | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly newNote = signal('');
  readonly savingNote = signal(false);
  readonly noteError = signal<string | null>(null);
  readonly deleteConfirmOpen = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);
  readonly statusUpdating = signal(false);
  readonly statusError = signal<string | null>(null);
  readonly assigning = signal(false);
  readonly assignError = signal<string | null>(null);
  /** null hasta que load() resuelve findByLeadId(); ver buildProposalPayloadFromLead()
   *  y onProposalCta() para el criterio de "una propuesta por lead". */
  readonly linkedProposal = signal<Proposal | null>(null);
  readonly proposalActionBusy = signal(false);
  readonly proposalActionError = signal<string | null>(null);
  readonly resendingEmail = signal(false);
  readonly resendEmailError = signal<string | null>(null);
  readonly resendEmailSuccess = signal<string | null>(null);
  private resendEmailSuccessTimeout?: ReturnType<typeof setTimeout>;

  // Referencia corta y estable derivada del UUID real — no es un número de
  // ticket secuencial (no existe ese sistema todavía), solo un identificador
  // legible que no cambia para esta solicitud.
  readonly ticketRef = computed(() => `TE-${this.leadId.slice(0, 6).toUpperCase()}`);

  readonly currentStatusIndex = computed(() => {
    const status = this.lead()?.status;
    const index = this.statusOptions.findIndex((option) => option.value === status);
    return index === -1 ? 0 : index;
  });

  readonly assignedInitials = computed(() => {
    const name = this.assignedToName();
    if (!name) {
      return 'SN';
    }
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'SN';
  });

  readonly detailFields: Array<{ label: string; value: () => string | null }> = [
    { label: 'Dónde vive', value: () => this.lead()?.details.location || null },
    { label: 'Viaja con', value: () => this.lead()?.details.travelingWith || null },
    { label: 'Viajeros', value: () => this.travelersLabel() },
    { label: 'Notas sobre el destino', value: () => this.lead()?.details.destinationNotes || null },
    { label: 'Fecha de salida', value: () => this.lead()?.details.departureDate || null },
    { label: 'Regreso', value: () => this.lead()?.details.returnDate || null },
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
    this.loadError.set(null);
    try {
      const [lead, notes, staffNames, activity, linkedProposal] = await Promise.all([
        this.leadsService.getById(this.leadId),
        this.leadsService.listNotes(this.leadId),
        this.profiles.nameMap(),
        this.auditLog.listByEntity('lead', this.leadId, 1).catch(() => []),
        this.proposalsService.findByLeadId(this.leadId).catch(() => null)
      ]);
      this.lead.set(lead);
      this.notes.set(notes);
      this.staffNames.set(staffNames);
      this.lastActivityActor.set(activity[0]?.actorName ?? null);
      this.linkedProposal.set(linkedProposal);
    } catch (error) {
      console.error('No se pudo cargar la solicitud.', error);
      this.loadError.set('No pudimos cargar la solicitud. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
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

  /** Cualquiera del equipo (admin/editor/staff) puede recibir la asignación —
   *  nameMap() ya trae a todo el staff, sin filtrar por rol. */
  readonly staffOptions = computed(() =>
    Array.from(this.staffNames().entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );

  private travelersLabel(): string | null {
    const details = this.lead()?.details;
    if (!details) {
      return null;
    }
    const parts: string[] = [];
    if (details.adults != null) {
      parts.push(`${details.adults} adulto${details.adults === 1 ? '' : 's'}`);
    }
    if (details.children != null && details.children > 0) {
      parts.push(`${details.children} niño(s)${details.childrenAges ? ` (${details.childrenAges})` : ''}`);
    }
    return parts.length > 0 ? parts.join(', ') : null;
  }

  async setStatus(status: LeadStatus): Promise<void> {
    const current = this.lead();
    if (!current || this.statusUpdating() || current.status === status) {
      return;
    }
    this.statusUpdating.set(true);
    this.statusError.set(null);
    try {
      this.lead.set(await this.leadsService.updateStatus(current.id, status));
    } catch (error) {
      console.error('No se pudo actualizar el estado de la solicitud.', error);
      this.statusError.set('No pudimos actualizar el estado. Inténtalo nuevamente.');
    } finally {
      this.statusUpdating.set(false);
    }
  }

  async onAssignChange(event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value;
    await this.assignTo(value || null);
  }

  private async assignTo(staffId: string | null): Promise<void> {
    const current = this.lead();
    if (!current || this.assigning() || current.assignedTo === staffId) {
      return;
    }
    this.assigning.set(true);
    this.assignError.set(null);
    try {
      this.lead.set(await this.leadsService.assignTo(current.id, staffId));
    } catch (error) {
      console.error('No se pudo asignar la solicitud.', error);
      this.assignError.set('No pudimos asignar esta solicitud. Inténtalo nuevamente.');
    } finally {
      this.assigning.set(false);
    }
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
    this.noteError.set(null);
    try {
      const note = await this.leadsService.addNote(this.leadId, body);
      this.notes.update((notes) => [...notes, note]);
      this.newNote.set('');
    } catch (error) {
      console.error('No se pudo agregar la nota.', error);
      this.noteError.set('No se pudo agregar la nota. Inténtalo nuevamente.');
    } finally {
      this.savingNote.set(false);
    }
  }

  /** Botón único del header: si ya existe una propuesta vinculada, navega a
   *  ella (nunca crea una segunda); si no existe, crea un draft prellenado
   *  con lo que el lead ya trae y navega ahí mismo. proposalActionBusy
   *  deshabilita el botón mientras tanto — evita el duplicado clásico de
   *  doble click antes de que la navegación desmonte el componente. */
  async onProposalCta(): Promise<void> {
    if (this.proposalActionBusy()) {
      return;
    }
    const existing = this.linkedProposal();
    if (existing) {
      await this.router.navigate(['/proposals', existing.id, 'edit']);
      return;
    }

    const current = this.lead();
    if (!current) {
      return;
    }
    this.proposalActionBusy.set(true);
    this.proposalActionError.set(null);
    try {
      const created = await this.proposalsService.createDraft(this.buildProposalPayloadFromLead(current));
      this.linkedProposal.set(created);
      await this.router.navigate(['/proposals', created.id, 'edit']);
    } catch (error) {
      console.error('No se pudo crear la propuesta.', error);
      this.proposalActionError.set('No se pudo crear la propuesta. Inténtalo nuevamente.');
    } finally {
      this.proposalActionBusy.set(false);
    }
  }

  /** Solo se prellenan campos derivables de datos reales y estructurados del
   *  lead — nunca fechas inventadas, y nada de notas internas/privadas
   *  (presupuesto, preferencias, contacto) va al `content` público de la
   *  propuesta en esta fase. */
  private buildProposalPayloadFromLead(lead: Lead): CreateProposalPayload {
    const details = lead.details;
    const travelersCount = details.adults != null ? details.adults + (details.children ?? 0) : undefined;
    return {
      clientName: lead.name,
      leadId: lead.id,
      destinationText: lead.destinationInterestText ?? undefined,
      travelersCount,
      startDate: this.parseStrictIsoDate(details.departureDate),
      endDate: this.parseStrictIsoDate(details.returnDate)
    };
  }

  /** `leads.details.departureDate`/`returnDate` son texto libre del
   *  formulario público ("marzo 2027", "10 noches", etc.), no fechas reales
   *  garantizadas — `proposals.start_date`/`end_date` son columnas `date` de
   *  Postgres. Solo se acepta el valor si ya viene como YYYY-MM-DD exacto
   *  (el único caso donde es inequívoco y no hay que inventar un día); si el
   *  lead no dio una fecha exacta, el proposal se crea sin fechas. */
  private parseStrictIsoDate(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
  }

  private async refreshLeadAndActivity(): Promise<void> {
    try {
      const [lead, activity] = await Promise.all([
        this.leadsService.getById(this.leadId),
        this.auditLog.listByEntity('lead', this.leadId, 1).catch(() => [])
      ]);
      this.lead.set(lead);
      this.lastActivityActor.set(activity[0]?.actorName ?? null);
    } catch (error) {
      console.error('No se pudo refrescar la solicitud tras enviar la propuesta.', error);
    }
  }

  async resendConfirmationEmail(): Promise<void> {
    if (this.resendingEmail()) {
      return;
    }
    this.resendingEmail.set(true);
    this.resendEmailError.set(null);
    try {
      await this.leadsService.resendConfirmationEmail(this.leadId);
      await this.refreshLeadAndActivity();

      clearTimeout(this.resendEmailSuccessTimeout);
      this.resendEmailSuccess.set('Correo reenviado correctamente.');
      this.resendEmailSuccessTimeout = setTimeout(() => this.resendEmailSuccess.set(null), 5000);
    } catch (error) {
      console.error('No se pudo reenviar el correo de confirmación.', error);
      this.resendEmailError.set(error instanceof Error ? error.message : 'No se pudo reenviar el correo. Inténtalo nuevamente.');
    } finally {
      this.resendingEmail.set(false);
    }
  }

  requestDelete(): void {
    this.deleteError.set(null);
    this.deleteConfirmOpen.set(true);
  }

  cancelDelete(): void {
    this.deleteConfirmOpen.set(false);
  }

  async confirmDelete(): Promise<void> {
    if (this.deleting()) {
      return;
    }
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.leadsService.remove(this.leadId);
      this.deleteConfirmOpen.set(false);
      await this.router.navigateByUrl('/solicitudes');
    } catch (error) {
      console.error('No se pudo eliminar la solicitud.', error);
      this.deleteError.set('No pudimos eliminar la solicitud. Inténtalo nuevamente.');
    } finally {
      this.deleting.set(false);
    }
  }
}
