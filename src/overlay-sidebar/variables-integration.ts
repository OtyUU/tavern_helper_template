// Variables integration for overlay sidebar quick notes
import { loadNotes, loadOCCNotes, saveNotes, saveOCCNotes } from './notes-storage';
import { querySafe } from './utils';

declare global {
    interface Window {
        tavern_helper?: {
            registerVariable?(name: string, config: {
                get: () => any;
                set?: (value: any) => void;
                description?: string;
            }): void;
        };
    }
}

// Function to get current script ID (if running in script context)
declare function getScriptId(): string;

// Standard tavern variable functions
declare function insertOrAssignVariables(
    variables: Record<string, any>,
    option: { type: 'chat' | 'global' | 'preset' | 'character' | 'message' | 'script' | 'extension' }
): Record<string, any>;

declare function getVariables(
    option: { type: 'chat' | 'global' | 'preset' | 'character' | 'message' | 'script' | 'extension' }
): Record<string, any>;

const VARIABLE_NAME = 'overlaySidebar_quickNotes';
const VARIABLE_DESCRIPTION = 'Quick notes from the overlay sidebar';
const VARIABLE_NAME_OCC = 'overlaySidebar_OCC';
const VARIABLE_DESCRIPTION_OCC = 'Out-of-character notes from the overlay sidebar';

/**
 * Update the tavern variable system with the current notes content
 * This ensures {{getvar::overlaySidebar_quickNotes}} macro works
 */
function updateTavernVariable(content: string): void {
    try {
        // Update script variable (since script variables are accessible via macros)
        if (typeof insertOrAssignVariables === 'function') {
            insertOrAssignVariables(
                { [VARIABLE_NAME]: content },
                { type: 'script' }
            );
            // Also update chat variable for broader accessibility
            insertOrAssignVariables(
                { [VARIABLE_NAME]: content },
                { type: 'chat' }
            );
            console.log(`[Tavern Helper] Updated tavern variable ${VARIABLE_NAME} with ${content.length} chars`);
        } else {
            // Fallback to localStorage
            fallbackVariableSync(content);
        }
    } catch (error) {
        console.error('[Tavern Helper] Failed to update tavern variable:', error);
        // Fallback to localStorage
        fallbackVariableSync(content);
    }
}

function updateOCCVariable(content: string): void {
    try {
        if (typeof insertOrAssignVariables === 'function') {
            insertOrAssignVariables(
                { [VARIABLE_NAME_OCC]: content },
                { type: 'script' }
            );
            insertOrAssignVariables(
                { [VARIABLE_NAME_OCC]: content },
                { type: 'chat' }
            );
            console.log(`[Tavern Helper] Updated tavern variable ${VARIABLE_NAME_OCC} with ${content.length} chars`);
        } else {
            fallbackOCCVariableSync(content);
        }
    } catch (error) {
        console.error('[Tavern Helper] Failed to update OCC tavern variable:', error);
        fallbackOCCVariableSync(content);
    }
}

/**
 * Retrieve current notes content from tavern variable system
 * This serves as a fallback for get()
 */
function retrieveFromTavernVariable(): string {
    try {
        // Try script variable first if function exists
        if (typeof getVariables === 'function') {
            const scriptVars = getVariables({ type: 'script' });
            if (scriptVars && typeof scriptVars[VARIABLE_NAME] === 'string') {
                return scriptVars[VARIABLE_NAME];
            }
            // Try chat variable
            const chatVars = getVariables({ type: 'chat' });
            if (chatVars && typeof chatVars[VARIABLE_NAME] === 'string') {
                return chatVars[VARIABLE_NAME];
            }
        } else {
            // Fallback to localStorage
            return getNotesFromFallback();
        }
    } catch (error) {
        // Silently fail, fall back to localStorage
    }
    return '';
}

function retrieveOCCFromTavernVariable(): string {
    try {
        if (typeof getVariables === 'function') {
            const scriptVars = getVariables({ type: 'script' });
            if (scriptVars && typeof scriptVars[VARIABLE_NAME_OCC] === 'string') {
                return scriptVars[VARIABLE_NAME_OCC];
            }
            const chatVars = getVariables({ type: 'chat' });
            if (chatVars && typeof chatVars[VARIABLE_NAME_OCC] === 'string') {
                return chatVars[VARIABLE_NAME_OCC];
            }
        } else {
            return getOCCNotesFromFallback();
        }
    } catch (error) {}
    return '';
}

