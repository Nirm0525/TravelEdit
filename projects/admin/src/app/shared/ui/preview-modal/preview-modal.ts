import { Component, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

const DEVICE_WIDTH: Record<PreviewDevice, string> = {
  desktop: '100%',
  tablet: '48rem',
  mobile: '23.4375rem'
};

@Component({
  selector: 'app-preview-modal',
  imports: [],
  templateUrl: './preview-modal.html',
  styleUrl: './preview-modal.css'
})
export class PreviewModal {
  private readonly sanitizer = inject(DomSanitizer);

  /** Nula/vacía = modal cerrado. Se pasa una URL absoluta para abrirlo. */
  readonly url = input<string | null>(null);
  readonly closed = output<void>();

  readonly device = signal<PreviewDevice>('desktop');
  readonly deviceWidth = computed(() => DEVICE_WIDTH[this.device()]);
  readonly safeUrl = computed(() => {
    const url = this.url();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.url()) {
      this.close();
    }
  }

  setDevice(device: PreviewDevice): void {
    this.device.set(device);
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }
}
