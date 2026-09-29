import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ProposalsService } from '../../../../core/services/proposals';
import {
  ProposalContent,
  ProposalFeeLine,
  ProposalPricingLine,
  createFeeLine,
  createPricingLine
} from '../../../../core/models/proposal.model';

type LineField = 'label' | 'quantity' | 'unitPrice';
type LineKind = 'lines' | 'feesLines';

@Component({
  selector: 'app-pricing-step',
  imports: [CurrencyPipe],
  templateUrl: './pricing-step.html',
  styleUrl: './pricing-step.css'
})
export class PricingStep implements OnInit {
  private readonly proposalsService = inject(ProposalsService);

  readonly proposalId = input.required<string>();
  readonly saved = output<void>();

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly currency = signal('USD');
  readonly lines = signal<ProposalPricingLine[]>([]);
  readonly feesLines = signal<ProposalFeeLine[]>([]);

  /** Vista previa inmediata en el navegador — nunca autoritativa. En cuanto
   *  Supabase confirma el guardado (recompute_proposal_pricing(), ver
   *  supabase/migrations/0029_proposals.sql), authoritativeTotal se
   *  actualiza con el valor real y es siempre el que se muestra como
   *  "confirmado". */
  readonly previewSubtotal = computed(() => this.sum(this.lines()));
  readonly previewFees = computed(() => this.sum(this.feesLines()));
  readonly previewTotal = computed(() => this.previewSubtotal() + this.previewFees());

  readonly authoritativeSubtotal = signal<number | null>(null);
  readonly authoritativeFees = signal<number | null>(null);
  readonly authoritativeTotal = signal<number | null>(null);

  private content: ProposalContent | null = null;

  // Ver el comentario equivalente en client-trip-step.ts — proposalId (input
  // required) no tiene valor todavía dentro del constructor, dispara NG0950.
  ngOnInit(): void {
    void this.load();
  }

  private sum(items: ProposalPricingLine[]): number {
    return items.reduce((total, line) => total + line.quantity * line.unitPrice, 0);
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
      this.currency.set(proposal.currency);
      this.lines.set(proposal.content.pricing.lines);
      this.feesLines.set(proposal.content.pricing.feesLines);
      this.authoritativeSubtotal.set(proposal.pricingSubtotal);
      this.authoritativeFees.set(proposal.pricingFees);
      this.authoritativeTotal.set(proposal.pricingTotal);
    } catch (error) {
      console.error('No se pudo cargar el pricing.', error);
      this.loadError.set('No se pudo cargar el pricing. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  // Misma clase de bug que client-trip-step.ts/build-journey-step.ts: dos
  // persist() disparados casi juntos (ej. blur de una línea justo antes de
  // borrar otra) podían resolver fuera de orden y el más viejo pisaba al
  // más nuevo. La cola serializa y siempre lee this.lines()/this.feesLines()
  // recién en su turno.
  private saveChain: Promise<void> = Promise.resolve();
  private enqueuePersist(): Promise<void> {
    const run = this.saveChain.then(() => this.persist(this.lines(), this.feesLines()));
    this.saveChain = run.catch(() => undefined);
    return run;
  }

  private async persist(nextLines: ProposalPricingLine[], nextFeesLines: ProposalFeeLine[]): Promise<void> {
    if (!this.content) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    const nextContent: ProposalContent = {
      ...this.content,
      pricing: { lines: nextLines, feesLines: nextFeesLines }
    };
    try {
      const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
      this.content = updated.content;
      this.lines.set(updated.content.pricing.lines);
      this.feesLines.set(updated.content.pricing.feesLines);
      this.authoritativeSubtotal.set(updated.pricingSubtotal);
      this.authoritativeFees.set(updated.pricingFees);
      this.authoritativeTotal.set(updated.pricingTotal);
      this.saved.emit();
    } catch (error) {
      console.error('No se pudo guardar el pricing.', error);
      this.saveError.set('No se pudo guardar. Inténtalo nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }

  addLine(kind: LineKind): void {
    if (kind === 'lines') {
      this.lines.update((items) => [...items, createPricingLine()]);
    } else {
      this.feesLines.update((items) => [...items, createFeeLine()]);
    }
  }

  removeLine(kind: LineKind, id: string): Promise<void> {
    if (kind === 'lines') {
      this.lines.update((items) => items.filter((l) => l.id !== id));
    } else {
      this.feesLines.update((items) => items.filter((l) => l.id !== id));
    }
    return this.enqueuePersist();
  }

  onFieldInput(kind: LineKind, id: string, field: LineField, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value: string | number = field === 'label' ? raw : Number(raw);
    if (kind === 'lines') {
      this.lines.update((items) => items.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
    } else {
      this.feesLines.update((items) => items.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
    }
  }

  onFieldBlur(): Promise<void> {
    return this.enqueuePersist();
  }
}
