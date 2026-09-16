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

import {HotkeyConfigEntry} from '../core/types';



/**
 * The default hotkey configurations.
 */
export const defaultHotkeyConfigs: HotkeyConfigEntry[] = [
  {
    command: 'TOGGLE_PLAY_PAUSE',
    keyCombo: 'ctrl+1',
    description: 'Play/Pause Video',
  },
  {
    command: 'JUMP_BACKWARD',
    keyCombo: 'ctrl+2',
    description: 'Jump 5 seconds back',
  },
  {
    command: 'JUMP_FORWARD',
    keyCombo: 'ctrl+3',
    description: 'Jump 5 seconds forward',
  },
  {
    command: 'MOVE_TO_COMMAND',
    keyCombo: 'ctrl+4',
    description: 'Move to conversation agent',
  },
  {
    command: 'MOVE_TO_EDITOR',
    keyCombo: 'ctrl+5',
    description: 'Move to text editing area',
  },
  {
    command: 'PLAY_CURRENT_SEGMENT',
    keyCombo: 'ctrl+o',
    description: 'Play audio for current segment',
  },

  {
    command: 'REGENERATE_AD_SCRIPT',
    keyCombo: 'ctrl+m',
    description: 'Regenerate the AD script',
  },
  {
    command: 'EXPORT_AUDIO_DESCRIPTION',
    keyCombo: 'ctrl+9',
    description: 'Export audio description track (.wav)',
  },
  {
    command: 'READ_CURRENT_LINE',
    keyCombo: 'ctrl+l',
    description: 'Read out current line number',
  },
  {
    command: 'DESCRIBE_HIGH_LEVEL_SUMMARY',
    keyCombo: 'ctrl+/',
    description: 'Describe a high-level summary of the video',
  },
  {
    command: 'CLEAR_VIDEO_DATA',
    keyCombo: 'ctrl+0',
    description: 'Clear current video and data',
  },
];

/**
 * Retrieves the default hotkey configurations.
 */
export function getDefaultHotkeyConfigs(): HotkeyConfigEntry[] {
  return defaultHotkeyConfigs;
}




/**
 * Manages hotkey registration and execution.
 */
export class HotkeyManager {
  /** Callback triggered when a hotkey is executed. */
  onTrigger: ((command: string, keyCombo: string) => void) | null = null;
  private hotkeyConfigs: HotkeyConfigEntry[] = defaultHotkeyConfigs;
  private actions: {[key: string]: KeyHandler} = {};
  /** The hotkey registry instance. */
  private readonly registry: HotkeyRegistry;

  constructor() {
    this.registry = new HotkeyRegistry();
  }

  /**
   * Sets the hotkey configurations and refreshes bindings.
   * @param configs The new configurations.
   */
  setConfigs(configs: HotkeyConfigEntry[]) {
    this.unregisterHotkeys();
    this.hotkeyConfigs = configs;
    this.registerHotkeys();
  }

  /**
   * Gets the current hotkey configurations.
   * @return Array of hotkey entries.
   */
  getConfigs(): HotkeyConfigEntry[] {
    return this.hotkeyConfigs;
  }

  /**
   * Initializes the hotkey manager.
   * @param actions Map of command names to action functions.
   * @param target The DOM element or Window to attach to.
   */
  init(
    actions: {[key: string]: KeyHandler},
    target: HTMLElement | Window = window,
  ) {
    this.registry.attach(target);
    this.actions = actions;
    // Unregister first to prevent duplicates if init is called multiple times
    this.unregisterHotkeys();
    this.registerHotkeys();
  }

  /**
   * Unregisters all current hotkeys.
   */
  private unregisterHotkeys(): void {
    this.hotkeyConfigs.forEach((config) => {
      this.registry.unbind(config.keyCombo);
    });
  }

  /**
   * Registers all hotkeys from the current config.
   */
  private registerHotkeys(): void {
    this.hotkeyConfigs.forEach((config: HotkeyConfigEntry) => {
      if (this.actions[config.command]) {
        this.createHotkey(
          config.keyCombo,
          this.actions[config.command],
          config.command,
          config.preventDefault,
        );
      }
    });
  }

  /**
   * Creates a single hotkey binding.
   * @param keyCombo The key combination.
   * @param func The function to execute.
   * @param command The command identifier.
   * @param preventDefault Whether to call event.preventDefault(). Default true.
   */
  createHotkey(
    keyCombo: string,
    func: KeyHandler,
    command: string,
    preventDefault?: boolean,
  ): void {
    this.registry.register(keyCombo, (event, handler) => {
      // Default to true if preventDefault is not specified, maintaining existing behavior.
      if (preventDefault === undefined || preventDefault) {
        event.preventDefault();
      }
      if (this.onTrigger) {
        this.onTrigger(command, handler.key);
      }
      func(event, handler);
    });
  }
  /**
   * Detaches the hotkey registry and cleans up listeners.
   */
  destroy(): void {
    this.registry.detach();
  }
}


