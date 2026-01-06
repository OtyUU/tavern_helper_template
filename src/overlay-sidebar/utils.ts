// Utility functions for overlay sidebar script

declare global {
  interface Window {
    toastr?: {
      success: (message: string, title?: string) => void;
      error: (message: string, title?: string) => void;
      warning: (message: string, title?: string) => void;
      info: (message: string, title?: string) => void;
    };
    SillyTavern?: {
      getCurrentChatId(): number;
    };
    sidebarDebug?: boolean;
  }
}

/**
 * Console-only notification system that logs to console with appropriate levels
 * This function never shows UI notifications (toastr/alerts)
 */
export function showNotification(
  message: string,
  type: 'success' | 'error' | 'warning' | 'info' = 'info',
  title?: string,
): void {
  // Always log to console with [Tavern Helper] prefix for consistency
  const prefix = '[Tavern Helper]';
  const titlePart = title ? `${title}: ` : '';
  const fullMessage = `${prefix} ${titlePart}${message}`;

  // Map notification type to appropriate console method
  switch (type) {
    case 'success':
      console.log(fullMessage);
      break;
    case 'error':
      console.error(fullMessage);
      break;
    case 'warning':
      console.warn(fullMessage);
      break;
    case 'info':
    default:
      console.log(fullMessage);
      break;
  }
}

/**
 * Safe selector utility that handles jQuery selection safely
 * Returns null if selector fails or jQuery is not available
 */
export function querySafe(selector: string, context?: JQuery | Element | Document): JQuery | null {
  if (typeof $ === 'undefined') {
    console.warn('[Sidebar] jQuery not available for selector:', selector);
    return null;
  }

  try {
    const result = context ? $(selector, context) : $(selector);
    if (result.length === 0) {
      if (window.sidebarDebug) {
        console.debug(`[Sidebar] Selector didn't match any elements: ${selector}`);
      }
      return null;
    }
    return result;
  } catch (error) {
    console.error('[Sidebar] Selector error:', selector, error);
    return null;
  }
}

/**
 * Event utility system for safely binding and unbinding events
 */
export const eventUtils = {
  /**
   * Safe event binding with jQuery fallback
   */
  on(
    element: string | JQuery | Element | Document,
    eventType: string,
    handler: (event: JQuery.Event) => void,
    context?: any,
  ): void {
    if (typeof $ === 'undefined') {
      console.warn('[Sidebar] jQuery not available for event binding:', eventType);
      return;
    }

    try {
      const $element = typeof element === 'string' ? $(element) : $(element);
      if ($element.length === 0) {
        console.warn('[Sidebar] Event target not found:', element);
        return;
      }

      if (context) {
        $element.on(eventType, context, handler);
      } else {
        $element.on(eventType, handler);
      }

      if (window.sidebarDebug) {
        console.debug(`[Sidebar] Event bound: ${eventType} on`, element);
      }
    } catch (error) {
      console.error('[Sidebar] Event binding error:', eventType, error);
    }
  },

  /**
   * Safe event unbinding
   */
  off(
    element: string | JQuery | Element | Document,
    eventType?: string,
    handler?: (event: JQuery.Event) => void,
  ): void {
    if (typeof $ === 'undefined') return;

    try {
      const $element = typeof element === 'string' ? $(element) : $(element);
      if ($element.length === 0) return;

      if (eventType && handler) {
        $element.off(eventType, handler);
      } else if (eventType) {
        $element.off(eventType);
      } else {
        $element.off();
      }

      if (window.sidebarDebug) {
        console.debug(`[Sidebar] Event unbound: ${eventType || 'all'} on`, element);
      }
    } catch (error) {
      console.error('[Sidebar] Event unbinding error:', eventType, error);
    }
  },

  /**
   * One-time event binding
   */
  once(element: string | JQuery | Element | Document, eventType: string, handler: (event: JQuery.Event) => void): void {
    if (typeof $ === 'undefined') {
      console.warn('[Sidebar] jQuery not available for event binding:', eventType);
      return;
    }

    try {
      const $element = typeof element === 'string' ? $(element) : $(element);
      if ($element.length === 0) {
        console.warn('[Sidebar] Event target not found:', element);
        return;
      }

      $element.one(eventType, handler);

      if (window.sidebarDebug) {
        console.debug(`[Sidebar] One-time event bound: ${eventType} on`, element);
      }
    } catch (error) {
      console.error('[Sidebar] Event binding error:', eventType, error);
    }
  },
};

/**
 * Dependency checker for required globals
 */
