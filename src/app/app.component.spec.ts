import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { AppComponent } from './app.component';
import { CognitoService, XomUser } from './services/cognito.service';
import { BetaBannerComponent } from './components/beta-banner/beta-banner.component';
import { IconComponent } from './components/icon/icon.component';

class CognitoServiceStub {
  readonly user$ = new BehaviorSubject<XomUser | null>(null);
  readonly isReady$ = new BehaviorSubject<boolean>(true);
  signOut() {
    this.user$.next(null);
    return of(void 0);
  }
}

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, RouterModule.forRoot([])],
      declarations: [AppComponent, BetaBannerComponent, IconComponent],
      providers: [{ provide: CognitoService, useClass: CognitoServiceStub }],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the Xomforms brand banner', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const banner = compiled.querySelector('.brand img');
    expect(banner?.getAttribute('alt')).toBe('Xomforms');
  });

  it('flags the app as beta in the header and the notice banner', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-header .beta-pill')?.textContent?.trim()).toBe('Beta');
    expect(compiled.querySelector('xf-beta-banner')).not.toBeNull();
  });
});
