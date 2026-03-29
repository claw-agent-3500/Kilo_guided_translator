import { useEffect, useCallback } from 'react';

interface ShortcutMap {
    [key: string]: () => void;
}

/**
 * Hook to register keyboard shortcuts.
 * Pass a map of key combos → handlers.
 * 
 * Supported formats:
 * - "Escape", "Enter", "Tab"
 * - "Ctrl+S", "Ctrl+Enter", "Shift+Enter"
 * - "Mod+S" (Cmd on Mac, Ctrl elsewhere)
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap, deps: unknown[] = []) {
    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

            // Build the key string
            const parts: string[] = [];
            if (event.ctrlKey && !isMac) parts.push('Ctrl');
            if (event.metaKey && isMac) parts.push('Mod');
            if (event.altKey) parts.push('Alt');
            if (event.shiftKey) parts.push('Shift');

            // Normalize the key name
            let keyName = event.key;
            if (keyName === ' ') keyName = 'Space';
            if (keyName.length === 1) keyName = keyName.toUpperCase();

            parts.push(keyName);
            const combo = parts.join('+');

            // Check for Mod+ combos
            const modCombo = combo.replace(/^(Ctrl|Meta)\+/, 'Mod+');

            if (shortcuts[combo] || shortcuts[modCombo]) {
                event.preventDefault();
                (shortcuts[combo] || shortcuts[modCombo])();
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [shortcuts, ...deps]
    );

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
}
