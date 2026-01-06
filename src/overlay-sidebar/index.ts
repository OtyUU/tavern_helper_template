import { setupAutoSave } from './notes-storage';
import { initializeSidebar } from './sidebar-logic';
import { registerOCCVariable, registerQuickNotesVariable } from './variables-integration';
import './加载和卸载时执行函数';

// Debug logging initiation with comprehensive environment detection
console.info('[Tavern Helper] Sidebar script loading at', new Date().toISOString());
console.debug('[Tavern Helper] Environment info:', {
  userAgent: navigator.userAgent,
  location: window.location.href,
  jQuery: typeof $ !== 'undefined' ? $.fn?.jquery || 'unknown' : 'not loaded',
  jQueryVersion: typeof jQuery !== 'undefined' ? jQuery.fn?.jquery || 'unknown' : 'not loaded',
  consoleAvailable: typeof console !== 'undefined',
  localStorageAvailable: typeof localStorage !== 'undefined',
  sidebarDebug: (window as any).sidebarDebug || 'not set',
  scriptVersion: '2.0-revised',
});

// Global debug flag that can be toggled via browser console
(window as any).sidebarDebug = (window as any).sidebarDebug || false;

// Environment safety checks
if (typeof $ === 'undefined') {
  console.warn('[Tavern Helper] jQuery ($) not found - sidebar may not work correctly');
}
if (typeof localStorage === 'undefined') {
  console.error('[Tavern Helper] localStorage unavailable - notes cannot be saved');
}

// Signal that script loaded
console.log('[Tavern Helper] Sidebar module loaded successfully');

// Wait for DOM ready before initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Tavern Helper] DOM ready, initializing sidebar');
    initializeSidebar();
    registerQuickNotesVariable();
    registerOCCVariable();
    setupAutoSave();
    console.log('[Tavern Helper] Full initialization completed');
  });
} else {
  // DOM already loaded
  console.log('[Tavern Helper] DOM already ready, initializing immediately');
  initializeSidebar();
  registerQuickNotesVariable();
  registerOCCVariable();
  setupAutoSave();
  console.log('[Tavern Helper] Full initialization completed');
}

// Global availability test function
(window as any).testSidebarAvailability = function () {
  console.group('[Tavern Helper] Global Function Availability Test');

  const functions = [
    'toggleSidebar',
    'hideSidebar',
    'showSidebar',
    'testSidebarButton',
    'enableSidebarDebug',
    'saveCurrentNotes',
    'loadNotes',
  ];

  const results: Record<string, string> = {};
  let allAvailable = true;

  functions.forEach(fnName => {
    const exists = typeof (window as any)[fnName] === 'function';
    results[fnName] = exists ? '✅ Available' : '❌ Missing';
    if (!exists) allAvailable = false;
    console.log(`${fnName}: ${results[fnName]}`);
  });

  console.log(`Overall: ${allAvailable ? '✅ All functions available' : '❌ Some functions missing'}`);
  console.log('Window object check:', Object.keys(results));
  console.groupEnd();
  return allAvailable;
};

// Auto-run test if debug mode is enabled
if ((window as any).sidebarDebug) {
  setTimeout(() => {
    console.log('[Tavern Helper] Auto-running availability test...');
    (window as any).testSidebarAvailability();
  }, 1000);
}
