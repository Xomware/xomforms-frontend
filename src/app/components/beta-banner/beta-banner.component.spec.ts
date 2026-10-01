import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BETA_BANNER_STORAGE_KEY, BetaBannerComponent } from './beta-banner.component';
import { IconComponent } from '../icon/icon.component';

describe('BetaBannerComponent', () => {
  let fixture: ComponentFixture<BetaBannerComponent>;

  async function render(): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      declarations: [BetaBannerComponent, IconComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(BetaBannerComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => localStorage.removeItem(BETA_BANNER_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(BETA_BANNER_STORAGE_KEY));

  it('shows the notice with a feedback link to the repo issues', async () => {
    const el = await render();
    expect(el.querySelector('.beta-banner')?.textContent).toContain('Xomforms is in beta');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://github.com/Xomware/xomforms-frontend/issues');
  });

  it('hides on dismiss and remembers it', async () => {
    const el = await render();
    (el.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.beta-banner')).toBeNull();
    expect(localStorage.getItem(BETA_BANNER_STORAGE_KEY)).toBe('1');
  });

  it('stays hidden once dismissed on an earlier visit', async () => {
    localStorage.setItem(BETA_BANNER_STORAGE_KEY, '1');
    const el = await render();
    expect(el.querySelector('.beta-banner')).toBeNull();
  });

  it('still shows and dismisses when storage throws', async () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError');
    spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');
    const el = await render();
    expect(el.querySelector('.beta-banner')).not.toBeNull();
    (el.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.beta-banner')).toBeNull();
  });
});
