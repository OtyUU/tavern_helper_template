// Notes storage functionality for overlay sidebar
import { generateStorageKey, querySafe } from './utils';
import { syncNotesToVariable, syncOCCToVariable } from './variables-integration';

declare global {
    interface Window {
        SillyTavern?: {
            getCurrentChatId(): number;
        };
        saveCurrentNotes?(): void;
        saveCurrentOCC?(): void;
        loadNotes?(): string;
        syncNotesToVariable?(content: string): void;
    }
}

function getStorageKey(): string {
    // Use improved key generation with chat isolation
    return generateStorageKey();
}

function getOCCStorageKey(): string {
    // Use different prefix for OCC notes
    return generateStorageKey('tavern_helper_occ_notes');
}

export function saveNotes(content: string): void {
    try {
        const storageKey = getStorageKey();
        localStorage.setItem(storageKey, content);
        console.log(`[Tavern Helper] Notes saved for ${storageKey}, length: ${content.length}`);
        // Sync to tavern variable system for macro accessibility
        syncNotesToVariable(content);
        console.log(`[Tavern Helper] Variable sync attempted`);
    } catch (e) {
        console.error('[Tavern Helper] Failed to save notes:', e);
    }
}

export function saveOCCNotes(content: string): void {
    try {
        const storageKey = getOCCStorageKey();
        localStorage.setItem(storageKey, content);
        console.log(`[Tavern Helper] OCC notes saved for ${storageKey}, length: ${content.length}`);
        // Sync to tavern variable system for macro accessibility
        syncOCCToVariable(content);
        // Log success to console instead of showing UI notification
        console.log('[Tavern Helper] OCC Notes: OCC notes saved successfully!');
        console.log(`[Tavern Helper] OCC variable sync completed`);
    } catch (e) {
        console.error('[Tavern Helper] Failed to save OCC notes:', e);
        // Log error to console instead of showing UI notification
        console.error('[Tavern Helper] OCC Notes: Failed to save OCC notes');
    }
}

export function loadNotes(): string {
    try {
        const storageKey = getStorageKey();
        const content = localStorage.getItem(storageKey) || '';
        console.log(`[Tavern Helper] Notes loaded for ${storageKey}, length: ${content.length}`);
        return content;
    } catch (e) {
        console.error('[Tavern Helper] Failed to load notes:', e);
        return '';
    }
}

export function loadOCCNotes(): string {
    try {
        const storageKey = getOCCStorageKey();
        const content = localStorage.getItem(storageKey) || '';
        console.log(`[Tavern Helper] OCC notes loaded for ${storageKey}, length: ${content.length}`);
        return content;
    } catch (e) {
        console.error('[Tavern Helper] Failed to load OCC notes:', e);
        return '';
    }
}

export function clearNotes(): void {
    try {
        localStorage.removeItem(getStorageKey());
        console.log(`[Tavern Helper] Notes cleared for ${getStorageKey()}`);
    } catch (e) {
        console.error('[Tavern Helper] Failed to clear notes:', e);
    }
}

export function clearOCCNotes(): void {
    try {
        localStorage.removeItem(getOCCStorageKey());
        console.log(`[Tavern Helper] OCC notes cleared for ${getOCCStorageKey()}`);
    } catch (e) {
        console.error('[Tavern Helper] Failed to clear OCC notes:', e);
    }
}

// Auto-save configuration
export interface AutoSaveConfig {
    enabled: boolean;
    delay: number; // milliseconds
}

// Default configuration
export const DEFAULT_AUTO_SAVE_CONFIG: AutoSaveConfig = {
    enabled: true,
    delay: 1000, // 1 second
};

let autoSaveTimeout: number | null = null;
let occAutoSaveTimeout: number | null = null;
let currentConfig: AutoSaveConfig = { ...DEFAULT_AUTO_SAVE_CONFIG };

// Update configuration
export function configureAutoSave(config: Partial<AutoSaveConfig>): void {
    currentConfig = { ...DEFAULT_AUTO_SAVE_CONFIG, ...config };
    console.log(`[Tavern Helper] Auto-save configured: ${currentConfig.enabled ? 'enabled' : 'disabled'} with ${currentConfig.delay}ms delay`);
    
    // Clear any pending timeout if disabled
    if (!currentConfig.enabled && autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
    }
}

// Core auto-save functionality
export function setupAutoSave(): void {
    $(document).on('input', '#tavern-helper-notes', function() {
        if (!currentConfig.enabled) return;
        
        // Immediate sync to tavern variables for macro accessibility
        const content = $(this).val() as string;
        syncNotesToVariable(content);
        console.log(`[Tavern Helper] Immediate variable sync (${content.length} chars)`);
        
        // Debounced localStorage save for performance
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
        }
        autoSaveTimeout = window.setTimeout(() => {
            saveNotes(content);
            console.log(`[Tavern Helper] Auto-saved notes to localStorage (${content.length} chars)`);
        }, currentConfig.delay);
    });

    // Separate listener for OCC textarea
    $(document).on('input', '#tavern-helper-occ', function() {
        if (!currentConfig.enabled) return;
        
        const content = $(this).val() as string;
        // Immediate sync to OCC variable
        syncOCCToVariable(content);
        console.log(`[Tavern Helper] Immediate OCC variable sync (${content.length} chars)`);
        
        // Debounced localStorage save for OCC
        if (occAutoSaveTimeout) {
            clearTimeout(occAutoSaveTimeout);
        }
        occAutoSaveTimeout = window.setTimeout(() => {
            saveOCCNotes(content);
            console.log(`[Tavern Helper] Auto-saved OCC notes to localStorage (${content.length} chars)`);
        }, currentConfig.delay);
    });
}

// Manual trigger for auto-save (e.g., before unload)
export function triggerAutoSave(): void {
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
    }
    // Use safe selector to avoid errors if element doesn't exist
    const notesElement = querySafe('#tavern-helper-notes');
    const content = notesElement ? (notesElement.val() as string) : '';
    saveNotes(content);
}

// Cleanup auto-save
export function cleanupAutoSave(): void {
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
    }
    if (occAutoSaveTimeout) {
        clearTimeout(occAutoSaveTimeout);
        occAutoSaveTimeout = null;
    }
}

// Export global functions
window.saveCurrentNotes = function() {
    console.log('[Tavern Helper] Manual save triggered');
    const content = $('#tavern-helper-notes').val() as string;
    console.log(`[Tavern Helper] Saving content length: ${content.length}`);
    saveNotes(content);
    // Log to console instead of showing UI notification
    console.log('[Tavern Helper] Quick Notes: Notes saved successfully!');
};

window.saveCurrentOCC = function() {
    console.log('[Tavern Helper] Manual OCC save triggered');
    const content = $('#tavern-helper-occ').val() as string;
    console.log(`[Tavern Helper] Saving OCC content length: ${content.length}`);
    saveOCCNotes(content);
    // Notification already logged in saveOCCNotes
};

window.loadNotes = function() {
    return loadNotes();
};
