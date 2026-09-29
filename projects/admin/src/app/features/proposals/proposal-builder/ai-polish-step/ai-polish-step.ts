import { Component, ElementRef, OnInit, inject, input, output, signal, viewChild } from '@angular/core';
import { ProposalsService } from '../../../../core/services/proposals';
import { ProposalAiService, AiChatTurn } from '../../../../core/services/proposal-ai';
import { Proposal, ProposalContent, ProposalDay, ProposalServiceItem } from '../../../../core/models/proposal.model';

type AiTargetKind =
  | 'cover_title'
  | 'cover_subtitle'
  | 'intro'
  | 'day_title'
  | 'day_description'
  | 'service_description'
  | 'terms'
  | 'custom';

interface AiTargetOption {
  key: string;
  kind: AiTargetKind;
  label: string;
  dayId?: string;
  serviceId?: string;
}

interface ChatSuggestion {
  targetKey: string;
  targetLabel: string;
  text: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: ChatSuggestion[];
  isTermsTarget?: boolean;
  appliedIndex?: number | null;
}

/** HTML -> texto plano, para mandar intro/terms (TipTap) a OpenAI. Esta fase
 *  no hace edición AI "rich-text-aware" — al aplicar, el texto plano vuelve
 *  a envolverse en <p> por párrafo (ver wrapAsHtml). Simplificación
 *  documentada a propósito, no un descuido. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join('');
}

@Component({
  selector: 'app-ai-polish-step',
  templateUrl: './ai-polish-step.html',
  styleUrl: './ai-polish-step.css'
})
export class AiPolishStep implements OnInit {
  private readonly proposalsService = inject(ProposalsService);
  private readonly proposalAi = inject(ProposalAiService);
  private readonly scrollAnchor = viewChild<ElementRef<HTMLElement>>('scrollAnchor');

  readonly proposalId = input.required<string>();
  /** Target key (ver buildTargetOptions) que un botón ✨ contextual de otro
   *  paso quiere sugerir como punto de partida — nunca dispara la llamada a
   *  OpenAI sola, solo precompleta el mensaje para que el agente lo revise
   *  y lo envíe. */
  readonly presetTargetKey = input<string | null>(null);
  readonly saved = output<void>();

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly targetOptions = signal<AiTargetOption[]>([]);
  readonly messages = signal<ChatMessage[]>([
    {
      role: 'assistant',
      content: '¿En qué quieres trabajar? Puedes pedirme que mejore textos, genere alternativas o revise la propuesta.'
    }
  ]);
  readonly draftMessage = signal('');
  readonly sending = signal(false);
  readonly applyingKey = signal<string | null>(null);
  readonly applyError = signal<string | null>(null);
  readonly appliedFlash = signal(false);

  private proposal: Proposal | null = null;
  private content: ProposalContent | null = null;
  private destinationText: string | null = null;

  private saveChain: Promise<void> = Promise.resolve();

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
      this.proposal = proposal;
      this.content = proposal.content;
      this.destinationText = proposal.destinationText;
      this.targetOptions.set(this.buildTargetOptions(proposal.content));

      const preset = this.presetTargetKey();
      const presetTarget = preset ? this.targetOptions().find((t) => t.key === preset) : null;
      if (presetTarget) {
        this.draftMessage.set(`Mejora ${this.lowerFirst(presetTarget.label)}.`);
      }
    } catch (error) {
      console.error('No se pudo cargar la propuesta para AI Polish.', error);
      this.loadError.set('No se pudo cargar la propuesta. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  private lowerFirst(text: string): string {
    return text.length > 0 ? text.charAt(0).toLowerCase() + text.slice(1) : text;
  }

  private buildTargetOptions(content: ProposalContent): AiTargetOption[] {
    const options: AiTargetOption[] = [
      { key: 'cover_title', kind: 'cover_title', label: 'Título de portada' },
      { key: 'cover_subtitle', kind: 'cover_subtitle', label: 'Subtítulo de portada' },
      { key: 'intro', kind: 'intro', label: 'Introducción' }
    ];

    for (const day of content.days) {
      options.push({ key: `day_title:${day.id}`, kind: 'day_title', label: `Día ${day.dayNumber}: título`, dayId: day.id });
      options.push({
        key: `day_description:${day.id}`,
        kind: 'day_description',
        label: `Día ${day.dayNumber}: descripción`,
        dayId: day.id
      });
      for (const service of day.services) {
        options.push({
          key: `service_description:${day.id}:${service.id}`,
          kind: 'service_description',
          label: `Día ${day.dayNumber} · ${service.title || 'Servicio'}: descripción`,
          dayId: day.id,
          serviceId: service.id
        });
      }
    }

    options.push({ key: 'terms', kind: 'terms', label: 'Términos y condiciones' });
    return options;
  }

  private findTarget(key: string): AiTargetOption | null {
    return this.targetOptions().find((t) => t.key === key) ?? null;
  }

  private findDay(dayId: string): ProposalDay | null {
    return this.content?.days.find((d) => d.id === dayId) ?? null;
  }

  private findService(dayId: string, serviceId: string): ProposalServiceItem | null {
    return this.findDay(dayId)?.services.find((s) => s.id === serviceId) ?? null;
  }

  private readCurrentText(target: AiTargetOption): string {
    if (!this.content) {
      return '';
    }
    switch (target.kind) {
      case 'cover_title':
        return this.content.cover.title;
      case 'cover_subtitle':
        return this.content.cover.subtitle;
      case 'intro':
        return htmlToPlainText(this.content.intro.body);
      case 'day_title':
        return this.findDay(target.dayId!)?.title ?? '';
      case 'day_description':
        return this.findDay(target.dayId!)?.description ?? '';
      case 'service_description':
        return this.findService(target.dayId!, target.serviceId!)?.description ?? '';
      case 'terms':
        return htmlToPlainText(this.content.terms.body);
      case 'custom':
        return '';
    }
  }

  onDraftInput(event: Event): void {
    this.draftMessage.set((event.target as HTMLTextAreaElement).value);
  }

  onDraftKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.sendMessage();
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => this.scrollAnchor()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  }

  async sendMessage(): Promise<void> {
    const text = this.draftMessage().trim();
    if (!text || this.sending()) {
      return;
    }

    this.messages.update((items) => [...items, { role: 'user', content: text }]);
    this.draftMessage.set('');
    this.sending.set(true);
    this.applyError.set(null);
    this.scrollToBottom();

    const history: AiChatTurn[] = this.messages()
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const response = await this.proposalAi.chat({
        message: text,
        targets: this.targetOptions().map((t) => ({ key: t.key, label: t.label, currentText: this.readCurrentText(t) })),
        history,
        context: { destination: this.destinationText ?? undefined }
      });

      if (!response.success || !response.result) {
        this.messages.update((items) => [...items, { role: 'assistant', content: this.describeError(response.error) }]);
        return;
      }

      const { reply, targetKey, suggestions } = response.result;
      const target = targetKey ? this.findTarget(targetKey) : null;

      this.messages.update((items) => [
        ...items,
        {
          role: 'assistant',
          content: reply,
          isTermsTarget: target?.kind === 'terms',
          suggestions:
            target && suggestions.length > 0
              ? suggestions.map((s) => ({ targetKey: target.key, targetLabel: target.label, text: s }))
              : undefined,
          appliedIndex: null
        }
      ]);
    } catch (error) {
      console.error('No se pudo conectar con The Edit Assistant.', error);
      this.messages.update((items) => [
        ...items,
        { role: 'assistant', content: 'No se pudo conectar con el servicio de AI. Inténtalo nuevamente.' }
      ]);
    } finally {
      this.sending.set(false);
      this.scrollToBottom();
    }
  }

  private describeError(code?: string): string {
    switch (code) {
      case 'unauthorized':
        return 'Tu sesión expiró. Vuelve a iniciar sesión.';
      case 'forbidden':
        return 'No tienes permiso para usar The Edit Assistant.';
      case 'empty_text':
        return 'Escribe un mensaje antes de enviar.';
      case 'text_too_long':
        return 'El mensaje o la conversación son demasiado largos. Intenta con algo más breve.';
      case 'rate_limited':
        return 'Demasiadas solicitudes seguidas. Espera un momento e intenta de nuevo.';
      case 'ai_timeout':
        return 'La IA tardó demasiado en responder. Intenta de nuevo.';
      case 'ai_provider_unavailable':
      case 'ai_provider_auth_error':
        return 'El servicio de AI no está disponible en este momento.';
      case 'malformed_ai_response':
        return 'La IA devolvió una respuesta inesperada. Intenta de nuevo.';
      default:
        return 'No se pudo generar una respuesta. Inténtalo nuevamente.';
    }
  }

  private enqueueSave(work: () => Promise<void>): Promise<void> {
    const run = this.saveChain.then(work);
    this.saveChain = run.catch(() => undefined);
    return run;
  }

  async useSuggestion(messageIndex: number, suggestionIndex: number): Promise<void> {
    const message = this.messages()[messageIndex];
    const suggestion = message?.suggestions?.[suggestionIndex];
    if (!suggestion) {
      return;
    }
    const target = this.findTarget(suggestion.targetKey);
    if (!target) {
      return;
    }

    const key = `${messageIndex}:${suggestionIndex}`;
    this.applyingKey.set(key);
    this.applyError.set(null);

    await this.enqueueSave(async () => {
      if (!this.content) {
        return;
      }
      const nextContent = this.mutateContent(this.content, target, suggestion.text);
      try {
        const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
        this.proposal = updated;
        this.content = updated.content;
        this.targetOptions.set(this.buildTargetOptions(updated.content));
        this.messages.update((items) =>
          items.map((m, i) => (i === messageIndex ? { ...m, appliedIndex: suggestionIndex } : m))
        );
        this.appliedFlash.set(true);
        setTimeout(() => this.appliedFlash.set(false), 1800);
        this.saved.emit();
      } catch (error) {
        console.error('No se pudo aplicar la sugerencia.', error);
        this.applyError.set('No se pudo guardar. Inténtalo nuevamente.');
      }
    });

    this.applyingKey.set(null);
  }

  private mutateContent(content: ProposalContent, target: AiTargetOption, suggestion: string): ProposalContent {
    switch (target.kind) {
      case 'cover_title':
        return { ...content, cover: { ...content.cover, title: suggestion } };
      case 'cover_subtitle':
        return { ...content, cover: { ...content.cover, subtitle: suggestion } };
      case 'intro':
        return { ...content, intro: { ...content.intro, body: plainTextToHtml(suggestion) } };
      case 'terms':
        return { ...content, terms: { ...content.terms, body: plainTextToHtml(suggestion) } };
      case 'day_title':
        return { ...content, days: content.days.map((d) => (d.id === target.dayId ? { ...d, title: suggestion } : d)) };
      case 'day_description':
        return {
          ...content,
          days: content.days.map((d) => (d.id === target.dayId ? { ...d, description: suggestion } : d))
        };
      case 'service_description':
        return {
          ...content,
          days: content.days.map((d) =>
            d.id === target.dayId
              ? { ...d, services: d.services.map((s) => (s.id === target.serviceId ? { ...s, description: suggestion } : s)) }
              : d
          )
        };
      case 'custom':
        return content;
    }
  }
}
