import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface BreadcrumbItem {
  label: string;
  link?: string;
}

@Component({
  selector: 'app-admin-page-header',
  imports: [RouterLink],
  templateUrl: './admin-page-header.html',
  styleUrl: './admin-page-header.css'
})
export class AdminPageHeader {
  readonly breadcrumb = input<BreadcrumbItem[] | null>(null);
  readonly title = input.required<string>();
}
