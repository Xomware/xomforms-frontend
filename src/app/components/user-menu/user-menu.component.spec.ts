import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { UserMenuComponent } from './user-menu.component';
import { XomUser } from '../../services/cognito.service';

describe('UserMenuComponent', () => {
  let fixture: ComponentFixture<UserMenuComponent>;
  let component: UserMenuComponent;

  const base: XomUser = { userId: 'u1', username: 'dom', email: 'dom.giordano@example.com' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [UserMenuComponent],
      imports: [RouterTestingModule],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(UserMenuComponent);
    component = fixture.componentInstance;
  });

  // The pool may supply name+picture, name only, or neither -- all three have
  // to render something sensible.
  it('uses the picture and name when the pool supplies both', () => {
    component.user = { ...base, name: 'Dominick Giordano', picture: 'https://x/a.png' };
    expect(component.avatarUrl).toBe('https://x/a.png');
    expect(component.displayName).toBe('Dominick Giordano');
    expect(component.hasDistinctName).toBeTrue();
  });

  it('falls back to initials from the name when there is no picture', () => {
    component.user = { ...base, name: 'Dominick Giordano' };
    expect(component.avatarUrl).toBeNull();
    expect(component.initials).toBe('DG');
  });

  it('falls back to the email local-part when there is no name at all', () => {
    component.user = { ...base };
    expect(component.displayName).toBe('dom.giordano');
    expect(component.hasDistinctName).toBeFalse();
    // Dotted local-parts still yield two letters.
    expect(component.initials).toBe('DG');
  });

  it('handles a single-word identity', () => {
    component.user = { userId: 'u2', username: 'sam', email: 'sam@example.com' };
    expect(component.initials).toBe('SA');
  });

  it('never renders an empty avatar', () => {
    component.user = { userId: 'u3', username: '', email: '' };
    expect(component.initials).toBe('?');
  });

  it('drops back to initials when the avatar image fails to load', () => {
    component.user = { ...base, picture: 'https://x/broken.png' };
    expect(component.avatarUrl).toBe('https://x/broken.png');

    component.onAvatarError();

    expect(component.avatarUrl).toBeNull();
  });

  it('opens, closes on Escape, and closes on an outside click', () => {
    component.user = { ...base };
    component.toggle();
    expect(component.open).toBeTrue();

    component.onEscape();
    expect(component.open).toBeFalse();

    component.toggle();
    component.onDocumentClick({ target: document.body } as unknown as MouseEvent);
    expect(component.open).toBeFalse();
  });

  it('emits sign out and closes the menu', () => {
    component.user = { ...base };
    const emitted: unknown[] = [];
    component.signOut.subscribe(() => emitted.push(true));

    component.toggle();
    component.onSignOut();

    expect(emitted.length).toBe(1);
    expect(component.open).toBeFalse();
  });
});