export function registerQuickNotesVariable(): void {
    // First, ensure the variable is present in the tavern variable system
    const currentNotes = loadNotes();
    updateTavernVariable(currentNotes);
    
    // Also register with custom tavern_helper API if available (for UI integration)
    if (window.tavern_helper?.registerVariable) {
        try {
            window.tavern_helper.registerVariable(VARIABLE_NAME, {
                get: () => {
                    // First try localStorage, then fallback to tavern variable
                    const notes = loadNotes();
                    if (notes) return notes;
                    return retrieveFromTavernVariable();
                },
                set: (value) => {
                    if (typeof value === 'string') {
                        saveNotes(value);
                        updateTavernVariable(value);
                        // Update UI if sidebar is visible using safe selector
                        const textarea = querySafe('#tavern-helper-notes');
                        if (textarea) {
                            textarea.val(value);
                        }
                    }
                },
                description: VARIABLE_DESCRIPTION,
            });
            console.log(`[Tavern Helper] Registered custom tavern variable: ${VARIABLE_NAME}`);
        } catch (error) {
            console.error('[Tavern Helper] Failed to register custom variable:', error);
        }
    }
    
    console.log(`[Tavern Helper] Tavern variable ${VARIABLE_NAME} is now available for macros`);
}

export function registerOCCVariable(): void {
    // Ensure the OCC variable is present in tavern variable system
    const currentOCC = loadOCCNotes();
    updateOCCVariable(currentOCC);
    
    if (window.tavern_helper?.registerVariable) {
        try {
            window.tavern_helper.registerVariable(VARIABLE_NAME_OCC, {
                get: () => {
                    const occ = loadOCCNotes();
                    if (occ) return occ;
                    return retrieveOCCFromTavernVariable();
                },
                set: (value) => {
                    if (typeof value === 'string') {
                        saveOCCNotes(value);
                        updateOCCVariable(value);
                        const textarea = querySafe('#tavern-helper-occ');
                        if (textarea) {
                            textarea.val(value);
                        }
                    }
                },
                description: VARIABLE_DESCRIPTION_OCC,
            });
            console.log(`[Tavern Helper] Registered custom tavern variable: ${VARIABLE_NAME_OCC}`);
        } catch (error) {
            console.error('[Tavern Helper] Failed to register OCC custom variable:', error);
        }
    }
    
    console.log(`[Tavern Helper] Tavern variable ${VARIABLE_NAME_OCC} is now available for macros`);
}

/**
 * Function to sync notes to tavern variable system (call when notes change)
 * This is called immediately on input to ensure macros are updated in real-time
 */
export function syncNotesToVariable(content: string): void {
    updateTavernVariable(content);
}

/**
 * Function to sync OCC notes to tavern variable system
 */
export function syncOCCToVariable(content: string): void {
    updateOCCVariable(content);
}

/**
 * Fallback implementation using localStorage when tavern variable functions are not available
 */
export function fallbackVariableSync(content: string): void {
    try {
        localStorage.setItem('overlaySidebar_quickNotes_fallback', content);
        console.debug('[Tavern Helper] Fallback variable sync:', content.length, 'chars');
    } catch (error) {
        console.warn('[Tavern Helper] Fallback sync failed:', error);
    }
}

/**
 * Fallback implementation for OCC variable
 */
export function fallbackOCCVariableSync(content: string): void {
    try {
        localStorage.setItem('overlaySidebar_OCC_fallback', content);
        console.debug('[Tavern Helper] Fallback OCC variable sync:', content.length, 'chars');
    } catch (error) {
        console.warn('[Tavern Helper] Fallback OCC sync failed:', error);
    }
}

/**
 * Retrieve notes from fallback storage
 */
export function getNotesFromFallback(): string {
    try {
        return localStorage.getItem('overlaySidebar_quickNotes_fallback') || '';
    } catch {
        return '';
    }
}

/**
 * Retrieve OCC notes from fallback storage
 */
export function getOCCNotesFromFallback(): string {
    try {
        return localStorage.getItem('overlaySidebar_OCC_fallback') || '';
    } catch {
        return '';
    }
}

// Export additional helper functions for external use
export {
    fallbackOCCVariableSync,
    getOCCNotesFromFallback, retrieveFromTavernVariable, syncOCCToVariable, updateTavernVariable,
    VARIABLE_DESCRIPTION, VARIABLE_DESCRIPTION_OCC, VARIABLE_NAME,
    VARIABLE_NAME_OCC
};

export function unregisterQuickNotesVariable(): void {
    // Currently there's no unregister API, but we could implement tracking if needed
    console.log(`[Tavern Helper] Variable ${VARIABLE_NAME} would be unregistered if API existed`);
}