export function checkDependencies(
  dependencies: Array<'jQuery' | 'localStorage' | 'replaceScriptButtons' | 'eventOn' | 'getButtonEvent'>,
): Record<string, boolean> {
  const results: Record<string, boolean> = {};
  const missing: string[] = [];

  for (const dep of dependencies) {
    let available = false;
    switch (dep) {
      case 'jQuery':
        available = typeof $ !== 'undefined';
        break;
      case 'localStorage':
        available = typeof localStorage !== 'undefined';
        break;
      case 'replaceScriptButtons':
        available = typeof (window as any).replaceScriptButtons === 'function';
        break;
      case 'eventOn':
        available = typeof (window as any).eventOn === 'function';
        break;
      case 'getButtonEvent':
        available = typeof (window as any).getButtonEvent === 'function';
        break;
    }

    results[dep] = available;
    if (!available) missing.push(dep);
  }

  if (missing.length > 0) {
    console.warn('[Sidebar] Missing dependencies:', missing.join(', '));
    if (window.sidebarDebug) {
      console.groupCollapsed('[Sidebar] Dependency check details');
      console.table(results);
      console.groupEnd();
    }
  } else if (window.sidebarDebug) {
    console.debug('[Sidebar] All dependencies available');
  }

  return results;
}

/**
 * Safe version of replaceScriptButtons with fallback
 */
export function safeReplaceScriptButtons(
  buttons: Array<{ name: string; visible: boolean; onclick?: () => void }>,
  fallbackAction?: () => void,
): boolean {
  if (typeof (window as any).replaceScriptButtons === 'function') {
    try {
      (window as any).replaceScriptButtons(buttons);
      console.log('[Sidebar] Script buttons replaced:', buttons.map(b => b.name).join(', '));
      return true;
    } catch (error) {
      console.error('[Sidebar] replaceScriptButtons error:', error);
      // Execute fallback if provided
      if (fallbackAction) {
        console.log('[Sidebar] Executing fallback action');
        fallbackAction();
      }
      return false;
    }
  }

  console.warn('[Sidebar] replaceScriptButtons not available');
  if (fallbackAction) {
    console.log('[Sidebar] Executing fallback action');
    fallbackAction();
  }
  return false;
}

/**
 * Safe version of eventOn with fallback
 */
export function safeEventOn(eventName: string, handler: () => void, fallbackAction?: () => void): boolean {
  if (typeof (window as any).eventOn === 'function') {
    try {
      (window as any).eventOn(eventName, handler);
      console.log('[Sidebar] Event handler registered:', eventName);
      return true;
    } catch (error) {
      console.error('[Sidebar] eventOn error:', error);
      // Execute fallback if provided
      if (fallbackAction) {
        console.log('[Sidebar] Executing fallback action');
        fallbackAction();
      }
      return false;
    }
  }

  console.warn('[Sidebar] eventOn not available');
  if (fallbackAction) {
    console.log('[Sidebar] Executing fallback action');
    fallbackAction();
  }
  return false;
}

/**
 * Safe version of getButtonEvent with fallback
 */
export function safeGetButtonEvent(buttonName: string, fallbackEventName?: string): string | null {
  if (typeof (window as any).getButtonEvent === 'function') {
    try {
      const eventName = (window as any).getButtonEvent(buttonName);
      console.log('[Sidebar] Button event retrieved:', buttonName, '->', eventName);
      return eventName;
    } catch (error) {
      console.error('[Sidebar] getButtonEvent error:', error);
      return fallbackEventName || null;
    }
  }

  console.warn('[Sidebar] getButtonEvent not available');
  return fallbackEventName || null;
}

/**
 * Storage key generation improvements with chat isolation
 */
export function generateStorageKey(prefix: string = 'tavern_helper_quick_notes'): string {
  let chatId = 'global';

  // Try to get chat ID from SillyTavern
  if (window.SillyTavern && typeof window.SillyTavern.getCurrentChatId === 'function') {
    try {
      const id = window.SillyTavern.getCurrentChatId();
      if (id !== undefined && id !== null) {
        chatId = `chat_${id}`;
      }
    } catch (error) {
      console.warn('[Sidebar] Failed to get chat ID:', error);
    }
  }

  // Add user session identifier for additional isolation
  const sessionId = sessionStorage.getItem('tavern_helper_session') || 'default';

  return `${prefix}_${chatId}_${sessionId}`;
}

export default {
  showNotification,
  querySafe,
  eventUtils,
  checkDependencies,
  safeReplaceScriptButtons,
  safeEventOn,
  safeGetButtonEvent,
  generateStorageKey,
};
