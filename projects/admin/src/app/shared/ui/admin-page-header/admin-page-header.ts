import { Component, input } from '@angular/core';

@Component({
  selector: 'app-admin-page-header',
  templateUrl: './admin-page-header.html',
  styleUrl: './admin-page-header.css'
})
export class AdminPageHeader {
  readonly breadcrumb = input<string | null>(null);
  readonly title = input.required<string>();
}
