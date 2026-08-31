import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, forwardRef, input, signal, viewChild } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

// Tiptap no publica un extension-font-size para v2: el patrón oficial es
// declarar el atributo `fontSize` sobre la marca textStyle a mano.
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() {
    return { types: ['textStyle'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: { fontSize?: string | null }) =>
              attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {}
          }
        }
      }
    ];
  }
});

export const BRAND_FONTS = [
  { label: 'Predeterminada', value: null },
  { label: 'Poppins (texto)', value: 'Poppins, sans-serif' },
  { label: 'Ws Paradose (título)', value: '"Ws Paradose", "Cormorant", serif' }
] as const;

export const BRAND_FONT_SIZES = [
  { label: 'Predeterminado', value: null },
  { label: 'Pequeño', value: '0.875rem' },
  { label: 'Normal', value: '1.0625rem' },
  { label: 'Mediano', value: '1.25rem' },
  { label: 'Grande', value: '1.5rem' },
  { label: 'Titular', value: '2rem' }
] as const;

export const BRAND_TEXT_COLORS = [
  { label: 'Tinta', value: '#16110F' },
  { label: 'Borgoña', value: '#7A2338' },
  { label: 'Vino', value: '#6D2A34' },
  { label: 'Oro', value: '#C79A5B' },
  { label: 'Piedra', value: '#8A7F76' },
  { label: 'Beige cálido', value: '#CAAE97' }
] as const;

export const BRAND_HIGHLIGHT_COLORS = [
  { label: 'Oro', value: 'color-mix(in srgb, #C79A5B 30%, white)' },
  { label: 'Borgoña', value: 'color-mix(in srgb, #7A2338 16%, white)' },
  { label: 'Vino', value: 'color-mix(in srgb, #6D2A34 16%, white)' },
  { label: 'Beige cálido', value: 'color-mix(in srgb, #CAAE97 45%, white)' },
  { label: 'Crema', value: '#F6EFE6' }
] as const;

type HeadingLevel = 1 | 2 | 3 | 4;
type Align = 'left' | 'center' | 'right' | 'justify';

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  headingLevel: HeadingLevel | null;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  align: Align;
  link: boolean;
  textColor: string | null;
  highlightColor: string | null;
  fontFamily: string | null;
  fontSize: string | null;
}

@Component({
  selector: 'app-rich-text-editor',
  imports: [],
  templateUrl: './rich-text-editor.html',
  styleUrl: './rich-text-editor.css',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichTextEditor),
      multi: true
    }
  ]
})
export class RichTextEditor implements ControlValueAccessor, AfterViewInit, OnDestroy {
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  private readonly hostEl = viewChild.required<ElementRef<HTMLElement>>('root');
  private editor?: Editor;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  private pendingValue = '';

  // Guard defensivo: durante un cambio de contenido programático (carga
  // inicial en ngAfterViewInit, o writeValue() desde Angular Forms) Tiptap no
  // debería emitir 'update' — setContent(value, false) ya se lo pide — pero
  // este flag evita que cualquier onUpdate que ocurra en esa ventana llegue a
  // propagarse como si fuera edición real del usuario.
  private isProgrammaticUpdate = false;

  /** Cuando se define, el botón de imagen sube el archivo con esta función en vez de pedir una URL. */
  readonly imageUpload = input<((file: File) => Promise<string>) | null>(null);

  readonly fonts = BRAND_FONTS;
  readonly fontSizes = BRAND_FONT_SIZES;
  readonly textColors = BRAND_TEXT_COLORS;
  readonly highlightColors = BRAND_HIGHLIGHT_COLORS;

  readonly disabled = signal(false);
  readonly fullscreen = signal(false);
  readonly htmlSourceMode = signal(false);
  readonly htmlSourceValue = signal('');
  readonly colorMenuOpen = signal(false);
  readonly highlightMenuOpen = signal(false);
  readonly uploadingImage = signal(false);

  readonly active = signal<ToolbarState>({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    code: false,
    headingLevel: null,
    bulletList: false,
    orderedList: false,
    taskList: false,
    blockquote: false,
    align: 'left',
    link: false,
    textColor: null,
    highlightColor: null,
    fontFamily: null,
    fontSize: null
  });

