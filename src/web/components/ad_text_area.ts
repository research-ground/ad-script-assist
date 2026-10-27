/*
 Copyright 2026 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

/**
 * @fileoverview Ad Text Area component.
 * A dumb component for rendering script text and line numbers.
 */

import {css, html, LitElement, PropertyValues} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {live} from 'lit/directives/live.js';
import type {AdSegment} from '../../core/types';

/** Ad Text Area component. */
@customElement('ad-text-area')
export class AdTextArea extends LitElement {
  @property({type: String}) value = '';
  @property({type: String}) placeholder = '';
  @property({type: Boolean}) disabled = false;
  @property({type: String, attribute: 'aria-label'}) ariaLabelText = '';
  @property({type: Array}) segments: AdSegment[] = [];
  @property({type: Boolean}) isGenerating = false;

  @query('textarea') private readonly textarea!: HTMLTextAreaElement;
  @query('.line-numbers')
  private readonly lineNumbersContainer!: HTMLDivElement;

  @state() private lineNumbers: Array<number | string> = [1];
  private resizeObserver: ResizeObserver | null = null;
  private lineHeight = 24;
  private currentCursorLine = 0;

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
    }

    .container {
      display: flex;
      width: 100%;
      height: 100%;
      border: 1px solid var(--border-color, #dee2e6);
      border-radius: 4px;
      overflow: hidden;
      background-color: var(--secondary-bg, #f8f9fa);
      position: relative;
    }

    .line-numbers {
      background-color: var(--tertiary-bg, #e9ecef);
      padding: 10px 8px;
      border-right: 1px solid var(--border-color, #dee2e6);
      text-align: right;
      color: var(--secondary-text, #505050);
      overflow: hidden;
      user-select: none;
      flex-shrink: 0;
      min-width: 2em;
      font-family: monospace;
      font-size: 1em;
      line-height: 1.5;
      box-sizing: border-box;
    }

    .line-numbers div {
      white-space: pre-wrap;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
    }

    .cue-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
      display: inline-block;
    }

    .cue-dot.ready {
      background-color: #1e8e3e;
    }

    .cue-dot.generating {
      background-color: #f9ab00;
      animation: cue-pulse 1s ease-in-out infinite;
    }

    .cue-dot.failed {
      background-color: #d93025;
    }

    @keyframes cue-pulse {
      0%, 100% { opacity: 0.35; }
      50% { opacity: 1; }
    }

    textarea {
      flex-grow: 1;
      border: none;
      border-radius: 0;
      resize: none;
      overflow-y: auto;
      background-color: transparent;
      padding: 10px;
      box-sizing: border-box;
      font-family: monospace;
      font-size: 1em;
      line-height: 1.5;
      color: var(--primary-text, #000000);
      min-height: 0;
    }

    textarea:focus-visible {
      outline: 2px solid var(--accent-color, #1a73e8);
      outline-offset: -2px;
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', 'Ad Text Editor');
  }

  override firstUpdated() {
    this.calculateLineHeight();

    this.resizeObserver = new ResizeObserver(() => {
      this.updateLineNumbers();
    });
    this.resizeObserver.observe(this.textarea);

    this.updateLineNumbers();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
  }

  override willUpdate(changedProperties: PropertyValues) {
    if (!changedProperties.has('value')) {
      return;
    }
    this.updateLineNumbers();
  }

  setScript(script: string, initiator?: string) {
    this.value = script;
    this.updateLineNumbers();
  }

  private calculateLineHeight() {
    const computed = window.getComputedStyle(this.textarea);
    const lh = Number(Number.parseFloat(computed.lineHeight));
    if (isNaN(lh)) {
      return;
    }
    this.lineHeight = lh;
  }

  private calculateNumLines(str: string): number {
    const dummy = document.createElement('div');
    dummy.textContent = str || ' ';
    dummy.style.whiteSpace = 'pre-wrap';
    dummy.style.visibility = 'hidden';
    dummy.style.position = 'absolute';
    dummy.style.width = `${this.textarea.clientWidth - 20}px`;

    const computed = window.getComputedStyle(this.textarea);
    (
      [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'letterSpacing',
        'lineHeight',
      ] as const
    ).forEach((prop) => {
      dummy.style[prop] = computed[prop];
    });

    this.shadowRoot?.appendChild(dummy);
    const height = dummy.offsetHeight;
    const lines = Math.max(1, Math.round(height / this.lineHeight));
    dummy.remove();
    return lines;
  }

  private updateLineNumbers() {
    if (!this.textarea) return;

    const lines = this.value.split('\n');
    const lineNumbers: Array<number | string> = [];

    let currentLine = 1;
    lines.forEach((line) => {
      const numWrappedLines = this.calculateNumLines(line);
      lineNumbers.push(currentLine);
      for (let i = 1; i < numWrappedLines; i++) {
        lineNumbers.push('');
      }
      currentLine++;
    });

    if (this.areLineNumbersEqual(this.lineNumbers, lineNumbers)) {
      return;
    }

    this.lineNumbers = lineNumbers;
  }

  private areLineNumbersEqual(
    arr1: Array<number | string>,
    arr2: Array<number | string>,
  ): boolean {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
      if (arr1[i] !== arr2[i]) return false;
    }
    return true;
  }

  private handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    this.value = target.value;
    this.checkCursorLine();
    this.dispatchEvent(new CustomEvent('script-changed', {
      detail: {value: this.value},
      bubbles: true,
      composed: true
    }));
  }

  private handleScroll() {
    if (!this.lineNumbersContainer || !this.textarea) {
      return;
    }
    this.lineNumbersContainer.scrollTop = this.textarea.scrollTop;
  }

  private checkCursorLine = () => {
    if (!this.textarea) return;
    const currentLine = this.getLineNumber();
    if (this.currentCursorLine !== currentLine) {
      this.currentCursorLine = currentLine;
      this.dispatchEvent(new CustomEvent('cursor-line-changed', {
        detail: {line: currentLine},
        bubbles: true,
        composed: true
      }));
    }
  };

  // Public API
  goToLine(lineNumber: number) {
    if (!this.textarea) return;
    const text = this.value;
    const lines = text.split('\n');
    const targetLineIndex = Math.max(
      0,
      Math.min(lineNumber - 1, lines.length - 1),
    );
    let charIndex = 0;
    for (let i = 0; i < targetLineIndex; i++) {
      charIndex += lines[i].length + 1;
    }
    this.focus();
    this.textarea.setSelectionRange(charIndex, charIndex);
    if (lineNumber === 1) {
      this.textarea.scrollTop = 0;
    } else {
      const blur =
        this.textarea.scrollHeight * (targetLineIndex / lines.length);
      this.textarea.scrollTop = blur - this.textarea.clientHeight / 2;
    }
  }

  override focus(options?: FocusOptions): void {
    this.textarea?.focus(options);
  }

  getLineNumber(): number {
    if (!this.textarea) return 1;
    const text = this.value;
    const cursor = this.textarea.selectionStart;
    const textBefore = text.substring(0, cursor);
    return (textBefore.match(/\n/g) || []).length + 1;
  }

  private getCueStatusByLine(): Map<number, 'ready' | 'generating' | 'failed'> {
    const statusMap = new Map<number, 'ready' | 'generating' | 'failed'>();
    if (!this.value || !this.segments || this.segments.length === 0) {
      return statusMap;
    }
    const lines = this.value.split('\n');
    let cueIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        const seg = this.segments[cueIdx];
        if (seg && seg.script.trim().length > 0) {
          if (seg.audioData) {
            statusMap.set(i + 1, 'ready');
          } else if (seg.generationFailed) {
            statusMap.set(i + 1, 'failed');
          } else if (this.isGenerating) {
            statusMap.set(i + 1, 'generating');
          }
        }
        cueIdx++;
      }
    }
    return statusMap;
  }

  override render() {
    const cueStatusByLine = this.getCueStatusByLine();
    return html`
      <div class="container">
        <div class="line-numbers" aria-hidden="true">
          ${this.lineNumbers.map((n) => {
            const status = typeof n === 'number' ? cueStatusByLine.get(n) : undefined;
            const title = status === 'ready'
              ? 'Speech generated'
              : status === 'generating'
                ? 'Generating speech...'
                : status === 'failed'
                  ? 'Speech generation failed'
                  : '';
            return html`<div>${status ? html`<span class="cue-dot ${status}" title="${title}"></span>` : ''}${n || '\u00A0'}</div>`;
          })}
        </div>
        <textarea
          .value="${live(this.value)}"
          placeholder="${this.placeholder}"
          ?disabled="${this.disabled}"
          @input="${this.handleInput}"
          @scroll="${this.handleScroll}"
          @keyup="${this.checkCursorLine}"
          @click="${this.checkCursorLine}"
          @blur="${() => this.dispatchEvent(new CustomEvent('editor-blur', {bubbles: true, composed: true}))}"
          spellcheck="false"
          aria-label="${this.ariaLabelText ||
          this.placeholder ||
          'Ad Text Editor input'}"></textarea>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ad-text-area': AdTextArea;
  }
}
