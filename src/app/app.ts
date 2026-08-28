import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CustomCursor } from './features/custom-cursor/custom-cursor';
import { LoadingScreen } from './features/loading-screen/loading-screen';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CustomCursor, LoadingScreen],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
