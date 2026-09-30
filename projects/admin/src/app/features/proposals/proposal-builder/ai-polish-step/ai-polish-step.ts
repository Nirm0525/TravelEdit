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

interface ChatAction {
  targetKey: string;
  targetLabel: string;
  isTermsTarget: boolean;
  suggestions: string[];
  appliedSuggestionIndex: number | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Una entrada por campo distinto que el turno resolvió — reemplaza el
   *  `suggestions`/`isTermsTarget`/`appliedIndex` singulares de antes, que
   *  solo podían representar UN campo por turno. */
  actions?: ChatAction[];
  followUp?: string | null;
  /** Día mencionado por número que todavía no existe en el itinerario — se
   *  detecta localmente (nunca se le pregunta a OpenAI si un día existe,
   *  Angular ya tiene esa verdad) y corta antes de llamar a la IA. */
  dayNotFound?: number;
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
  /** El paso no tiene navegación propia entre tabs — el shell (proposal-
   *  builder.ts) es quien sabe cómo cambiar a la pestaña Itinerario, igual
   *  que ya hace con activateAssistant() en sentido inverso. */
  readonly goToItinerary = output<void>();

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
  /** Índice del mensaje cuyo "Aplicar todos" está en curso — separado de
   *  applyingKey (que marca la sugerencia individual en curso dentro del
   *  mismo loop secuencial) para que ambos indicadores de UI tengan sentido
   *  a la vez. */
  readonly applyingAllIndex = signal<number | null>(null);
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