/**
 * Interface for hotkey events.
 */
export interface HotkeysEvent {
  key: string;
  method?: KeyHandler;
  scope?: string;
  [key: string]: unknown;
}

/**
 * Handler function for hotkey events.
 */
export type KeyHandler = (
  keyboardEvent: KeyboardEvent,
  hotkeysEvent: HotkeysEvent,
) => void;

interface ParsedKeyCombo {
  key: string;
  modifiers: {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
  };
}

function parseKeyCombo(combo: string): ParsedKeyCombo {
  const modifiers = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  let remaining = combo.toLowerCase().trim();

  // Regex to match start of string with a modifier and a + separator
  // We match repeatedly to consume all modifiers
  // Strict set: ctrl, meta, command, shift, alt
  const modifierRegex = /^(ctrl|meta|command|shift|alt)\+(.*)$/;

  while (true) {
    const match = remaining.match(modifierRegex);
    if (!match) break;

    const mod = match[1];
    remaining = match[2]; // Captures the rest after the first +

    if (mod === 'ctrl') modifiers.ctrl = true;
    else if (mod === 'meta' || mod === 'command') modifiers.meta = true;
    else if (mod === 'shift') modifiers.shift = true;
    else if (mod === 'alt') modifiers.alt = true;
  }

  return {key: remaining, modifiers};
}

function matchesKeyCombo(
  event: KeyboardEvent,
  parsed: ParsedKeyCombo,
): boolean {
  const key = event.key.toLowerCase();
  const {modifiers, key: mainKeyDef} = parsed;

  if (event.ctrlKey !== modifiers.ctrl) return false;
  if (event.shiftKey !== modifiers.shift) return false;
  if (event.altKey !== modifiers.alt) return false;
  if (event.metaKey !== modifiers.meta) return false;

  // specific key checks
  if (mainKeyDef === key) return true;
  if (mainKeyDef === 'space' && key === ' ') return true;
  if (mainKeyDef === 'esc' && key === 'escape') return true;
  if (mainKeyDef === 'plus' && key === '+') return true;

  return false;
}

/**
 * Registry for managing hotkey listeners.
 */
export class HotkeyRegistry {
  private readonly handlers: Record<
    string,
    {parsed: ParsedKeyCombo; handlers: KeyHandler[]}
  > = {};
  private readonly boundHandler: (event: KeyboardEvent) => void;
  private currentTarget: HTMLElement | Window | null = null;

  constructor() {
    this.boundHandler = this.handleKeyDown.bind(this);
  }

  /**
   * Default filter to prevent hotkeys in input fields.
   * Can be overridden by the user.
   */
  filter(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    const tagName = target.tagName;
    return !(
      target.isContentEditable ||
      tagName === 'INPUT' ||
      tagName === 'SELECT' ||
      tagName === 'TEXTAREA'
    );
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (!this.filter(event)) return;

    for (const combo of Object.keys(this.handlers)) {
      const entry = this.handlers[combo];
      if (matchesKeyCombo(event, entry.parsed)) {
        entry.handlers.forEach((handler) => {
          handler(event, {key: combo});
        });
      }
    }
  }

  /**
   * Registers a hotkey handler.
   * @param key The key combination(s) (comma separated).
   * @param method The handler function.
   */
  register(key: string, method: KeyHandler): void {
    const combos = key.split(',').map((k) => k.trim().toLowerCase());
    combos.forEach((combo) => {
      if (!this.handlers[combo]) {
        this.handlers[combo] = {
          parsed: parseKeyCombo(combo),
          handlers: [],
        };
      }
      this.handlers[combo].handlers.push(method);
    });
  }

  /**
   * Unbinds hotkeys.
   * @param key The key combination(s) to unbind.
   */
  unbind(key: string): void {
    const combos = key.split(',').map((k) => k.trim().toLowerCase());
    combos.forEach((combo) => {
      delete this.handlers[combo];
    });
  }

  /**
   * Attaches the keydown listener to the specified target.
   * @param target The DOM element or Window to attach to.
   */
  attach(target: HTMLElement | Window): void {
    this.detach(); // Detach from previous if any
    this.currentTarget = target;
    this.currentTarget.addEventListener(
      'keydown',
      this.boundHandler as EventListener,
    );
  }

  /**
   * Detaches the keydown listener.
   */
  detach(): void {
    if (this.currentTarget) {
      this.currentTarget.removeEventListener(
        'keydown',
        this.boundHandler as EventListener,
      );
      this.currentTarget = null;
    }
  }
}
