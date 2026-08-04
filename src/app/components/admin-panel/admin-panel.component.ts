import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { InvitesService } from '../../services/invites.service';
import { PollsService, UpdatePollSettings } from '../../services/polls.service';
import { TIME_FILTERS, TimeFilterId } from '../availability-grid/availability-grid.component';
import {
  FormInvite,
  Poll,
  ResultsVisibility,
  allowsResponseEdits,
  effectiveVisibility,
} from '../../models/poll.model';

interface VisibilityChoice {
  value: ResultsVisibility;
  label: string;
  hint: string;
}

const VISIBILITY_CHOICES: VisibilityChoice[] = [
  {
    value: 'hidden',
    label: 'Only me',
    hint: 'Respondents never see the results.',
  },
  {
    value: 'after_response',
    label: 'After they respond',
    hint: "They see everyone's answers once they've submitted their own.",
  },
  {
    value: 'always',
    label: 'Anyone with the link',
    hint: 'Results are visible before responding.',
  },
];

/**
 * Creator-only admin surface for one form: the share link, email invites, and
 * the settings that govern how respondents experience it.
 *
 * Separate from the results view because these are two different jobs --
 * reading answers versus running the form -- and because everything here is
 * creator-only, while results can be shared.
 */
@Component({
  selector: 'app-admin-panel',
  templateUrl: './admin-panel.component.html',
  styleUrls: ['./admin-panel.component.scss'],
})
export class AdminPanelComponent implements OnInit {
  @Input({ required: true }) poll!: Poll;
  /** Emitted with the updated poll so the parent can refresh its own copy. */
  @Output() pollChange = new EventEmitter<Poll>();

  readonly visibilityChoices = VISIBILITY_CHOICES;
  /** Every quick filter a creator can offer respondents. */
  readonly quickFilterChoices = TIME_FILTERS;

  // ── Invites ────────────────────────────────────────────────────────
  recipientsRaw = '';
  sending = false;
  inviteError = '';
  inviteSummary = '';
  invites: FormInvite[] = [];
  invitesLoading = false;

  // ── Settings ───────────────────────────────────────────────────────
  savingSetting = '';
  settingsError = '';
  /** Local draft so typing doesn't fire a save on every keystroke. */
  instructionsDraft = '';

  constructor(
    private invitesService: InvitesService,
    private pollsService: PollsService,
  ) {}

  ngOnInit(): void {
    this.instructionsDraft = this.poll.instructions ?? '';
    this.loadInvites();
  }

  get instructionsDirty(): boolean {
    return this.instructionsDraft.trim() !== (this.poll.instructions ?? '').trim();
  }

  saveInstructions(): void {
    if (!this.instructionsDirty) return;
    this.save({ instructions: this.instructionsDraft.trim() }, 'instructions');
  }

  // ── Share link ─────────────────────────────────────────────────────
  get shareUrl(): string {
    return `${window.location.origin}/f/${this.poll.pollId}`;
  }

  copied = false;

  copyShareLink(): void {
    navigator.clipboard?.writeText(this.shareUrl).then(
      () => {
        this.copied = true;
        setTimeout(() => (this.copied = false), 2000);
      },
      () => {
        /* clipboard denied -- the link is still visible and selectable */
      },
    );
  }

  // ── Invites ────────────────────────────────────────────────────────
  loadInvites(): void {
    this.invitesLoading = true;
    this.invitesService.list(this.poll.pollId).subscribe({
      next: (res) => {
        this.invites = res.invites ?? [];
        this.invitesLoading = false;
      },
      error: () => {
        this.invitesLoading = false;
      },
    });
  }

  /**
   * Split the textarea on commas, semicolons, and newlines so a list pasted
   * from anywhere works without the user having to reformat it.
   */
  get parsedRecipients(): string[] {
    return this.recipientsRaw
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  get recipientCount(): number {
    return new Set(this.parsedRecipients).size;
  }

  get canSend(): boolean {
    return !this.sending && this.recipientCount > 0;
  }

  sendInvites(): void {
    if (!this.canSend) return;
    this.sending = true;
    this.inviteError = '';
    this.inviteSummary = '';

    const recipients = Array.from(new Set(this.parsedRecipients)).map((email) => ({ email }));

    this.invitesService.send(this.poll.pollId, recipients).subscribe({
      next: (res) => {
        this.sending = false;
        this.recipientsRaw = '';
        this.invites = res.results ?? [];
        // Report failures explicitly -- a partially delivered batch that reads
        // as "sent" is how people think they invited someone they didn't.
        this.inviteSummary = res.failed
          ? `Sent ${res.sent}, ${res.failed} failed.`
          : `Sent ${res.sent} invite${res.sent === 1 ? '' : 's'}.`;
        this.loadInvites();
      },
      error: (err) => {
        this.sending = false;
        this.inviteError = this.friendlyError(err);
      },
    });
  }

  // ── Settings ───────────────────────────────────────────────────────
  get visibility(): ResultsVisibility {
    return effectiveVisibility(this.poll);
  }

  get editsAllowed(): boolean {
    return allowsResponseEdits(this.poll);
  }

  /**
   * Which quick filters this form shows. Empty means the respondent grid falls
   * back to its defaults, so an untouched form still offers something useful.
   */
  isQuickFilterOn(id: TimeFilterId): boolean {
    const chosen = this.poll.quickFilters;
    if (!chosen || chosen.length === 0) return false;
    return chosen.includes(id);
  }

  toggleQuickFilter(id: TimeFilterId): void {
    const current = new Set((this.poll.quickFilters ?? []) as TimeFilterId[]);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    // Preserve the menu's order rather than click order, so the pills don't
    // rearrange themselves as the creator toggles them.
    const ordered = TIME_FILTERS.filter((f) => current.has(f.id)).map((f) => f.id);
    this.save({ quickFilters: ordered }, 'filters');
  }

  setVisibility(value: ResultsVisibility): void {
    if (value === this.visibility) return;
    this.save({ resultsVisibility: value }, 'visibility');
  }

  toggleEdits(): void {
    this.save({ allowResponseEdits: !this.editsAllowed }, 'edits');
  }

  toggleGuestAllowed(): void {
    this.save({ guestAllowed: !this.poll.guestAllowed }, 'guest');
  }

  private save(changes: UpdatePollSettings, key: string): void {
    this.savingSetting = key;
    this.settingsError = '';
    this.pollsService.update(this.poll.pollId, changes).subscribe({
      next: (updated) => {
        this.savingSetting = '';
        // Take the server's copy rather than patching locally, so the legacy
        // showResultsToRespondents mirror stays consistent here too.
        this.poll = updated;
        this.instructionsDraft = updated.instructions ?? '';
        this.pollChange.emit(updated);
      },
      error: (err) => {
        this.savingSetting = '';
        this.settingsError = this.friendlyError(err);
      },
    });
  }

  private friendlyError(err: unknown): string {
    const httpErr = err as { error?: { error?: { message?: string } }; status?: number };
    const msg = httpErr?.error?.error?.message;
    if (msg) return msg;
    if (httpErr?.status === 403) return 'Only the form creator can change this.';
    return 'Something went wrong. Please try again.';
  }
}
