import { EditorSelection } from '@codemirror/state';

export default (context: { contentScriptId: string, postMessage: any }) => {
    return {
        plugin: async (codeMirrorWrapper: any) => {
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

            // Joplin rebuilds the editor when a note changes underneath it, which
            // is how a Time Slip correction arrives. The plugin cannot call into
            // an editor that does not exist yet, so the position it captured
            // before the write is collected here instead, once we are live.
            try {
                const pending = await context.postMessage({ kind: 'takePendingCursor' });
                if (pending && typeof pending.anchor === 'number') {
                    const view = codeMirrorWrapper.cm6;
                    const docLength = view.state.doc.length;
                    const anchor = Math.min(pending.anchor, docLength);
                    const head = Math.min(
                        typeof pending.head === 'number' ? pending.head : anchor, docLength);

                    // Restoring the position alone is not enough: the rebuilt
                    // editor is unfocused, so the caret does not render and
                    // typing goes nowhere. Only take focus back if the editor
                    // held it when the position was captured, so this cannot
                    // pull the user out of the panel or another note.
                    // document.hasFocus() keeps this from yanking the user back
                    // if they left for the panel or another window during the
                    // write and rebuild, which is not instant on a large log.
                    const restoreFocus = pending.hasFocus === true && document.hasFocus();

                    view.dispatch({
                        selection: EditorSelection.create([EditorSelection.range(anchor, head)]),
                        scrollIntoView: restoreFocus
                    });

                    if (restoreFocus) {
                        view.focus();
                    }
                }
            } catch (error) {
                console.warn('[TIME-SLIP] Could not restore the cursor after the editor reloaded:', error);
            }
        },
    };
};