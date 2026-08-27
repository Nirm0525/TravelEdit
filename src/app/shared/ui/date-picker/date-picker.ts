import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';

interface DayCell {
  date: Date;
  inCurrentMonth: boolean;
  disabled: boolean;
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_FORMATTER = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });
const DATE_FORMATTER = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' });

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Popover de calendario para elegir una fecha exacta — no reemplaza el campo
 * de texto que lo acompaña (sigue aceptando "March 2027" o "10 nights" tal
 * cual), solo escribe una fecha formateada ahí cuando el usuario prefiere
 * elegirla de un calendario en vez de tipearla.
 */
@Component({
  selector: 'app-date-picker',
  standalone: true,
  templateUrl: './date-picker.html',
  styleUrl: './date-picker.css'
})
export class DatePicker {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly label = input('Choose a date');
  readonly minDate = input<Date | null>(startOfDay(new Date()));

  readonly dateSelected = output<string>();

  readonly open = signal(false);
  private readonly viewDate = signal(startOfDay(new Date()));

  readonly monthLabel = computed(() => MONTH_FORMATTER.format(this.viewDate()));
  readonly weekdayLabels = WEEKDAY_LABELS;

  readonly weeks = computed<DayCell[][]>(() => {
    const view = this.viewDate();
    const min = this.minDate();
    const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());

    const cells: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + i);
      cells.push({
        date,
        inCurrentMonth: date.getMonth() === view.getMonth(),
        disabled: !!min && date < min
      });
    }

    const weeks: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  });

  readonly canGoPrevMonth = computed(() => {
    const min = this.minDate();
    if (!min) {
      return true;
    }
    const view = this.viewDate();
    return view.getFullYear() > min.getFullYear() || view.getMonth() > min.getMonth();
  });

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    const min = this.minDate();
    this.viewDate.set(min && min > startOfDay(new Date()) ? new Date(min.getFullYear(), min.getMonth(), 1) : startOfDay(new Date()));
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }

  prevMonth(): void {
    if (!this.canGoPrevMonth()) {
      return;
    }
    const view = this.viewDate();
    this.viewDate.set(new Date(view.getFullYear(), view.getMonth() - 1, 1));
  }

  nextMonth(): void {
    const view = this.viewDate();
    this.viewDate.set(new Date(view.getFullYear(), view.getMonth() + 1, 1));
  }

  selectDay(cell: DayCell): void {
    if (cell.disabled) {
      return;
    }
    this.dateSelected.emit(DATE_FORMATTER.format(cell.date));
    this.close();
  }

  isToday(date: Date): boolean {
    return startOfDay(date).getTime() === startOfDay(new Date()).getTime();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) {
      return;
    }
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }
}
