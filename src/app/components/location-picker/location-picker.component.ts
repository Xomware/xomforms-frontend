import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { PlacesService, PlaceSuggestion } from '../../services/places.service';
import { FormLocation, LocationType } from '../../models/poll.model';

/**
 * In-person vs virtual, with address autocomplete for the in-person case.
 *
 * Emits the whole FormLocation on every change so both consumers (the create
 * builder and the admin panel) persist it the same way, rather than each
 * reassembling six fields for themselves.
 */
@Component({
  selector: 'app-location-picker',
  templateUrl: './location-picker.component.html',
  styleUrls: ['./location-picker.component.scss'],
})
export class LocationPickerComponent implements OnInit, OnDestroy {
  @Input() value: FormLocation = {};
  @Output() valueChange = new EventEmitter<FormLocation>();

  addressQuery = '';
  suggestions: PlaceSuggestion[] = [];
  searching = false;
  /** True once a suggestion is chosen, so we stop re-offering what was picked. */
  private addressChosen = false;

  private readonly queries = new Subject<string>();
  private sub?: Subscription;

  constructor(private places: PlacesService) {}

  ngOnInit(): void {
    this.addressQuery = this.value.locationAddress ?? '';
    this.addressChosen = !!this.value.locationAddress;

    // Debounced so a typed address costs a handful of calls rather than one
    // per keystroke -- this is a paid upstream API.
    this.sub = this.queries
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => this.places.suggest(q)),
      )
      .subscribe((results) => {
        this.suggestions = results;
        this.searching = false;
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get type(): LocationType | null {
    return this.value.locationType ?? null;
  }

  setType(type: LocationType): void {
    // Tapping the active option clears it. "Not stated" is a real answer, and
    // without this there's no way back to it once you've picked one.
    const next = this.type === type ? null : type;
    this.emit({ ...this.value, locationType: next });
  }

  onAddressInput(query: string): void {
    this.addressQuery = query;
    this.addressChosen = false;
    // Typing after choosing invalidates the coordinates: they belong to the
    // previous pick, and stale coordinates are worse than none at all.
    this.emit({
      ...this.value,
      locationAddress: query,
      locationLat: null,
      locationLon: null,
    });
    this.searching = query.trim().length >= 3;
    this.queries.next(query);
  }

  choose(suggestion: PlaceSuggestion): void {
    this.addressQuery = suggestion.label;
    this.addressChosen = true;
    this.suggestions = [];
    this.emit({
      ...this.value,
      locationAddress: suggestion.label,
      // Only fill the venue name if the creator hasn't written their own.
      locationName: this.value.locationName?.trim() || suggestion.name,
      locationLat: suggestion.lat,
      locationLon: suggestion.lon,
    });
  }

  onNameInput(name: string): void {
    this.emit({ ...this.value, locationName: name });
  }

  onUrlInput(url: string): void {
    this.emit({ ...this.value, locationUrl: url });
  }

  dismissSuggestions(): void {
    this.suggestions = [];
  }

  get showSuggestions(): boolean {
    return !this.addressChosen && this.suggestions.length > 0;
  }

  private emit(next: FormLocation): void {
    this.value = next;
    this.valueChange.emit(next);
  }
}
