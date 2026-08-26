import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AdminSidebar } from '../../shared/ui/admin-sidebar/admin-sidebar';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, AdminSidebar],
  templateUrl: './shell.html',
  styleUrl: './shell.css'
})
export class Shell {
  readonly mobileSidebarOpen = signal(false);
}
