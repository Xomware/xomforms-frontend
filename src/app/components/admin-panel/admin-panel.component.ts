import { Component, EventEmitter, Input, OnChanges, OnInit, Output } from '@angular/core';
import { InvitesService } from '../../services/invites.service';
import { PollsService, UpdatePollSettings } from '../../services/polls.service';
import { ResponsesService } from '../../services/responses.service';
import { OverlapResult } from '../../models/response.model';
import { minutesToClockLabel } from '../../models/grid.util';
import { TIME_FILTERS, TimeFilterId } from '../availability-grid/availability-grid.component';
import {
  FormInvite,
  FormLocation,
  Respondent,
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
export class AdminPanelComponent implements OnInit, OnChanges {
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
  locationDraft: FormLocation = {};

  // ── Finalize + roster ──────────────────────────────────────────────
  respondents: Respondent[] = [];
  respondentsLoading = false;
  /** Candidate slots, best-supported first, for the finalize picker. */
  finalizeOptions: { blockId: string; label: string; count: number }[] = [];
  chosenBlockId = '';
  finalizing = false;
  finalizeError = '';
  finalizeSummary = '';
  confirmingFinalize = false;

  @Input() results: OverlapResult | null = null;

  constructor(
    private invitesService: InvitesService,
    private pollsService: PollsService,
    private responsesService: ResponsesService,
  ) {}

  ngOnInit(): void {
    this.instructionsDraft = this.poll.instructions ?? '';
    this.locationDraft = this.readLocation(this.poll);
    this.loadInvites();
    this.loadRespondents();
  }

  ngOnChanges(): void {
    this.buildFinalizeOptions();
  }

  loadRespondents(): void {
    this.respondentsLoading = true;
    this.responsesService.respondents(this.poll.pollId).subscribe({
      next: (res) => {
        this.respondents = res.respondents ?? [];
        this.respondentsLoading = false;
      },
      error: () => {
        this.respondentsLoading = false;
      },
    });
  }

  get isFinalized(): boolean {
    return !!this.poll.finalBlockId;
  }

  get finalizedLabel(): string {
    const blockId = this.poll.finalBlockId;
    if (!blockId) return '';
    return this.labelForBlock(blockId);
  }

  get contactableCount(): number {
    return this.respondents.filter((r) => !!r.email).length;
  }

  /**
   * Offer the slots people can actually make, best first, rather than a raw
   * date picker -- the whole point of the form was to find out which ones
   * those are.
   */
  private buildFinalizeOptions(): void {
    const blocks = this.results?.blocks ?? [];
    this.finalizeOptions = [...blocks]
      .filter((b) => b.count > 0)
      .sort((a, b) => b.count - a.count || a.blockId.localeCompare(b.blockId))
      .slice(0, 12)
      .map((b) => ({
        blockId: b.blockId,
        label: this.labelForBlock(b.blockId),
        count: b.count,
      }));
    if (!this.chosenBlockId && this.finalizeOptions.length) {
      this.chosenBlockId = this.finalizeOptions[0].blockId;
    }
  }

  private labelForBlock(blockId: string): string {
    const [date, time] = blockId.split('T');
    const [h, m] = time.split(':').map(Number);
    const d = new Date(`${date}T00:00:00`);
    const day = d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return `${day} at ${minutesToClockLabel(h * 60 + m)}`;
  }

  askFinalize(): void {
    if (!this.chosenBlockId) return;
    this.finalizeError = '';
    this.finalizeSummary = '';
    this.confirmingFinalize = true;
  }

  cancelFinalize(): void {
    this.confirmingFinalize = false;
  }

  /**
   * One action, because it's one decision: record the time, close the form,
   * and tell everyone who answered.
   */
  confirmFinalize(notify: boolean): void {
    if (!this.chosenBlockId || this.finalizing) return;
    this.finalizing = true;
    this.finalizeError = '';

    this.pollsService.finalize(this.poll.pollId, this.chosenBlockId, notify).subscribe({
      next: (res) => {
        this.finalizing = false;
        this.confirmingFinalize = false;
        this.finalizeSummary = notify
          ? `Time confirmed. ${res.notified} notified${res.failed ? `, ${res.failed} failed` : ''}.`
          : 'Time confirmed. No emails sent.';
        // Reflect the new finalized/closed state without a reload.
        this.poll = {
          ...this.poll,
          finalBlockId: res.finalBlockId,
          finalStartUtc: res.startUtc,
          closeAt: new Date().toISOString(),
        };
        this.pollChange.emit(this.poll);
      },
      error: (err) => {
        this.finalizing = false;
        this.finalizeError = this.friendlyError(err);
      },
    });
  }

  get icsUrl(): string {
    return this.pollsService.icsUrl(this.poll.pollId);
  }

  private readLocation(poll: Poll): FormLocation {
    return {
      locationType: poll.locationType ?? null,
      locationName: poll.locationName ?? null,
      locationAddress: poll.locationAddress ?? null,
      locationUrl: poll.locationUrl ?? null,
      locationLat: poll.locationLat ?? null,
      locationLon: poll.locationLon ?? null,
    };
  }

  get locationDirty(): boolean {
    const a = this.locationDraft;
    const b = this.readLocation(this.poll);
    return (
      (a.locationType ?? null) !== (b.locationType ?? null) ||
      (a.locationName ?? '') !== (b.locationName ?? '') ||
      (a.locationAddress ?? '') !== (b.locationAddress ?? '') ||
      (a.locationUrl ?? '') !== (b.locationUrl ?? '')
    );
  }

  saveLocation(): void {
    if (!this.locationDirty) return;
    const d = this.locationDraft;
    this.save(
      {
        locationType: d.locationType ?? null,
        locationName: d.locationName?.trim() || null,
        locationAddress: d.locationAddress?.trim() || null,
        locationUrl: d.locationUrl?.trim() || null,
        locationLat: d.locationLat ?? null,
        locationLon: d.locationLon ?? null,
      },
      'location',
    );
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
        this.locationDraft = this.readLocation(updated);
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
