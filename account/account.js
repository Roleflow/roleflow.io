import { getSupabase, isConfigured, logout } from "../auth/supabase.js";

const hello = document.getElementById("account-hello");
const gate = document.getElementById("gate");
const section = document.getElementById("onboarding");
const logoutBtn = document.getElementById("nav-logout");

function showGate(message) {
  gate.hidden = false;
  gate.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "panel";
  const p = document.createElement("p");
  p.textContent = message;
  panel.append(p);
  gate.append(panel);
  section.hidden = true;
}

logoutBtn.addEventListener("click", logout);

if (!isConfigured()) {
  hello.textContent = "Accounts need the Supabase keys in supabase/config.js.";
  showGate("Paste SUPABASE_URL and SUPABASE_ANON_KEY into supabase/config.js, then refresh.");
} else {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    window.location.replace("/login/?next=/account/");
  } else {
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
        } else {
          submission = subRes.data;
          if (!submission) {
            const inserted = await supabase.from("onboarding_submissions").insert({ user_id: user.id }).select("*").single();
            submission = inserted.data;
          }
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
              promptText: submission?.prompt_text || ""
            },
            save(snapshot) {
              return saveProgress(supabase, user.id, snapshot);
            },
            submit(snapshot) {
              return saveProgress(supabase, user.id, { ...snapshot, status: "submitted" });
            }
          };
          section.hidden = false;
          const script = document.createElement("script");
          script.src = "/onboarding/app.js";
          document.body.append(script);
        }
      }
    }
  }
}

async function saveProgress(supabase, userId, snapshot) {
  const status = snapshot.status || "in_progress";
  const patch = {
    answers: snapshot.answers || {},
    step_index: Number(snapshot.stepIndex) || 0,
    status,
    prompt_text: status === "submitted" ? (snapshot.promptText || null) : null,
    submitted_at: status === "submitted" ? new Date().toISOString() : null
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
