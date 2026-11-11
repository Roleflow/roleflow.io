// The setter prompt editor belongs to one business at a time.
//
// When the panel switches business, every piece of prompt state from the old
// business is cleared, and Save stays off until the new business's prompt has
// loaded. A save or restore that finishes after a switch is ignored, and it
// was sent with the business id from the moment it started.

export function resetPromptState(state) {
  state.setterPrompt = "";
  state.setterDraft = null;
  state.promptDraft = null;
  state.promptVersions = [];
  state.setterPrompts = [];
  state.setterCurrentId = "";
  state.setterTestedAt = null;
  state.setterPromptSaved = false;
  state.promptLoadedFor = "";
  return state;
}

// Mark the prompt in state as the one for this business.
export function markPromptLoaded(state, businessId) {
  state.promptLoadedFor = String(businessId || "");
  return state;
}

// True when the prompt in the editor is the active business's prompt. The
// local preview has no database, so it is always ready.
export function promptReady(state) {
  if (!state) return false;
  if (!state.supabase) return true;
  const id = String(state.businessId || "");
  return Boolean(id) && state.promptLoadedFor === id;
}

// The business a prompt save should go to, fixed at the moment Save is pressed,
// or "" when it must not be sent.
export function promptSaveTarget(state) {
  return promptReady(state) ? String(state.businessId || (state.supabase ? "" : "preview")) : "";
}

// A response belongs to the screen only if the same business is still open.
export function stillOn(state, businessId) {
  return Boolean(state) && String(state.businessId || "") === String(businessId || "");
}
