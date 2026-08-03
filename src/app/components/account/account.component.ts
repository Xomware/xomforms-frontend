import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CognitoService } from '../../services/cognito.service';

/**
 * Account page (route `/account`, creator-only via authGuard).
 *
 * Deliberately a read-only profile card for now. Saved preferences (default
 * timezone, default start interval) would need a users table that doesn't
 * exist yet, and shipping controls that silently don't persist is worse than
 * shipping none -- see docs/features/forms-polish/PLAN.md, Open Question 4.
 */
@Component({
  selector: 'app-account',
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.scss'],
})
export class AccountComponent {
  constructor(
    public cognito: CognitoService,
    private router: Router,
  ) {}

  signOut(): void {
    this.cognito.signOut().subscribe({
      next: () => this.router.navigate(['/']),
      error: () => this.router.navigate(['/']),
    });
  }

  /** Mirrors the header menu's fallback chain: name -> email local-part. */
  displayName(name?: string, email?: string): string {
    if (name?.trim()) return name.trim();
    return (email ?? '').split('@')[0] || 'Your account';
  }

  initials(name?: string, email?: string): string {
    const source = name?.trim() || (email ?? '').split('@')[0];
    const words = source.split(/[\s._-]+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }
}
