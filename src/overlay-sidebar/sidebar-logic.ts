// Sidebar logic for overlay sidebar
import { deteleportStyle, teleportStyle } from '../../util/script';
import { eventUtils, querySafe } from './utils';

// Configuration constants for sidebar appearance
const SIDEBAR_WIDTH = '500px'; // Default width, can be modified here
const SIDEBAR_ID = 'tavern-helper-overlay-sidebar';

declare global {
    interface Window {
        toggleSidebar: () => void;
        hideSidebar: () => void;
        showSidebar: () => void;
        saveCurrentNotes?: () => void;
        loadNotes?: () => string;
        // Debug functions
        testSidebarButton?: () => boolean;
        enableSidebarDebug?: (verbose?: boolean) => void;
        sidebarDebug?: boolean;
        // Additional properties from other modules
        tavern_helper?: {
            registerVariable?(name: string, config: {
                get: () => any;
                set?: (value: any) => void;
                description?: string;
            }): void;
        };
        triggerAutoSave?: () => void;
    }
}

let sidebarVisible = false;

function injectCSS(): void {
    const css = `
        .tavern-helper-overlay-sidebar {
            position: fixed;
            top: 0;
            right: 0;
            width: ${SIDEBAR_WIDTH};
            height: 100vh;
            background: rgba(29, 33, 40, 0.9);
            backdrop-filter: blur(0px);
            border-left: 0.5px solid rgba(0, 0, 0, 0.5);
            border-top-left-radius: 12px;
            border-bottom-left-radius: 12px;
            z-index: 999999;
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            transform: translateX(100%);
            padding: 0;
            color: rgba(207, 207, 197, 1);
            overflow: hidden;
            box-shadow: -1px 0 0 rgba(0, 0, 0, 0.5);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            display: flex;
            flex-direction: column;
        }

        .tavern-helper-overlay-sidebar.visible {
            transform: translateX(0);
        }

        .tavern-helper-overlay-sidebar .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 20px;
            height: 40px;
            background: rgba(29, 33, 40, 0.95);
            border-bottom: 0.5px solid rgba(0, 0, 0, 0.8);
            border-top-left-radius: 12px;
            backdrop-filter: blur(0px);
            flex-shrink: 0;
        }

        .tavern-helper-overlay-sidebar .header-title {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .tavern-helper-overlay-sidebar .header-icon {
            width: 20px;
            height: 20px;
            opacity: 0.7;
            color: rgba(207, 207, 197, 0.8);
        }

        .tavern-helper-overlay-sidebar .header h3 {
            margin: 0;
            font-size: 15px;
            font-weight: 500;
            letter-spacing: 0.3px;
            color: rgba(207, 207, 197, 1);
        }

        .tavern-helper-overlay-sidebar .close-btn {
            background: rgba(29, 33, 40, 0.6);
            border: 0.5px solid rgba(0, 0, 0, 0.8);
            color: rgba(207, 207, 197, 0.9);
            cursor: pointer;
            padding: 6px 10px;
            border-radius: 8px;
            font-size: 18px;
            line-height: 1;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 32px;
            height: 32px;
        }

        .tavern-helper-overlay-sidebar .close-btn:hover {
            background: rgba(40, 45, 52, 0.8);
            border-color: rgba(0, 0, 0, 0.9);
            color: rgba(237, 234, 234, 1);
        }

        .tavern-helper-overlay-sidebar .close-btn:active {
            transform: scale(0.95);
        }

        .tavern-helper-overlay-sidebar .content {
            display: flex;
            flex-direction: column;
            flex: 1;
            padding: 20px;
            overflow: hidden;
            gap: 10px;
        }

        .tavern-helper-overlay-sidebar textarea {
            width: 100%;
            background: rgba(29, 33, 40, 0.88);
            border: 0.5px solid rgba(0, 0, 0, 0.8);
            color: rgba(207, 207, 197, 1);
            padding: 14px;
            border-radius: 10px;
            font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
            resize: none;
            font-size: 13.5px;
            line-height: 1.6;
            transition: all 0.2s ease;
        }

        .tavern-helper-overlay-sidebar textarea#tavern-helper-notes {
            flex: 1; /* ~70% */
            min-height: 180px;
        }

        .tavern-helper-overlay-sidebar textarea#tavern-helper-occ {
            flex: 0.15; /* ~30% */
            min-height: 60px;
        }

        .tavern-helper-overlay-sidebar textarea:focus {
            outline: none;
            border-color: rgb(92, 94, 100);
            background: rgba(29, 33, 40, 0.95);
            box-shadow: none;
        }

        .tavern-helper-overlay-sidebar textarea::placeholder {
            color: rgba(145, 145, 145, 1);
            font-style: italic;
        }

        .tavern-helper-overlay-sidebar textarea::-webkit-scrollbar {
            width: 8px;
        }

        .tavern-helper-overlay-sidebar textarea::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
        }

        .tavern-helper-overlay-sidebar textarea::-webkit-scrollbar-thumb {
            background: rgba(60, 65, 72, 0.8);
            border-radius: 4px;
            transition: background 0.2s ease;
        }

        .tavern-helper-overlay-sidebar textarea::-webkit-scrollbar-thumb:hover {
            background: rgba(80, 85, 92, 1);
        }
    `;
    
    $('<style>').text(css).appendTo('head');
    teleportStyle();
}

