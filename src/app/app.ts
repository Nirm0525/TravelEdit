import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CustomCursor } from './features/custom-cursor/custom-cursor';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CustomCursor],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
