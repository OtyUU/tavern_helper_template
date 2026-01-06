// Load and unload handlers for overlay sidebar script
import { cleanupAutoSave, setupAutoSave, triggerAutoSave } from './notes-storage';
import { cleanupSidebar, initializeSidebar } from './sidebar-logic';
import { checkDependencies, safeEventOn, safeGetButtonEvent, safeReplaceScriptButtons } from './utils';
import { registerQuickNotesVariable, syncNotesToVariable } from './variables-integration';

// On script load
$(() => {
  console.log('[Tavern Helper] Overlay Sidebar script loading...');

  // Check dependencies for debugging (result unused intentionally for logging only)
  checkDependencies(['jQuery', 'localStorage', 'replaceScriptButtons', 'eventOn', 'getButtonEvent']);

  // Initialize the sidebar UI
  initializeSidebar();

  // Setup auto-save for notes
  setupAutoSave();

  // Setup safety auto-save on unload
  $(window).on('beforeunload', () => {
    triggerAutoSave();
  });

  // Also save when sidebar hides
  $(document).on('sidebar:hidden', () => {
    triggerAutoSave();
  });

  // Register tavern variable for quick notes
  registerQuickNotesVariable();

  // Add toggle button to SillyTavern script panel with safety check
  safeReplaceScriptButtons([{ name: '📝 Quick Notes', visible: true }], () => {
    // Fallback: try to add button manually if replaceScriptButtons fails
    console.warn('[Tavern Helper] Using fallback button placement');
    const button = $('<button>').text('📝 Quick Notes').addClass('script-button');
    button.on('click', () => {
      window.toggleSidebar?.();
    });
    $('#scriptButtons').append(button);
  });

  // Register button event with safety
  const buttonEvent = safeGetButtonEvent('📝 Quick Notes', 'scriptButton:click:quick_notes');
  if (buttonEvent) {
    safeEventOn(
      buttonEvent,
      () => {
        if (typeof window.toggleSidebar === 'function') {
          window.toggleSidebar();
        } else {
          console.warn('[Tavern Helper] toggleSidebar not available');
        }
      },
      () => {
        // Fallback: direct click handler
        console.warn('[Tavern Helper] Using fallback button click handler');
        $('button:contains("📝 Quick Notes")').on('click', () => {
          window.toggleSidebar?.();
        });
      },
    );
  } else {
    console.warn('[Tavern Helper] Could not get button event name');
  }

  // Expose syncNotesToVariable globally for notes-storage to call
  (window as any).syncNotesToVariable = syncNotesToVariable;

  console.log('[Tavern Helper] Overlay Sidebar script loaded successfully');
});

// On script unload (when user disables script or changes chat)
$(window).on('pagehide', () => {
  console.log('[Tavern Helper] Overlay Sidebar script unloading...');

  // Trigger final auto-save before unloading
  triggerAutoSave();

  // Cleanup sidebar UI
  cleanupSidebar();

  // Cleanup auto-save timers
  cleanupAutoSave();

  // Remove button from script panel
  // Note: replaceScriptButtons with empty array will remove our button
  // but may affect other scripts, so we rely on automatic cleanup

  console.log('[Tavern Helper] Overlay Sidebar script unloaded');
});

// Cleanup on chat change
if (typeof (window as any).tavern_events !== 'undefined') {
  const tavernEvents = (window as any).tavern_events;
  if (typeof (window as any).eventOn === 'function' && tavernEvents.CHAT_CHANGED) {
    (window as any).eventOn(tavernEvents.CHAT_CHANGED, () => {
      console.log('[Tavern Helper] Chat changed, sidebar cleanup');
      // Reload notes will happen when sidebar is next opened
    });
  }
}