function injectHTML(): void {
    if (querySafe(`#${SIDEBAR_ID}`)?.length ?? 0 > 0) {
        return;
    }

    // SVG icon for notes (matches SillyTavern's icon style)
    const noteIcon = `<svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
    </svg>`;

    const html = `
        <div id="${SIDEBAR_ID}" class="tavern-helper-overlay-sidebar">
            <div class="header">
                <div class="header-title">
                    ${noteIcon}
                    <h3>Quick Notes</h3>
                </div>
                <button class="close-btn" onclick="window.hideSidebar()" title="Close (Esc)">×</button>
            </div>
            <div class="content">
                <textarea id="tavern-helper-notes" placeholder="Take your quick notes here...\n\nSaved automatically when you close the sidebar." spellcheck="true"></textarea>
                <textarea id="tavern-helper-occ" placeholder="Out of character (OCC)" spellcheck="true"></textarea>
            </div>
        </div>
    `;
    
    $(html).appendTo('body');
}

function setupEventListeners(): void {
    // Setup close button via event delegation using safe selector
    eventUtils.on(`#${SIDEBAR_ID} .close-btn`, 'click', hideSidebar);
    
    // Save on textarea blur (immediate save) with error handling
    eventUtils.on('#tavern-helper-notes', 'blur', function() {
        const debug = (window as any).sidebarDebug;
        if (debug) {
            console.debug('[Tavern Helper] Textarea blur detected');
        }
        
        try {
            if (typeof window.saveCurrentNotes === 'function') {
                window.saveCurrentNotes();
                if (debug) {
                    console.info('[Tavern Helper] Auto-saved on blur');
                }
            }
        } catch (e) {
            console.warn('[Tavern Helper] Blur save error:', e);
        }
        // Also trigger auto-save immediately
        if (typeof (window as any).triggerAutoSave === 'function') {
            (window as any).triggerAutoSave();
        }
    });
    
    // Save on OCC textarea blur
    eventUtils.on('#tavern-helper-occ', 'blur', function(this: HTMLElement) {
        const debug = (window as any).sidebarDebug;
        if (debug) {
            console.debug('[Tavern Helper] OCC textarea blur detected');
        }
        try {
            // Save OCC notes if saveCurrentOCC function exists
            if (typeof (window as any).saveCurrentOCC === 'function') {
                (window as any).saveCurrentOCC();
            } else {
                // Fallback: save via storage API
                const content = $(this).val() as string;
                (window as any).saveOCCNotes?.(content);
            }
        } catch (e) {
            console.warn('[Tavern Helper] OCC blur save error:', e);
        }
    });
    
    // Escape key to close sidebar
    eventUtils.on(document, 'keydown', function(e: JQuery.Event) {
        if (e.key === 'Escape' && sidebarVisible) {
            console.log('[Tavern Helper] Escape key pressed, closing sidebar');
            hideSidebar();
        }
    });
}

export function toggleSidebar(): void {
    const debug = (window as any).sidebarDebug;
    
    console.groupCollapsed(`[Tavern Helper] toggleSidebar called, current visibility: ${sidebarVisible}`);
    console.info('Action:', sidebarVisible ? 'Hiding' : 'Showing');
    if (debug) {
        console.debug('Full state:', { sidebarVisible, SIDEBAR_ID });
    }
    
    sidebarVisible = !sidebarVisible;
    const sidebar = querySafe(`#${SIDEBAR_ID}`);
    
    sidebar?.toggleClass('visible', sidebarVisible);
    console.log(`[Tavern Helper] Sidebar visibility set to: ${sidebarVisible}`);
    
    if (sidebarVisible) {
        // Focus main textarea when showing with slight delay for DOM ready
        setTimeout(() => {
            const textarea = querySafe('#tavern-helper-notes');
            if (textarea?.length) {
                textarea.trigger('focus');
                console.info('[Tavern Helper] Textarea focused');
            } else {
                console.warn('[Tavern Helper] Textarea not found for focus');
            }
        }, 100);
        
        // Load saved notes with safety check
        if (typeof window.loadNotes === 'function') {
            const notes = window.loadNotes();
            const textarea = querySafe('#tavern-helper-notes');
            textarea?.val(notes);
            console.log(`[Tavern Helper] Notes loaded, length: ${notes.length}`);
            if (debug && notes.length > 0) {
                console.debug('First 100 chars:', notes.substring(0, 100) + '...');
            }
        } else {
            console.error('[Tavern Helper] window.loadNotes not defined');
        }
        
        // Load OCC notes
        if (typeof (window as any).loadOCCNotes === 'function') {
            const occNotes = (window as any).loadOCCNotes();
            const occTextarea = querySafe('#tavern-helper-occ');
            occTextarea?.val(occNotes);
            console.log(`[Tavern Helper] OCC notes loaded, length: ${occNotes.length}`);
        }
    } else {
        // Save both textareas when hiding
        if (typeof window.saveCurrentNotes === 'function') {
            console.log('[Tavern Helper] Auto-saving before hiding');
            window.saveCurrentNotes();
        } else {
            console.warn('[Tavern Helper] window.saveCurrentNotes not defined, skipping auto-save');
        }
        
        if (typeof (window as any).saveCurrentOCC === 'function') {
            (window as any).saveCurrentOCC();
        } else if (typeof (window as any).saveOCCNotes === 'function') {
            const occContent = $('#tavern-helper-occ').val() as string;
            (window as any).saveOCCNotes(occContent);
        }
    }
    
    console.groupEnd();
}

