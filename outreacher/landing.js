import { landingCta, readOutreachCheckoutStatus } from "../acquire/outreacher-page.js";

const link = document.getElementById("outreach-cta-link");
const status = await readOutreachCheckoutStatus(fetch, globalThis.ROLEFLOW_SUPABASE || {});
const cta = landingCta(status);
if (link) {
  link.href = cta.href;
  link.textContent = cta.label;
}