  /** Nunca se le pregunta a OpenAI si un día existe — Angular ya tiene esa
   *  verdad estructural (content.days). Si el mensaje menciona un número de
   *  día por su nombre y ese día no existe todavía, se corta ANTES de
   *  llamar a la IA: ni inventa la estructura ni confunde ese pedido con
   *  otro día real. Solo dispara con una mención explícita ("día 5"/"day
   *  5") — referencias vagas ("ese día", "el segundo") siguen su curso
   *  normal hacia la IA, que puede resolverlas con el historial. */
  private detectMissingDayNumber(message: string): number | null {
    const existing = new Set((this.content?.days ?? []).map((d) => d.dayNumber));
    const regex = /\b(?:d[ií]a|day)\s+(\d{1,2})\b/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(message)) !== null) {
      const mentioned = Number(match[1]);
      if (!existing.has(mentioned)) {
        return mentioned;
      }
    }
    return null;
  }

  /** El historial que se manda a la IA incluye, para cada turno donde el
   *  agente ya aplicó una sugerencia, una nota explícita de qué se aplicó —
   *  así "ahora hazla más corta" en el turno siguiente se resuelve contra el
   *  texto YA aplicado, no contra el original que la IA propuso antes (ver
   *  sección 18 de la spec). Esta nota solo viaja a OpenAI, nunca se
   *  renderiza como un mensaje nuevo en el transcript (el "✓ Aplicado" en la
   *  tarjeta ya comunica eso visualmente). */
  private toHistoryContent(message: ChatMessage): string {
    const applied = (message.actions ?? []).filter((a) => a.appliedSuggestionIndex !== null);
    if (applied.length === 0) {
      return message.content;
    }
    const notes = applied.map(
      (a) => `[Aplicado: "${a.targetLabel}" → "${a.suggestions[a.appliedSuggestionIndex!]}"]`
    );
    return [message.content, ...notes].join('\n');
  }

  async sendMessage(): Promise<void> {
    const text = this.draftMessage().trim();
    if (!text || this.sending()) {
      return;
    }

    this.messages.update((items) => [...items, { role: 'user', content: text }]);
    this.draftMessage.set('');
    this.applyError.set(null);
    this.scrollToBottom();

    const missingDay = this.detectMissingDayNumber(text);
    if (missingDay !== null) {
      this.messages.update((items) => [
        ...items,
        {
          role: 'assistant',
          content: `El Día ${missingDay} todavía no existe. Puedo ayudarte a redactarlo cuando lo agregues al itinerario.`,
          dayNotFound: missingDay
        }
      ]);
      this.scrollToBottom();
      return;
    }

    this.sending.set(true);

    const history: AiChatTurn[] = this.messages()
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: this.toHistoryContent(m) }));

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

      const { reply, actions, followUp } = response.result;
      const resolvedActions: ChatAction[] = actions
        .map((a): ChatAction | null => {
          const target = this.findTarget(a.targetKey);
          if (!target) {
            return null;
          }
          return {
            targetKey: target.key,
            targetLabel: target.label,
            isTermsTarget: target.kind === 'terms',
            suggestions: a.suggestions,
            appliedSuggestionIndex: null
          };
        })
        .filter((a): a is ChatAction => a !== null);

      this.messages.update((items) => [
        ...items,
        {
          role: 'assistant',
          content: reply,
          actions: resolvedActions.length > 0 ? resolvedActions : undefined,
          followUp
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

  /** El follow-up es clickeable: precompleta el composer con la pregunta que
   *  la IA misma ofreció como siguiente paso, para que el agente solo tenga
   *  que confirmar con Enter en vez de reescribirla. */
  useFollowUp(text: string): void {
    this.draftMessage.set(text);
  }

  onGoToItinerary(): void {
    this.goToItinerary.emit();
  }

  actionLabelsSummary(actions: ChatAction[]): string {
    return actions.map((a) => a.targetLabel).join(' · ');
  }

  hasPendingAction(actions: ChatAction[]): boolean {
    return actions.some((a) => a.appliedSuggestionIndex === null);
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

  /** Aplica UNA sugerencia de UNA acción del mensaje. Las escrituras pasan
   *  siempre por enqueueSave (una sola cadena secuencial compartida con
   *  "aplicar todos") para que dos campos nunca se pisen entre sí. */
  async applySuggestion(messageIndex: number, actionIndex: number, suggestionIndex: number): Promise<void> {
    const action = this.messages()[messageIndex]?.actions?.[actionIndex];
    const suggestionText = action?.suggestions[suggestionIndex];
    if (action === undefined || suggestionText === undefined) {
      return;
    }
    const target = this.findTarget(action.targetKey);
    if (!target) {
      return;
    }

    const key = `${messageIndex}:${actionIndex}:${suggestionIndex}`;
    this.applyingKey.set(key);
    this.applyError.set(null);

    await this.enqueueSave(async () => {
      if (!this.content) {
        return;
      }
      const nextContent = this.mutateContent(this.content, target, suggestionText);
      try {
        const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
        this.proposal = updated;
        this.content = updated.content;
        this.targetOptions.set(this.buildTargetOptions(updated.content));
        this.messages.update((items) =>
          items.map((m, i) =>
            i === messageIndex
              ? {
                  ...m,
                  actions: (m.actions ?? []).map((a, ai) =>
                    ai === actionIndex ? { ...a, appliedSuggestionIndex: suggestionIndex } : a
                  )
                }
              : m
          )
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

  /** "Aplicar todos" (sección 9 de la spec): requiere click explícito del
   *  usuario, nunca se dispara solo. Aplica, EN ORDEN (una escritura a la
   *  vez vía enqueueSave), la primera sugerencia de cada acción que todavía
   *  no fue aplicada — las acciones que el usuario ya resolvió a mano quedan
   *  intactas y no se tocan de nuevo. */
  async applyAllActions(messageIndex: number): Promise<void> {
    const pendingIndexes = (this.messages()[messageIndex]?.actions ?? [])
      .map((a, ai) => (a.appliedSuggestionIndex === null ? ai : null))
      .filter((ai): ai is number => ai !== null);
    if (pendingIndexes.length === 0) {
      return;
    }

    this.applyingAllIndex.set(messageIndex);
    for (const actionIndex of pendingIndexes) {
      await this.applySuggestion(messageIndex, actionIndex, 0);
    }
    this.applyingAllIndex.set(null);
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