export function showSidebar(): void {
    if (!sidebarVisible) {
        toggleSidebar();
    }
}

export function hideSidebar(): void {
    if (sidebarVisible) {
        toggleSidebar();
    }
}

export function initializeSidebar(): void {
    const debug = (window as any).sidebarDebug;
    
    // Use different console methods for better visibility
    console.groupCollapsed('[Tavern Helper] Initializing sidebar...');
    console.info('Start time:', new Date().toISOString());
    console.debug('Debug flag:', debug);
    
    injectCSS();
    console.log('[Tavern Helper] CSS injected');
    
    injectHTML();
    console.log('[Tavern Helper] HTML injected');
    
    setupEventListeners();
    console.log('[Tavern Helper] Event listeners set up');
    
    // Expose functions globally for inline handlers
    window.toggleSidebar = toggleSidebar;
    window.hideSidebar = hideSidebar;
    window.showSidebar = showSidebar;
    
    // Expose debug functions regardless of debug flag (but only attach if not already present)
    (window as any).testSidebarButton = testSidebarButton;
    (window as any).enableSidebarDebug = enableSidebarDebug;
    console.info('[Tavern Helper] Debug functions exposed', debug ? '(debug mode active)' : '(global)');
    
    console.log('[Tavern Helper] Global functions exposed');
    console.groupEnd();
    
    // Visual debug indicator if debug mode is active
    if (debug) {
        addVisualDebugIndicator();
    }
}

// Debug test function that can be called from browser console
export function testSidebarButton(): boolean {
    console.group('[Tavern Helper] Debug Test: Autosave Functionality');
    console.info('Testing autosave functionality at', new Date().toISOString());
    
    console.log('Save button removed - testing autosave functionality instead');
    
    // Test storage functions
    const storageAvailable = typeof localStorage !== 'undefined';
    console.log('localStorage available:', storageAvailable);
    
    const saveFnAvailable = typeof window.saveCurrentNotes === 'function';
    console.log('saveCurrentNotes function available:', saveFnAvailable);
    
    const textareaExists = querySafe('#tavern-helper-notes') !== null;
    console.log('Textarea exists:', textareaExists);
    
    const result = storageAvailable && saveFnAvailable && textareaExists;
    console.log('Overall test result:', result ? 'PASS' : 'FAIL');
    console.groupEnd();
    
    return result;
}

// Enable debug mode with optional verbosity
export function enableSidebarDebug(verbose = true): void {
    (window as any).sidebarDebug = true;
    console.warn('[Tavern Helper] Debug mode enabled', verbose ? '(verbose)' : '');
    if (verbose) {
        console.log('[Tavern Helper] Current environment:', {
            sidebarVisible,
            sidebarId: SIDEBAR_ID,
            jQueryLoaded: typeof $ !== 'undefined',
            textareaExists: $('#tavern-helper-notes').length > 0,
            debugFlag: (window as any).sidebarDebug
        });
    }
}

// Add a small visual indicator when debug is active
function addVisualDebugIndicator(): void {
    const indicator = $('<div>').css({
        position: 'fixed',
        bottom: '10px',
        right: '10px',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: '#ff5555',
        border: '2px solid #ffb86c',
        zIndex: '1000000',
        opacity: '0.7',
        pointerEvents: 'none'
    }).attr('title', 'Sidebar Debug Mode Active').appendTo('body');
    
    // Add pulsing animation
    $('<style>').text(`
        @keyframes debugPulse {
            0% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 0.9; transform: scale(1.1); }
            100% { opacity: 0.3; transform: scale(1); }
        }
        #tavern-helper-debug-indicator {
            animation: debugPulse 2s infinite;
        }
    `).appendTo('head');
    
    indicator.attr('id', 'tavern-helper-debug-indicator');
    
    console.debug('[Tavern Helper] Visual debug indicator added');
}

export function cleanupSidebar(): void {
    $(`#${SIDEBAR_ID}`).remove();
    $(`style:contains(".tavern-helper-overlay-sidebar")`).remove();
    deteleportStyle();
    
    // Remove global functions (they are optional due to TypeScript strictness)
    delete (window as any).toggleSidebar;
    delete (window as any).hideSidebar;
    delete (window as any).showSidebar;
    delete (window as any).testSidebarButton;
    delete (window as any).enableSidebarDebug;
}