import { TRAVEL_CONFIG, TravelCapabilities } from '../../../travel/travel-config';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ProposalsService } from '../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../core/services/proposal-images';
import { LeadsService } from '../../../../core/services/leads';
import { Proposal, ProposalContent, defaultWelcomeText } from '../../../../core/models/proposal.model';
import { DEFAULT_TERMS_HTML, termsHasPlaceholders } from '../../../../core/data/proposal-default-terms';
import { PROPOSAL_CURRENCY_OPTIONS } from '../../../../core/data/proposal-options';
import { ImageUploader, ReadyImage } from '../../../../shared/ui/image-uploader/image-uploader';
import { RichTextEditor } from '../../../../shared/ui/rich-text-editor/rich-text-editor';
import { fromDatetimeLocal, isPlausibleDatetimeLocal, toDatetimeLocal } from '../../../../core/utils/datetime-local';

type TopLevelField = 'clientName' | 'clientEmail' | 'destinationText' | 'startDate' | 'endDate' | 'travelersCount' | 'expiresAt';
export type ClientTripSection = 'client-trip' | 'cover' | 'terms';

@Component({
  selector: 'app-client-trip-step',
  imports: [ReactiveFormsModule, ImageUploader, RichTextEditor],
  templateUrl: './client-trip-step.html',
  styleUrl: './client-trip-step.css'
})
export class ClientTripStep implements OnInit {
  private readonly proposalsService = inject(ProposalsService);
  private readonly proposalImages = inject(ProposalImagesService);
  private readonly fb = inject(FormBuilder);
  private readonly leadsService = inject(LeadsService);

  /** Correo de la solicitud vinculada (si la hay): es el destinatario por defecto
   *  del envío, así que no se vuelve a pedir — solo se muestra. */
  readonly leadEmail = signal<string | null>(null);

  readonly proposalId = input.required<string>();
  readonly activeSection = input<ClientTripSection>('client-trip');
  /** Qué piezas del formulario ofrece el modo (Propuesta o Itinerario): correo, moneda, expiración y acceso privado. */
  readonly capabilities = input<TravelCapabilities>(TRAVEL_CONFIG.proposal.capabilities);
  /** «propuesta» o «itinerario», para los títulos visibles. */
  readonly subject = input<string>('propuesta');
  readonly saved = output<void>();
  /** El codigo en texto plano solo existe en esta sesion: se avisa al padre para precargarlo en el mensaje de WhatsApp. */
  readonly codeGenerated = output<string>();
  /** Emite la target key de ai-polish-step (ver buildTargetOptions ahí) que
   *  el shell debe preseleccionar al activar The Edit Assistant desde un
   *  botón ✨ contextual — nunca llama a OpenAI directo, solo cambia de tab. */
  readonly openAssistant = output<string>();

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly savingField = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly savedFlash = signal(false);

