import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: '../login/login.css'
})
export class ForgotPassword {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthService);

  readonly form = this.fb.group({
    email: this.fb.control('', [Validators.required, Validators.email])
  });

  readonly submitting = signal(false);
  // Siempre se muestra el mismo mensaje de éxito exista o no ese correo entre
  // el staff — así esta pantalla no sirve para averiguar qué correos están
  // registrados en el panel.
  readonly sent = signal(false);
  readonly errorMessage = signal<string | null>(null);

  async submit(): Promise<void> {
    if (this.submitting() || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const { email } = this.form.getRawValue();
    const { error } = await this.auth.resetPasswordForEmail(email);

    this.submitting.set(false);

    if (error) {
      this.errorMessage.set(error);
      return;
    }

    this.sent.set(true);
  }
}
