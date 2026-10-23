import { getSupabase, isConfigured, logout } from "../auth/supabase.js";
import { clearAuthParams, clearCallbackMemory, rememberCallback, resolveSession } from "../auth/callback.js";
import { bindShell, markNav, toast } from "../auth/ui.js";
import { renderSetter } from "./setter.js";

bindShell();

const hello = document.getElementById("account-hello");
const gate = document.getElementById("gate");
const section = document.getElementById("onboarding");
const setter = document.getElementById("setter");
const logoutBtn = document.getElementById("nav-logout");

function hideBoot() {
  const boot = document.getElementById("boot-state");
  if (boot) boot.hidden = true;
}

function showGate(message) {
  hideBoot();
  gate.hidden = false;
  gate.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "state";
  const title = document.createElement("h2");
  title.textContent = "Account unavailable";
  const p = document.createElement("p");
  p.textContent = message;
  panel.append(title, p);
  gate.append(panel);
  section.hidden = true;
  if (setter) setter.hidden = true;
}

logoutBtn.addEventListener("click", logout);

const arriving = rememberCallback(window.location.href);
if (arriving.type === "recovery") {
  window.location.replace("/reset/" + window.location.hash);
} else if (!isConfigured()) {
  hello.textContent = "Accounts need the Supabase keys in supabase/config.js.";
  showGate("Paste SUPABASE_URL and SUPABASE_ANON_KEY into supabase/config.js, then refresh.");
} else {
  const supabase = getSupabase();
  const resolved = await resolveSession(supabase, window.location.href);
  const session = resolved.session;
  if (!session) {
    const notice = resolved.errorMessage;
    window.location.replace(notice
      ? "/signup/?mode=login&notice=" + encodeURIComponent(notice)
      : "/login/?next=/account/");
  } else {
    clearAuthParams();
    if (arriving.type === "signup" || arriving.type === "magiclink" || arriving.hasGrant) toast("You're signed in.");
    clearCallbackMemory();
    logoutBtn.hidden = false;
    const user = session.user;
    const missingTable = (error) => error && /schema cache|does not exist|PGRST205|PGRST204/i.test(error.message || "");

    let profile = null;
    let submission = null;
    const profileRes = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (missingTable(profileRes.error)) {
      hello.textContent = "You are signed in.";
      showGate("The database migration has not been applied yet. Run supabase/migrations/20261010120000_roleflow_accounts.sql in the Supabase SQL editor, then refresh.");
    } else {
      if (profileRes.error) {
        hello.textContent = "You are signed in.";
        showGate(profileRes.error.message);
      } else {
        profile = profileRes.data;
        if (window.location.hash === "#profile") {
          showProfile(user, profile);
        } else {
        const adminPeek = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
        const legacySetter = window.location.hash === "#legacy-setter";
        if (!legacySetter && adminPeek.data) {
          window.location.replace(window.location.hash === "#applications" ? "/admin/#applications" : "/admin/");
        } else if (!legacySetter) {
          const setup = window.location.hash.startsWith("#onboarding") ? "?onboarding=1#onboarding" : "";
          window.location.replace("/account/acquisition/" + setup);
        } else if (adminPeek.data && !window.location.hash) {
          window.location.replace("/admin/");
        } else {
        if (!profile) {
          const created = await supabase.from("profiles").insert({
            id: user.id,
            full_name: user.user_metadata?.full_name || "",
            email: user.email || "",
            instagram: user.user_metadata?.instagram || ""
          }).select("*").single();
          profile = created.data;
        }
        const subRes = await supabase.from("onboarding_submissions").select("*").eq("user_id", user.id).maybeSingle();
        if (subRes.error && !missingTable(subRes.error)) {
          showGate(subRes.error.message);
        } else if (!usesLegacySetter(subRes.data)) {
          const setup = window.location.hash.startsWith("#onboarding") ? "?onboarding=1" : "";
          window.location.replace("/account/acquisition/" + setup);
        } else {
          submission = subRes.data;
          if (!submission) {
            const inserted = await supabase.from("onboarding_submissions").insert({ user_id: user.id }).select("*").single();
            submission = inserted.data;
          }
          const onboardNav = document.getElementById("nav-onboarding");
          if (onboardNav) {
            onboardNav.href = "/account/#onboarding";
            onboardNav.textContent = "Onboarding";
          }
          const statusNow = submission?.status || "not_started";
          const leaveForBusinesses = (statusNow === "submitted" || statusNow === "integrated" || statusNow === "live") && !window.location.hash.startsWith("#onboarding");
          if (leaveForBusinesses) {
            window.location.replace("/businesses/");
          } else {
          const name = profile?.full_name || user.user_metadata?.full_name || "";
          hello.textContent = name ? "Signed in as " + name + "." : "Signed in as " + (user.email || "your account") + ".";
          const answers = submission && submission.answers && typeof submission.answers === "object" ? submission.answers : {};
          globalThis.ROLEFLOW_ACCOUNT = {
            userId: user.id,
            status: submission?.status || "not_started",
            restored: Object.keys(answers).length > 0,
            profilePrefill: {
              clientName: profile?.full_name || user.user_metadata?.full_name || "",
              clientEmail: profile?.email || user.email || "",
              instagramHandle: profile?.instagram || user.user_metadata?.instagram || ""
            },
            boot: {
              answers,
              stepIndex: Number(submission?.step_index || 0),
              promptText: submission?.prompt_text || "",
              generationStatus: submission?.generation_status || "",
              generationError: submission?.generation_error || "",
              emailStatus: submission?.email_status || "",
              emailError: submission?.email_error || "",
              submittedAt: submission?.submitted_at || ""
            },
            save(snapshot) {
              return saveProgress(supabase, user.id, snapshot);
            },
            submit(snapshot) {
              return saveProgress(supabase, user.id, { ...snapshot, status: "submitted" });
            },
            generate(snapshot) {
              return generatePrompt(supabase, user.id, snapshot);
            }
          };
          hideBoot();
          section.hidden = false;
          if (setter) setter.hidden = false;
          const adminRes = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
          if (adminRes.data) {
            const navApplications = document.getElementById("nav-admin-applications");
            if (navApplications) navApplications.hidden = false;
            markNav();
          }
          renderSetter(supabase, user.id, document.getElementById("setter-app")).catch(() => {
            const root = document.getElementById("setter-app");
            if (root && !root.childElementCount) {
              const panel = document.createElement("div");
              panel.className = "panel";
              const p = document.createElement("p");
              p.textContent = "Your AI setter could not be loaded.";
              panel.append(p);
              root.append(panel);
            }
          });
          const script = document.createElement("script");
          script.src = "/onboarding/app.js";
          document.body.append(script);
          }
        }
        }
        }
      }
    }
  }
}

