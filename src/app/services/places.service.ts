import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/** One address match. `lat`/`lon` are named because AWS returns [lon, lat]. */
export interface PlaceSuggestion {
  label: string;
  name: string;
  secondary: string;
  lat: number | null;
  lon: number | null;
}

/**
 * Address autocomplete. Talks to the backend proxy rather than Amazon Location
 * directly -- signing an AWS request in the browser would mean shipping
 * credentials.
 */
@Injectable({ providedIn: 'root' })
export class PlacesService {
  private readonly baseUrl = `${environment.apiBaseUrl}/places`;

  constructor(private http: HttpClient) {}

  /**
   * Suggestions for a partial address. Failures resolve to an empty list:
   * autocomplete is an assist, and an error toast over a half-typed address
   * is worse than simply offering nothing.
   */
  suggest(query: string): Observable<PlaceSuggestion[]> {
    const q = query.trim();
    if (q.length < 3) return of([]);
    return this.http
      .get<{ suggestions: PlaceSuggestion[] }>(`${this.baseUrl}/suggest`, { params: { q } })
      .pipe(
        map((res) => res.suggestions ?? []),
        catchError(() => of<PlaceSuggestion[]>([])),
      );
  }
}
