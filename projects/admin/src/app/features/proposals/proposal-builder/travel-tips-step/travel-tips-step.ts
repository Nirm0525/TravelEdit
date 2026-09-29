import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { ProposalsService } from '../../../../core/services/proposals';
import {
  ProposalContent,
  ProposalTravelTip,
  ProposalTravelTipGroup,
  createTravelTip,
  createTravelTipGroup
} from '../../../../core/models/proposal.model';
import { ConfirmDialog } from '../../../../shared/ui/confirm-dialog/confirm-dialog';

type TipField = 'title' | 'body';

@Component({
  selector: 'app-travel-tips-step',
  imports: [ConfirmDialog],
  templateUrl: './travel-tips-step.html',
  styleUrl: './travel-tips-step.css'
})
export class TravelTipsStep implements OnInit {
  private readonly proposalsService = inject(ProposalsService);

  readonly proposalId = input.required<string>();
  readonly saved = output<void>();

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly groups = signal<ProposalTravelTipGroup[]>([]);
  readonly groupPendingDelete = signal<ProposalTravelTipGroup | null>(null);

  private content: ProposalContent | null = null;

  // Ver el comentario equivalente en client-trip-step.ts — proposalId (input
  // required) no tiene valor todavía dentro del constructor, dispara NG0950.
  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const proposal = await this.proposalsService.getById(this.proposalId());
      if (!proposal) {
        this.loadError.set('No se encontró la propuesta.');
        return;
      }
      this.content = proposal.content;
      this.groups.set(proposal.content.travelTips);
    } catch (error) {
      console.error('No se pudieron cargar los travel tips.', error);
      this.loadError.set('No se pudieron cargar los travel tips. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  // Misma cola que build-journey-step.ts/pricing-step.ts: cada mutación se
  // aplica recién en su turno, sobre this.groups() ya actualizado por la
  // anterior — evita que dos guardados casi simultáneos (ej. agregar un tip
  // justo después de renombrar el destino) se pisen entre sí.
  private saveChain: Promise<void> = Promise.resolve();
  private enqueueMutation(mutate: (groups: ProposalTravelTipGroup[]) => ProposalTravelTipGroup[]): Promise<void> {
    const run = this.saveChain.then(() => this.persist(mutate(this.groups())));
    this.saveChain = run.catch(() => undefined);
    return run;
  }

  private async persist(nextGroups: ProposalTravelTipGroup[]): Promise<void> {
    if (!this.content) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    const nextContent: ProposalContent = { ...this.content, travelTips: nextGroups };
    try {
      const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
      this.content = updated.content;
      this.groups.set(updated.content.travelTips);
      this.saved.emit();
    } catch (error) {
      console.error('No se pudieron guardar los travel tips.', error);
      this.saveError.set('No se pudo guardar. Inténtalo nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }

  addGroup(): Promise<void> {
    return this.enqueueMutation((groups) => [...groups, createTravelTipGroup()]);
  }

  requestRemoveGroup(group: ProposalTravelTipGroup): void {
    this.saveError.set(null);
    this.groupPendingDelete.set(group);
  }

  cancelRemoveGroup(): void {
    this.groupPendingDelete.set(null);
  }

  confirmRemoveGroup(): Promise<void> {
    const group = this.groupPendingDelete();
    if (!group) {
      return Promise.resolve();
    }
    this.groupPendingDelete.set(null);
    return this.enqueueMutation((groups) => groups.filter((g) => g.id !== group.id));
  }

  onGroupDestinationBlur(group: ProposalTravelTipGroup, event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement).value;
    return this.enqueueMutation((groups) => groups.map((g) => (g.id === group.id ? { ...g, destination: value } : g)));
  }

  addTip(group: ProposalTravelTipGroup): Promise<void> {
    const tip = createTravelTip();
    return this.enqueueMutation((groups) => groups.map((g) => (g.id === group.id ? { ...g, tips: [...g.tips, tip] } : g)));
  }

  removeTip(group: ProposalTravelTipGroup, tip: ProposalTravelTip): Promise<void> {
    return this.enqueueMutation((groups) =>
      groups.map((g) => (g.id === group.id ? { ...g, tips: g.tips.filter((t) => t.id !== tip.id) } : g))
    );
  }

  onTipFieldBlur(group: ProposalTravelTipGroup, tip: ProposalTravelTip, field: TipField, event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    return this.enqueueMutation((groups) =>
      groups.map((g) =>
        g.id === group.id ? { ...g, tips: g.tips.map((t) => (t.id === tip.id ? { ...t, [field]: value } : t)) } : g
      )
    );
  }
}
