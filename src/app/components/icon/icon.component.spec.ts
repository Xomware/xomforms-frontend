import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconComponent, IconName } from './icon.component';

const ALL_ICONS: IconName[] = [
  'pin',
  'monitor',
  'clock',
  'moon',
  'pencil',
  'calendar',
  'clipboard',
  'check',
  'star',
  'close',
  'chevron-left',
  'chevron-right',
  'plus',
];

describe('IconComponent', () => {
  let fixture: ComponentFixture<IconComponent>;
  let component: IconComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ declarations: [IconComponent] }).compileComponents();
    fixture = TestBed.createComponent(IconComponent);
    component = fixture.componentInstance;
  });

  const svg = () => fixture.nativeElement.querySelector('svg') as SVGElement;

  it('every declared name actually draws something', () => {
    // A typo'd name would otherwise render an empty box that looks like a
    // layout bug rather than a missing icon.
    for (const name of ALL_ICONS) {
      component.name = name;
      fixture.detectChanges();
      expect(svg().querySelectorAll('path, circle, rect').length)
        .withContext(name)
        .toBeGreaterThan(0);
    }
  });

  it('inherits colour rather than baking one in', () => {
    // This is the point of replacing emoji: they could never take the colour
    // of the text beside them.
    component.name = 'pin';
    fixture.detectChanges();
    expect(svg().getAttribute('stroke')).toBe('currentColor');
  });

  it('is hidden from screen readers when decorative', () => {
    component.name = 'pin';
    fixture.detectChanges();
    expect(svg().getAttribute('aria-hidden')).toBe('true');
    expect(svg().getAttribute('role')).toBeNull();
  });

  it('is announced when it carries the only meaning', () => {
    component.name = 'close';
    component.label = 'Dismiss';
    fixture.detectChanges();
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('aria-label')).toBe('Dismiss');
    expect(svg().getAttribute('aria-hidden')).toBeNull();
  });

  it('fills the star and outlines everything else', () => {
    component.name = 'star';
    fixture.detectChanges();
    expect(svg().getAttribute('fill')).toBe('currentColor');

    component.name = 'pin';
    fixture.detectChanges();
    expect(svg().getAttribute('fill')).toBe('none');
  });

  it('takes an explicit size when one is given', () => {
    component.name = 'pin';
    component.size = 32;
    fixture.detectChanges();
    expect((svg() as unknown as HTMLElement).style.width).toBe('32px');
  });
});
