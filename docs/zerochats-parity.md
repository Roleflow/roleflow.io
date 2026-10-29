# ZeroChats parity

Internal plan. Compared with Roleflow on `main` as of 23 Oct 2026 (studio phases through the panel polish, plus the unmerged Instagram gateway). Status is what a workspace editor can do today, not what a screen merely resembles.

Client-facing copy stays Roleflow. This note names the reference product only so the diff is checkable.

## Status

| Area | Status | What exists | Gap |
| --- | --- | --- | --- |
| Multi-business list, add business, AI pill | partial | Business cards, add-business flow, workforce status | No 7-day lead sparkline, no shared-business badge, delete is not a hover action |
| Clone business, team share | partial | Clone action and email invites with three scopes, join link | Invitee must already have an account; no in-product share badge on the card |
| Notifications | partial | Bell, unread count, mark read, stored rows | No live producer for most product events |
| Theme, ES/EN/PT, affiliates, weekly classes, feature requests, changelog | missing | Sign-out and profile live elsewhere | Not in the panel |
| Collapsible sidebar, grouped nav, back to businesses | have | Dock sidebar, section groups, Panel link | Collapse is the existing dock, not a second off-canvas |
| Command search | partial | Search jumps to screens | No guided overlay that points at a control |
| Onboarding checklist with credit rewards | partial | Setup steps in the panel | Credits are not a currency and steps do not pay out |
| Academy | missing | — | No lesson catalogue |
| In-panel assistant | partial | Assistant that can draft and propose a CRM move | No lead search, prompt edit, reports, voice, or auto-guide |
| Explain / edit-with-AI on charts and prompts | partial | Prompt score, fix, and edit actions in the workflow editor | Charts do not have an explain action |
| Dashboard accounts, master switch, notices | partial | Instagram connect card, system switch, sync state | No WhatsApp, no weekly-versus-prior performance block |
| Instagram connect | partial | Request form on production; one-click gateway on the unmerged connect PR. Gateway functions are deployed | Panel button ships when that PR merges. WhatsApp is out of scope |
| Several agents per business | partial | Workforce roles, prompts, routines, delegations stored on agent cards | Handoff between agents is not executed on a live thread |
| Prompt editor, business brief, versions, quality score | have | Seven-section workflow, brief, versions, score | 40k character cap and the reference template headings are not copied |
| Conversation simulator | partial | Studio simulator with a lead state | Not the reference phone mock |
| Sales links | partial | Name, URL, ticket, instructions, per-agent flag, saved | The setter does not send them. No calendar connect |
| Scheduling endpoints | partial | Availability and booking URL fields saved | No Calendly or GoHighLevel connect, and nothing books |
| Contents library | partial | Image, audio, video, link, button rows and upload | The setter does not attach them. No voice cloning |
| Follow-up ladders | draft | 24-hour steps, welcome steps, restart and before-close flags, saved. A worker queues the ladder and resume reminders on the official inbox and refuses anything outside 24 hours | Not deployed and not on the cron. AI steps wait for a planned reply before send. The before-close flag is stored and not applied yet |
| 7-day manual follow-ups | partial | Pending list and “mark sent by you” | A person sends from Instagram. No draft queue tied to a clock |
| Reminders | partial | Create, list, overdue/today/week counts, AI-detection flag stored | Nothing creates a reminder from a chat thread, and detection does not run |
| Chats inbox | partial | Three panes, search, state, thread from `acq_messages`, export, AI flag saved on the lead | Filters omit tags, AI, and unread. A reply is a draft, not a send. Pausing AI does not stop the live setter |
| CRM list and board | partial | States, filters, notes, pagination | No auto-refresh clock, no delete, no “messages to send” queue that actually sends |
| Lead state machine | partial | Nine states stored, editable conditions saved | The live setter uses its own qualification states. Sales-link and 24-hour-lost rules do not run |
| Comment and story keywords | partial | Keyword rows saved. Gateway can private-reply when the comment-to-DM role is on | Keyword match, public comment reply, and story CTAs are not executed |
| Statistics | partial | Counts from leads already in the workspace | No per-day series, per-tag conversion, content or link conversion, funnel, or reply-time buckets. Empty when there are no leads |
| Performance | partial | Origin table from stored origins | No previews, no CSV of a published-post breakdown, no re-assign |
| Benchmark and revenue calculator | missing | — | No niche compare and no 12-month calculator |
| Office hours, timezone, reply delay | partial | Fields on settings | The live setter does not wait for those hours |
| Who it answers | partial | Keyword list, ignored handles, skip-if-we-follow flag stored | Not enforced on inbound |
| Stop answering | partial | Switches stored | A human reply in Instagram does not flip the chat to manual |
| Writing style and AI disclosure | partial | Switches and notice text stored | Not applied to live replies |
| Tags | partial | Tag rules saved on the lead | The model does not apply them from a message |
| Closer email notifications | partial | Toggles stored | No mail is sent from those toggles |
| Integrations and public API keys | partial | Webhook row, test button, API key create/revoke | GoHighLevel, HubSpot, Kommo, Airtable, and conversion scripts are not connected |
| Profile, credits, subscription, support tickets | missing | Account pages exist for Roleflow sign-in | No credit packs, plan catalogue, or ticket desk |

## Stages

Each stage is a draft pull request. It has to change stored data and the live path, with `node --test` green. Screenshots show the panel before and after. Nothing is merged here.

1. **Chats.** Unread counts, filters for state, tag, AI, and unread, a manual reply through the official inbox, per-chat AI pause that the inbound worker honours, and reminders created on the chat. This stage.
2. **Setter settings.** Office hours, reply delay, and human handover gate the live setter. Tags and lead fields from the model are written onto the contact. Business information is included in the prompt. Default model `grok-4.3`, with `grok-4.7` for objections and booking, or for every reply when that model is selected.
3. **Follow-ups.** A scheduled worker sends the 24-hour ladder and reminders, and refuses sends outside Instagram’s 24-hour window.
4. **Calls to action.** Keyword private replies and story replies, using the keyword rows already saved.
5. **Sales links and contents.** The setter can attach a saved link, file, or voice note, with click counts.
6. **Dashboards.** Statistics, performance, and benchmark computed from rows that exist. Empty states, no sample numbers.
7. **Account desk.** Notifications that fire, token and message usage per workspace, a billing view, support, and a how-it-works list.

Out of this sequence until Diego asks: WhatsApp, voice cloning, paid niche benchmark, credit checkout, three languages, and the external class/affiliate links.
