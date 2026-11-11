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

// The whole business (settings, agent cards, switches), not only its prompt.
// While the panel switches business, nothing that writes to "this business"
// may run: the form values on screen could still be the old business's, and
// the save would go to the new one.
export function startBusinessSwitch(state, businessId) {
  state.businessLoadedFor = "";
  state.switchingTo = String(businessId || "");
  return state;
}

export function markBusinessLoaded(state, businessId) {
  state.businessLoadedFor = String(businessId || "");
  if (state.switchingTo === state.businessLoadedFor) state.switchingTo = "";
  return state;
}

// A switch that failed or was replaced stops showing the loading screen, but
// the business still does not count as loaded, so saves stay off.
export function endBusinessSwitch(state, businessId) {
  if (state.switchingTo === String(businessId || "")) state.switchingTo = "";
  return state;
}

// True when everything on screen belongs to the open business. The local
// preview has no database, so it is always ready.
export function businessReady(state) {
  if (!state) return false;
  if (!state.supabase) return true;
  const id = String(state.businessId || "");
  return Boolean(id) && state.businessLoadedFor === id;
}

// True while the open business is still loading after a switch; the panel
// shows the loading screen instead of the old business's panels.
export function businessSwitching(state) {
  return Boolean(state && state.supabase && state.switchingTo && state.switchingTo === String(state.businessId || ""));
}
