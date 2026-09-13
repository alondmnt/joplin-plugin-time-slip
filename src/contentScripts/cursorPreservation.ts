import { EditorSelection } from '@codemirror/state';

// Deprecated, and no longer wired to anything.
//
// These commands existed to carry the caret across the editor rebuild that a
// Time Slip correction triggers. Since corrections no longer run while the note
// is open (#9), there is no caret to carry: the writes that remain come from the
// panel, where the editor does not hold focus. The script is still registered so
// the commands stay available, but nothing in the plugin calls them.

export default (context: { contentScriptId: string, postMessage: any }) => {
    return {
        plugin: (codeMirrorWrapper: any) => {
            // Exit if not a CodeMirror 6 editor
            if (!codeMirrorWrapper.cm6) return;

            // Register command to get cursor position
            codeMirrorWrapper.registerCommand('timeSlip__getCursorPosition', () => {
                const view = codeMirrorWrapper.cm6;
                const selection = view.state.selection;
                const mainSelection = selection.main;
                
                return {
                    anchor: mainSelection.anchor,
                    head: mainSelection.head,
                    empty: mainSelection.empty,
                    hasFocus: view.hasFocus
                };
            });

            // Register command to set cursor position with content update
            codeMirrorWrapper.registerCommand('timeSlip__updateContentWithCursor', (content: string, cursorPos?: any) => {
                const view = codeMirrorWrapper.cm6;
                
                try {
                    let selection: EditorSelection;
                    
                    if (cursorPos && typeof cursorPos.anchor === 'number') {
                        // Ensure cursor position is within bounds of new content
                        const contentLength = content.length;
                        const safeAnchor = Math.min(cursorPos.anchor, contentLength);
                        const safeHead = cursorPos.head !== undefined ? Math.min(cursorPos.head, contentLength) : safeAnchor;
                        
                        selection = EditorSelection.create([
                            EditorSelection.range(safeAnchor, safeHead)
                        ]);
                    } else {
                        // Fallback: place cursor at the end
                        selection = EditorSelection.create([
                            EditorSelection.cursor(content.length)
                        ]);
                    }

                    // Dispatch transaction to update content and cursor
                    const transaction = view.state.update({
                        changes: {
                            from: 0,
                            to: view.state.doc.length,
                            insert: content
                        },
                        selection: selection
                    });

                    view.dispatch(transaction);
                    return { success: true };
                    
                } catch (error) {
                    console.error('[TIME-SLIP] Error updating content with cursor:', error);
                    
                    // Fallback: just update content without cursor preservation
                    try {
                        const transaction = view.state.update({
                            changes: {
                                from: 0,
                                to: view.state.doc.length,
                                insert: content
                            }
                        });
                        view.dispatch(transaction);
                        return { success: true, cursorPreserved: false };
                    } catch (fallbackError) {
                        console.error('[TIME-SLIP] Fallback content update failed:', fallbackError);
                        return { success: false, error: fallbackError.message };
                    }
                }
            });
        },
    };
};