  /** Expiración tal como quedó guardada en la base (ISO) — para mostrar si el enlace sigue vigente. */
  private readonly expiresAtSaved = signal<string | null>(null);
  readonly expiryStatus = computed<{ text: string; expired: boolean }>(() => {
    const iso = this.expiresAtSaved();
    if (!iso) {
      return { text: 'Sin fecha de expiración: el acceso no vence.', expired: false };
    }
    const date = new Date(iso);
    const label = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeStyle: 'short' }).format(date);
    return date.getTime() > Date.now()
      ? { text: `Guardado: el cliente puede entrar con su código hasta el ${label}.`, expired: false }
      : { text: `Guardado: el acceso venció el ${label}. Elige una fecha futura (o borra la fecha) para reactivarlo.`, expired: true };
  });

  readonly currencyOptions = PROPOSAL_CURRENCY_OPTIONS;

  private proposal: Proposal | null = null;
  private content: ProposalContent | null = null;

  readonly coverImageUrl = signal<string | null>(null);
  readonly uploadingCover = signal(false);
  readonly uploadError = signal<string | null>(null);

  /** null mientras se desconoce (recién montado); true/false una vez que
   *  load() consulta proposal_has_access_code() — nunca se infiere del
   *  hash, que este componente ni siquiera puede leer. */
  readonly hasAccessCode = signal<boolean | null>(null);
  /** El código en texto plano vive ÚNICAMENTE en este signal, solo mientras
   *  dura esta sesión del componente — nunca en localStorage/sessionStorage/
   *  `content`/ninguna columna. Se genera server-side (ver
   *  generate_proposal_access_code) y no hay forma de recuperarlo después:
   *  si se navega a otra pestaña o se recarga, se pierde a propósito (ver
   *  sección E/Q de la spec — nunca hay un código "todavía disponible"). */
  readonly generatedCode = signal<string | null>(null);
  readonly generatingCode = signal(false);
  readonly generateCodeError = signal<string | null>(null);
  readonly codeCopied = signal(false);

  readonly form = this.fb.group({
    clientName: this.fb.control('', { nonNullable: true }),
    clientEmail: this.fb.control('', { nonNullable: true, validators: [Validators.email] }),
    destinationText: this.fb.control('', { nonNullable: true }),
    startDate: this.fb.control('', { nonNullable: true }),
    endDate: this.fb.control('', { nonNullable: true }),
    travelersCount: this.fb.control<number | null>(null),
    currency: this.fb.control('USD', { nonNullable: true }),
    accessRequired: this.fb.control(true, { nonNullable: true }),
    expiresAt: this.fb.control('', { nonNullable: true }),
    coverTitle: this.fb.control('', { nonNullable: true }),
    coverSubtitle: this.fb.control('', { nonNullable: true }),
    welcomeBody: this.fb.control('', { nonNullable: true }),
    introHeadline: this.fb.control('', { nonNullable: true }),
    introBody: this.fb.control('', { nonNullable: true }),
    termsTitle: this.fb.control('', { nonNullable: true }),
    termsBody: this.fb.control('', { nonNullable: true })
  });

  /** Igual patrón que ArticleImagesService.uploadBodyImage(): RichTextEditor
   *  necesita la URL completa de inmediato para insertarla en el editor, no
   *  el storage_path relativo que se persiste en `content`. */
  readonly bodyImageUpload = async (file: File): Promise<string> => {
    const path = await this.proposalImages.upload(file);
    return this.proposalImages.publicUrl(path)!;
  };

  // No en el constructor: los inputs (incluido proposalId, required) todavía
  // no tienen valor en ese punto del ciclo de vida — leerlo ahí dispara
  // NG0950 (confirmado en QA real: el error solo aparece en el navegador
  // real, nunca en build/typecheck). ngOnInit() corre después de que
  // Angular aplica los inputs, y proposalId no cambia durante la vida de
  // esta instancia (el padre la recrea entera con @switch al cambiar de
  // paso), así que no hace falta un effect() reactivo como en
  // article-detail.ts del sitio público (ese sí necesita reaccionar a que
  // el mismo componente reciba un slug distinto sin recrearse).
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
      this.form.patchValue({
        clientName: proposal.clientName,
        clientEmail: proposal.clientEmail ?? '',
        destinationText: proposal.destinationText ?? '',
        startDate: proposal.startDate ?? '',
        endDate: proposal.endDate ?? '',
        travelersCount: proposal.travelersCount,
        currency: proposal.currency,
        accessRequired: proposal.accessRequired,
        // Hora LOCAL (no slice(0, 16), que mostraba la hora UTC como si fuera local).
        expiresAt: toDatetimeLocal(proposal.expiresAt),
        coverTitle: proposal.content.cover.title,
        coverSubtitle: proposal.content.cover.subtitle,
        welcomeBody: proposal.content.welcome.body,
        introHeadline: proposal.content.intro.headline,
        introBody: proposal.content.intro.body,
        termsTitle: proposal.content.terms.title,
        termsBody: proposal.content.terms.body
      });
      this.expiresAtSaved.set(proposal.expiresAt);
      this.coverImageUrl.set(this.proposalImages.publicUrl(proposal.content.cover.imagePath));
      if (proposal.leadId) {
        // Solo informativo: si falla la lectura, el campo funciona igual.
        void this.leadsService
          .getById(proposal.leadId)
          .then((lead) => this.leadEmail.set(lead?.email ?? null))
          .catch(() => this.leadEmail.set(null));
      }
      if (this.capabilities().privateAccess && this.capabilities().accessCode) {
        this.hasAccessCode.set(await this.proposalsService.hasAccessCode(this.proposalId()));
      }
    } catch (error) {
      console.error('No se pudo cargar la propuesta.', error);
      this.loadError.set('No se pudo cargar la propuesta. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  private flashSaved(): void {
    this.savedFlash.set(true);
    setTimeout(() => this.savedFlash.set(false), 1500);
    this.saved.emit();
  }

  // Bug real encontrado en QA: cada método de guardado hacía "leer form ->
  // actualizar fila completa" de forma independiente. Cambiar dos campos
  // rápido (ej. fecha de fin y viajeros, con un solo tab entre medio)
  // disparaba dos guardados en paralelo; el que resolvía último ganaba y
  // pisaba al otro con una foto del form tomada ANTES de que el segundo
  // campo se hubiera escrito -- travelersCount volvía a quedar vacío
  // después de recargar, aunque el resto del formulario se había guardado
  // bien. La cola serializa los guardados y cada uno lee this.form/
  // this.content recién en su turno (no al momento del blur), así que
  // siempre parte del último estado ya confirmado, nunca de uno viejo.
  private saveChain: Promise<void> = Promise.resolve();
  private enqueueSave(work: () => Promise<void>): Promise<void> {
    const run = this.saveChain.then(work);
    this.saveChain = run.catch(() => undefined);
    return run;
  }

  /** Autoguardado por campo, al perder foco -- mismo criterio que
   *  destination-form/itinerario (onFieldBlur): sin botón "Guardar" separado. */
  saveField(field: TopLevelField): Promise<void> {
    return this.enqueueSave(async () => {
      const raw = this.form.getRawValue();
      // La expiración solo se envía al editar ESE campo: antes viajaba en cada guardado de
      // cualquier otro campo, re-escribiendo (y desplazando) una fecha que nadie tocó.
      let expiresAt: string | null | undefined;
      if (field === 'expiresAt') {
        if (raw.expiresAt && !isPlausibleDatetimeLocal(raw.expiresAt)) {
          return; // valor a medias mientras se escribe el año: no se guarda
        }
        expiresAt = fromDatetimeLocal(raw.expiresAt);
      }
      this.savingField.set(field);
      this.saveError.set(null);
      try {
        const updated = await this.proposalsService.update(this.proposalId(), {
          clientName: raw.clientName,
          // Solo se manda al editar ese campo (así guardar el resto no depende de que
          // la migración 0045 esté aplicada) y nunca con un formato inválido.
          clientEmail:
            field === 'clientEmail' && this.form.controls.clientEmail.valid ? raw.clientEmail.trim() || null : undefined,
          destinationText: raw.destinationText || null,
          startDate: raw.startDate || null,
          endDate: raw.endDate || null,
          travelersCount: raw.travelersCount,
          expiresAt
        });
        this.proposal = updated;
        this.expiresAtSaved.set(updated.expiresAt);
        this.flashSaved();
      } catch (error) {
        console.error('No se pudo guardar la propuesta.', error);
        this.saveError.set('No se pudo guardar. Inténtalo nuevamente.');
      } finally {
        this.savingField.set(null);
      }
    });
  }

  onCurrencyChange(event: Event): Promise<void> {
    const currency = (event.target as HTMLSelectElement).value;
    return this.enqueueSave(async () => {
      this.savingField.set('currency');
      this.saveError.set(null);
      try {
        this.proposal = await this.proposalsService.update(this.proposalId(), { currency });
        this.flashSaved();
      } catch (error) {
        console.error('No se pudo guardar la moneda.', error);
        this.saveError.set('No se pudo guardar. Inténtalo nuevamente.');
      } finally {
        this.savingField.set(null);
      }
    });
  }

  onAccessRequiredChange(event: Event): Promise<void> {
    const accessRequired = (event.target as HTMLInputElement).checked;
    return this.enqueueSave(async () => {
      this.savingField.set('accessRequired');
      this.saveError.set(null);
      try {
        this.proposal = await this.proposalsService.update(this.proposalId(), { accessRequired });
        this.flashSaved();
      } catch (error) {
        console.error('No se pudo guardar el acceso.', error);
        this.saveError.set('No se pudo guardar. Inténtalo nuevamente.');
      } finally {
        this.savingField.set(null);
      }
    });
  }

  saveCover(): Promise<void> {
    return this.enqueueSave(async () => {
      if (!this.content) {
        return;
      }
      this.savingField.set('cover');
      this.saveError.set(null);
      const raw = this.form.getRawValue();
      const nextContent: ProposalContent = {
        ...this.content,
        cover: { ...this.content.cover, title: raw.coverTitle, subtitle: raw.coverSubtitle }
      };
      try {
        const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
        this.proposal = updated;
        this.content = updated.content;
        this.flashSaved();
      } catch (error) {
        console.error('No se pudo guardar la portada.', error);
        this.saveError.set('No se pudo guardar. Inténtalo nuevamente.');
      } finally {
        this.savingField.set(null);
      }
    });
  }

  welcomeIsEmpty(): boolean {
    return this.form.controls.welcomeBody.value.replace(/<[^>]*>/g, '').trim().length === 0;
  }

  /** Rellena el editor con el borrador (nombre del cliente incluido) y lo
   *  guarda — solo se ofrece con el campo vacío, nunca pisa texto escrito. */
  generateWelcome(): Promise<void> {
    const text = defaultWelcomeText(this.form.controls.clientName.value, this.proposal?.kind);
    const escape = (line: string) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${escape(line)}</p>`)
      .join('');
    this.form.controls.welcomeBody.setValue(html);
    return this.saveWelcome();
  }

  saveWelcome(): Promise<void> {
    return this.enqueueSave(async () => {
      if (!this.content) {
        return;
      }
      this.savingField.set('welcome');
      this.saveError.set(null);
      const nextContent: ProposalContent = {
        ...this.content,
        welcome: { body: this.form.getRawValue().welcomeBody }
      };
      try {
        const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
        this.proposal = updated;
        this.content = updated.content;
        this.flashSaved();
      } catch (error) {
        console.error('No se pudo guardar el mensaje de bienvenida.', error);
        this.saveError.set('No se pudo guardar. Inténtalo nuevamente.');
      } finally {
        this.savingField.set(null);
      }
    });
  }

  saveIntro(): Promise<void> {
    return this.enqueueSave(async () => {
      if (!this.content) {
        return;
      }
      this.savingField.set('intro');
      this.saveError.set(null);
      const raw = this.form.getRawValue();
      const nextContent: ProposalContent = {
        ...this.content,
        intro: { headline: raw.introHeadline, body: raw.introBody }
      };
      try {
        const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
        this.proposal = updated;
        this.content = updated.content;
        this.flashSaved();
      } catch (error) {
        console.error('No se pudo guardar la introducción.', error);
        this.saveError.set('No se pudo guardar. Inténtalo nuevamente.');
      } finally {
        this.savingField.set(null);
      }
    });
  }

  termsIsEmpty(): boolean {
    return this.form.controls.termsBody.value.replace(/<[^>]*>/g, '').trim().length === 0;
  }

  /** Avisa mientras el texto siga teniendo campos [entre corchetes] por completar. */
  termsHavePlaceholders(): boolean {
    return termsHasPlaceholders(this.form.controls.termsBody.value);
  }

  /** Carga los términos de partida (solo se ofrece con el campo vacío — nunca
   *  pisa un texto ya escrito) y los guarda; el agente los edita después. */
  loadDefaultTerms(): Promise<void> {
    this.form.controls.termsBody.setValue(DEFAULT_TERMS_HTML);
    return this.saveTerms();
  }

  saveTerms(): Promise<void> {
    return this.enqueueSave(async () => {
      if (!this.content) {
        return;
      }
      this.savingField.set('terms');
      this.saveError.set(null);
      const raw = this.form.getRawValue();
      const nextContent: ProposalContent = {
        ...this.content,
        terms: { title: raw.termsTitle, body: raw.termsBody }
      };
      try {
        const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
        this.proposal = updated;
        this.content = updated.content;
        this.flashSaved();
      } catch (error) {
        console.error('No se pudo guardar los términos.', error);
        this.saveError.set('No se pudo guardar. Inténtalo nuevamente.');
      } finally {
        this.savingField.set(null);
      }
    });
  }

  onCoverImageSelected(images: ReadyImage[]): Promise<void> {
    const image = images[0];
    if (!image) {
      return Promise.resolve();
    }
    return this.enqueueSave(async () => {
      if (!this.content) {
        return;
      }
      this.uploadingCover.set(true);
      this.uploadError.set(null);
      try {
        const path = await this.proposalImages.upload(image.file);
        const nextContent: ProposalContent = { ...this.content, cover: { ...this.content.cover, imagePath: path } };
        const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
        this.proposal = updated;
        this.content = updated.content;
        this.coverImageUrl.set(this.proposalImages.publicUrl(path));
        this.flashSaved();
      } catch (error) {
        console.error('No se pudo subir la imagen de portada.', error);
        this.uploadError.set(error instanceof Error ? error.message : 'No se pudo subir la imagen.');
      } finally {
        this.uploadingCover.set(false);
      }
    });
  }

  removeCoverImage(): Promise<void> {
    return this.enqueueSave(async () => {
      if (!this.content?.cover.imagePath) {
        return;
      }
      const previousPath = this.content.cover.imagePath;
      this.uploadingCover.set(true);
      this.uploadError.set(null);
      try {
        const nextContent: ProposalContent = { ...this.content, cover: { ...this.content.cover, imagePath: null } };
        const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
        this.proposal = updated;
        this.content = updated.content;
        this.coverImageUrl.set(null);
        this.flashSaved();
        // Best-effort: si falla el borrado del storage, el archivo queda
        // huérfano pero content ya no lo referencia — no es un error visible.
        await this.proposalImages.remove(previousPath).catch(() => {});
      } catch (error) {
        console.error('No se pudo quitar la imagen de portada.', error);
        this.uploadError.set('No se pudo quitar la imagen. Inténtalo nuevamente.');
      } finally {
        this.uploadingCover.set(false);
      }
    });
  }

  /** Genera (o regenera) el código — misma acción para ambos casos, la RPC
   *  ya hace upsert+reset+revocación de sesiones. El código plano solo se
   *  guarda en `generatedCode` para mostrarlo una vez; nunca se envía a
   *  ningún otro método ni se persiste acá. */
  async generateCode(): Promise<void> {
    if (this.generatingCode()) {
      return;
    }
    this.generatingCode.set(true);
    this.generateCodeError.set(null);
    try {
      const code = await this.proposalsService.generateAccessCode(this.proposalId());
      this.generatedCode.set(code);
      this.codeGenerated.emit(code);
      this.hasAccessCode.set(true);
    } catch (error) {
      console.error('No se pudo generar el código de acceso.', error);
      this.generateCodeError.set('No se pudo generar el código. Inténtalo nuevamente.');
    } finally {
      this.generatingCode.set(false);
    }
  }

  async copyGeneratedCode(): Promise<void> {
    const code = this.generatedCode();
    if (!code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      this.codeCopied.set(true);
      setTimeout(() => this.codeCopied.set(false), 2000);
    } catch (error) {
      console.error('No se pudo copiar el código.', error);
    }
  }
}
