import { Component, Input } from '@angular/core';

/**
 * Every icon the app uses, as inline SVG.
 *
 * Emoji were doing this job before, which meant the UI rendered differently on
 * every OS (and as full-colour cartoons on some), couldn't inherit text colour,
 * and sat on the text baseline unpredictably. These are stroked paths on
 * `currentColor` at a 24-unit grid, so they take the colour and size of
 * whatever contains them.
 */
export type IconName =
  | 'pin'
  | 'monitor'
  | 'clock'
  | 'moon'
  | 'pencil'
  | 'calendar'
  | 'clipboard'
  | 'check'
  | 'star'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'plus';

@Component({
  selector: 'xf-icon',
  templateUrl: './icon.component.html',
  styleUrls: ['./icon.component.scss'],
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  /** Edge length in px. Inherits the surrounding font size when omitted. */
  @Input() size: number | null = null;
  /**
   * Decorative by default: an icon beside a text label is noise to a screen
   * reader. Pass a label only when the icon is the sole meaning.
   */
  @Input() label = '';

  get isFilled(): boolean {
    return this.name === 'star';
  }
}
