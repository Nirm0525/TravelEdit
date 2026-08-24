import { Component, ElementRef, HostListener, effect, input, output, viewChild } from '@angular/core';

@Component({
  selector: 'app-admin-modal',
  templateUrl: './admin-modal.html',
  styleUrl: './admin-modal.css'
})
export class AdminModal {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly closed = output<void>();

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    effect(() => {
      if (this.open()) {
        this.focusPanel();
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) {
      this.close();
    }
  }

  close(): void {
    this.closed.emit();
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  focusPanel(): void {
    this.panel()?.nativeElement.focus();
  }
}
