import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { LocationPickerComponent } from './location-picker.component';
import { PlacesService, PlaceSuggestion } from '../../services/places.service';
import { FormLocation } from '../../models/poll.model';

const FENWAY: PlaceSuggestion = {
  label: 'Fenway Park, 4 Jersey St, Boston, MA',
  name: 'Fenway Park',
  secondary: '4 Jersey St, Boston, Massachusetts',
  lat: 42.3467,
  lon: -71.0972,
};

describe('LocationPickerComponent', () => {
  let fixture: ComponentFixture<LocationPickerComponent>;
  let component: LocationPickerComponent;
  let places: jasmine.SpyObj<PlacesService>;
  let emitted: FormLocation[];

  beforeEach(async () => {
    places = jasmine.createSpyObj('PlacesService', ['suggest']);
    places.suggest.and.returnValue(of([FENWAY]));

    await TestBed.configureTestingModule({
      declarations: [LocationPickerComponent],
      providers: [{ provide: PlacesService, useValue: places }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(LocationPickerComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.valueChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
  });

  const last = () => emitted[emitted.length - 1];

  it('starts with nothing stated', () => {
    expect(component.type).toBeNull();
  });

  it('tapping the active type clears it back to unstated', () => {
    // "Not stated" is a real answer -- without this there's no way back to it.
    component.setType('in_person');
    expect(last().locationType).toBe('in_person');

    component.value = last();
    component.setType('in_person');
    expect(last().locationType).toBeNull();
  });

  it('debounces address lookups instead of firing per keystroke', fakeAsync(() => {
    component.onAddressInput('fen');
    component.onAddressInput('fenw');
    component.onAddressInput('fenway');
    tick(300);

    // A paid upstream: one call for the burst, not three.
    expect(places.suggest).toHaveBeenCalledTimes(1);
    expect(places.suggest).toHaveBeenCalledWith('fenway');
  }));

  it('choosing a suggestion captures address and coordinates', fakeAsync(() => {
    component.onAddressInput('fenway');
    tick(300);
    component.choose(FENWAY);

    expect(last().locationAddress).toBe(FENWAY.label);
    expect(last().locationLat).toBe(42.3467);
    expect(last().locationLon).toBe(-71.0972);
  }));

  it('fills the venue name only when the creator left it blank', fakeAsync(() => {
    component.choose(FENWAY);
    expect(last().locationName).toBe('Fenway Park');

    component.value = { ...last(), locationName: "Murphy's back room" };
    component.choose(FENWAY);
    expect(last().locationName).toBe("Murphy's back room");
  }));

  it('drops coordinates when the address is edited after choosing', fakeAsync(() => {
    component.choose(FENWAY);
    expect(last().locationLat).toBe(42.3467);

    component.value = last();
    component.onAddressInput('Fenway Park, 4 Jer');

    // The coordinates belonged to the previous pick; stale ones are worse
    // than none, since they'd put the pin somewhere the address isn't.
    expect(last().locationLat).toBeNull();
    expect(last().locationLon).toBeNull();

    tick(300); // drain the debounce this input queued
  }));

  it('hides the list once a suggestion is chosen', fakeAsync(() => {
    component.onAddressInput('fenway');
    tick(300);
    expect(component.showSuggestions).toBeTrue();

    component.choose(FENWAY);
    expect(component.showSuggestions).toBeFalse();
  }));

  it('never queries for a fragment too short to mean anything', fakeAsync(() => {
    component.onAddressInput('fe');
    tick(300);
    // The service also guards this, but not sending it at all is cheaper.
    expect(component.searching).toBeFalse();
  }));

  it('seeds the address box from an already-saved location', () => {
    component.value = { locationType: 'in_person', locationAddress: '4 Jersey St' };
    component.ngOnInit();

    expect(component.addressQuery).toBe('4 Jersey St');
    // Already chosen, so it shouldn't immediately re-offer suggestions.
    expect(component.showSuggestions).toBeFalse();
  });

  it('keeps the meeting link for a virtual event', () => {
    component.setType('virtual');
    component.value = last();
    component.onUrlInput('https://meet.example.com/abc');
    expect(last().locationUrl).toBe('https://meet.example.com/abc');
  });
});
