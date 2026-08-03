import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { XomUser } from '../../services/cognito.service';

/**
 * Avatar + account dropdown for the header.
 *
 * Replaces the raw email string that used to sit inline among the nav links.
 * Popover mechanics (outside-click, Escape) deliberately mirror `xf-select` and
 * `xf-date` so every dropdown in the app dismisses the same way.
 *
 * The pool may or may not supply `name`/`picture`, so this degrades in three
 * steps: picture -> initials from name -> initials from email.
 */
@Component({
  selector: 'xf-user-menu',
  templateUrl: './user-menu.component.html',
  styleUrls: ['./user-menu.component.scss'],
})
export class UserMenuComponent {
  @Input({ required: true }) user!: XomUser;
  @Output() signOut = new EventEmitter<void>();

  open = false;

  constructor(private host: ElementRef<HTMLElement>) {}

  /** Best available human label. Falls back to the email local-part. */
  get displayName(): string {
    if (this.user?.name?.trim()) return this.user.name.trim();
    const email = this.user?.email ?? '';
    const localPart = email.split('@')[0];
    return localPart || this.user?.username || 'Account';
  }

  /** True only when there's a real name to show ABOVE the email. */
  get hasDistinctName(): boolean {
    return !!this.user?.name?.trim();
  }

  get email(): string {
    return this.user?.email ?? '';
  }

  get avatarUrl(): string | null {
    return this.user?.picture?.trim() || null;
  }

  /** Up to two letters, from the name's words or the email local-part. */
  get initials(): string {
    const source = this.hasDistinctName ? this.displayName : (this.user?.email ?? '').split('@')[0];
    const words = source.split(/[\s._-]+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  toggle(): void {
    this.open = !this.open;
  }

  close(): void {
    this.open = false;
  }

  onSignOut(): void {
    this.open = false;
    this.signOut.emit();
  }

  /** The avatar <img> 404s silently otherwise; drop back to initials. */
  onAvatarError(): void {
    if (this.user) this.user.picture = undefined;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(ev.target as Node)) {
      this.open = false;
    }
  }

  @HostListener('keydown.escape')
  onEscape(): void {
    this.open = false;
  }
}