  ngAfterViewInit(): void {
    this.isProgrammaticUpdate = true;
    this.editor = new Editor({
      element: this.host().nativeElement,
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
        Underline,
        TextStyle,
        Color.configure({ types: ['textStyle'] }),
        FontFamily.configure({ types: ['textStyle'] }),
        FontSize,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' }
        }),
        Image,
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell
      ],
      content: this.pendingValue,
      editable: !this.disabled(),
      onUpdate: ({ editor }) => {
        if (this.isProgrammaticUpdate) {
          return;
        }
        this.onChange(editor.getHTML());
      },
      onBlur: () => this.onTouched(),
      onTransaction: ({ editor }) => this.syncActiveState(editor)
    });
    this.isProgrammaticUpdate = false;
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
  }

  writeValue(value: string): void {
    this.pendingValue = value ?? '';
    if (this.editor) {
      this.isProgrammaticUpdate = true;
      this.editor.commands.setContent(this.pendingValue, false);
      this.isProgrammaticUpdate = false;
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
    this.editor?.setEditable(!isDisabled);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const root = this.hostEl()?.nativeElement;
    if (root && !root.contains(event.target as Node)) {
      this.colorMenuOpen.set(false);
      this.highlightMenuOpen.set(false);
      return;
    }
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="color"]')) {
      this.colorMenuOpen.set(false);
    }
    if (!target.closest('[data-dropdown="highlight"]')) {
      this.highlightMenuOpen.set(false);
    }
  }

  toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  toggleUnderline(): void {
    this.editor?.chain().focus().toggleUnderline().run();
  }

  toggleStrike(): void {
    this.editor?.chain().focus().toggleStrike().run();
  }

  toggleCode(): void {
    this.editor?.chain().focus().toggleCode().run();
  }

  setBlockType(value: string): void {
    if (!this.editor) {
      return;
    }
    if (value === 'p') {
      this.editor.chain().focus().setParagraph().run();
      return;
    }
    const level = Number(value) as HeadingLevel;
    this.editor.chain().focus().toggleHeading({ level }).run();
  }

  toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  toggleTaskList(): void {
    this.editor?.chain().focus().toggleTaskList().run();
  }

  toggleBlockquote(): void {
    this.editor?.chain().focus().toggleBlockquote().run();
  }

  setAlign(align: Align): void {
    this.editor?.chain().focus().setTextAlign(align).run();
  }

  insertHorizontalRule(): void {
    this.editor?.chain().focus().setHorizontalRule().run();
  }

  toggleColorMenu(): void {
    this.highlightMenuOpen.set(false);
    this.colorMenuOpen.update((open) => !open);
  }

  toggleHighlightMenu(): void {
    this.colorMenuOpen.set(false);
    this.highlightMenuOpen.update((open) => !open);
  }

  setTextColor(color: string | null): void {
    if (color) {
      this.editor?.chain().focus().setColor(color).run();
    } else {
      this.editor?.chain().focus().unsetColor().run();
    }
    this.colorMenuOpen.set(false);
  }

  setHighlightColor(color: string | null): void {
    if (color) {
      this.editor?.chain().focus().setHighlight({ color }).run();
    } else {
      this.editor?.chain().focus().unsetHighlight().run();
    }
    this.highlightMenuOpen.set(false);
  }

  setFontFamily(value: string): void {
    if (!this.editor) {
      return;
    }
    if (!value) {
      this.editor.chain().focus().unsetFontFamily().run();
    } else {
      this.editor.chain().focus().setFontFamily(value).run();
    }
  }

  setFontSize(value: string): void {
    if (!this.editor) {
      return;
    }
    if (!value) {
      this.editor.chain().focus().setMark('textStyle', { fontSize: null }).run();
    } else {
      this.editor.chain().focus().setMark('textStyle', { fontSize: value }).run();
    }
  }

  setLink(): void {
    if (!this.editor) {
      return;
    }
    const current = this.editor.getAttributes('link')['href'] as string | undefined;
    const url = window.prompt('URL del enlace', current ?? 'https://');
    if (url === null) {
      return;
    }
    if (!url.trim()) {
      this.editor.chain().focus().unsetLink().run();
      return;
    }
    this.editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  insertTable(): void {
    this.editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  clearFormatting(): void {
    this.editor?.chain().focus().clearNodes().unsetAllMarks().run();
  }

  triggerImageUpload(fileInput: HTMLInputElement): void {
    if (this.imageUpload()) {
      fileInput.click();
      return;
    }
    const url = window.prompt('URL de la imagen');
    if (url?.trim()) {
      this.editor?.chain().focus().setImage({ src: url.trim() }).run();
    }
  }

  async onImageFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const upload = this.imageUpload();
    if (!file || !upload) {
      return;
    }
    this.uploadingImage.set(true);
    try {
      const url = await upload(file);
      this.editor?.chain().focus().setImage({ src: url }).run();
    } finally {
      this.uploadingImage.set(false);
    }
  }

  toggleFullscreen(): void {
    this.fullscreen.update((value) => !value);
  }

  toggleHtmlSource(): void {
    if (!this.editor) {
      return;
    }
    if (!this.htmlSourceMode()) {
      this.htmlSourceValue.set(this.editor.getHTML());
      this.htmlSourceMode.set(true);
    } else {
      this.editor.commands.setContent(this.htmlSourceValue(), true);
      this.onChange(this.editor.getHTML());
      this.htmlSourceMode.set(false);
    }
  }

  onHtmlSourceInput(value: string): void {
    this.htmlSourceValue.set(value);
  }

  private syncActiveState(editor: Editor): void {
    const headingLevel = ([1, 2, 3, 4] as HeadingLevel[]).find((level) => editor.isActive('heading', { level })) ?? null;
    const align = (['left', 'center', 'right', 'justify'] as Align[]).find((value) => editor.isActive({ textAlign: value })) ?? 'left';

    this.active.set({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      code: editor.isActive('code'),
      headingLevel,
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      taskList: editor.isActive('taskList'),
      blockquote: editor.isActive('blockquote'),
      align,
      link: editor.isActive('link'),
      textColor: (editor.getAttributes('textStyle')['color'] as string | undefined) ?? null,
      highlightColor: (editor.getAttributes('highlight')['color'] as string | undefined) ?? null,
      fontFamily: (editor.getAttributes('textStyle')['fontFamily'] as string | undefined) ?? null,
      fontSize: (editor.getAttributes('textStyle')['fontSize'] as string | undefined) ?? null
    });
  }
}