function showProfile(user, profile) {
  hideBoot();
  section.hidden = true;
  if (setter) setter.hidden = true;
  gate.hidden = false;
  gate.innerHTML = "";
  const name = (profile && profile.full_name) || (user.user_metadata && user.user_metadata.full_name) || "Your account";
  const email = (profile && profile.email) || user.email || "";
  hello.textContent = email ? "Signed in as " + email + "." : "Signed in.";
  const panel = document.createElement("div");
  panel.className = "state";
  panel.id = "profile";
  const title = document.createElement("h2");
  title.textContent = name;
  const mail = document.createElement("p");
  mail.textContent = email || "No email on this account.";
  const links = document.createElement("p");
  links.className = "links";
  const dash = document.createElement("a");
  dash.href = "/account/acquisition/#dashboard";
  dash.textContent = "Open your dashboard";
  const businesses = document.createElement("a");
  businesses.href = "/businesses/";
  businesses.textContent = "Your businesses";
  links.append(dash, document.createTextNode(" · "), businesses);
  panel.append(title, mail, links);
  gate.append(panel);
  markNav();
}

function usesLegacySetter(submission) {
  if (!submission) return false;
  const status = submission.status || "not_started";
  if (status === "submitted" || status === "integrated" || status === "live") return true;
  const answers = submission.answers && typeof submission.answers === "object" ? submission.answers : {};
  return Object.values(answers).some((value) => String(value || "").trim());
}

async function saveProgress(supabase, userId, snapshot) {
  const status = snapshot.status || "in_progress";
  const patch = {
    answers: snapshot.answers || {},
    step_index: Number(snapshot.stepIndex) || 0,
    status
  };
  const { error } = await supabase.from("onboarding_submissions").update(patch).eq("user_id", userId);
  if (error) throw error;
  const answers = snapshot.answers || {};
  const profilePatch = {};
  if (status === "not_started") {
    profilePatch.full_name = answers.clientName || "";
    profilePatch.instagram = answers.instagramHandle || "";
  } else {
    if (answers.clientName) profilePatch.full_name = answers.clientName;
    if (answers.instagramHandle) profilePatch.instagram = answers.instagramHandle;
  }
  if (Object.keys(profilePatch).length) {
    const { error: profileError } = await supabase.from("profiles").update(profilePatch).eq("id", userId);
    if (profileError) throw profileError;
  }
}

async function generatePrompt(supabase, userId, snapshot) {
  await saveProgress(supabase, userId, { ...snapshot, status: "submitted" });
  const { data, error } = await supabase.functions.invoke("generate-setter-prompt", { body: {} });
  if (!error && data && data.ok === false) {
    const skipped = new Error(data.error || "The prompt could not be written. Your answers are saved.");
    skipped.saved = true;
    throw skipped;
  }
  if (error) {
    let message = error.message || "The prompt could not be written.";
    const context = error.context;
    if (context && typeof context.json === "function") {
      try {
        const body = await context.json();
        if (body && body.error) message = body.error;
      } catch (_readError) { /* the status text is enough */ }
    }
    if (!/answers are saved/i.test(message)) message += " Your answers are saved.";
    const failed = new Error(message);
    failed.saved = /answers are saved/i.test(message);
    throw failed;
  }
  return data || {};
}
