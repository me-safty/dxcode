# Manual Test Guide — 22 Student Workspace (form/roster module)

Scope: the additive **Students** module from
[../22-student-workspace.md](../22-student-workspace.md) — store + display +
full CRUD via a form. The `/student` chat-CRUD feature (plan 22-1) is **NOT
implemented** and is out of scope.

Branch under test: `auto-claude/001-implement-student-workspace-plan`
(worktree `.auto-claude/worktrees/tasks/001-implement-student-workspace-plan`).

> ✅ **F15 / phone-country bug is now FIXED.** The phone dropdown previously
> stored the dial code (`"+65"`) in the `country` field, which broke the
> WhatsApp/Telegram deep links and showed `++65 …`. It now stores the country
> **code** (`"SG"`/`"MY"`/`"CN"`); the contract schema enforces that union, and
> `PhoneField` / `StudentDetail` were updated. **See §5 "Fix verification" for
> exactly how to retest the fixed portion.**
>
> ⚠️ **No data migration was added.** Any student you created *before* the fix
> still has `"+65"` saved and will look broken (no dial code, no buttons). Test
> the fix with **newly created** students, or reset the store first (§1).

---

## 1. Setup, install, and spin up the services

**Prerequisites**
- Node `^24.13.1` (`package.json` → `engines`).
- The `vp` (Vite+) CLI:
  ```bash
  curl -fsSL https://vite.plus | bash      # macOS / Linux
  ```

**Install** (run from the worktree that has the code):
```bash
cd /home/rex/projects/tutoratlas/atlas-harness/.auto-claude/worktrees/tasks/001-implement-student-workspace-plan
vp i
```

**Run — pick one surface.** Two backends (`apps/web/src/localApi.ts`): Electron
persists to a JSON file; the browser falls back to `localStorage`.

- **Desktop (recommended)** — no pairing, real IPC + `students.json`:
  ```bash
  vp run dev:desktop        # or: pnpm dev:desktop
  ```
  Data file: `find ~ -name students.json 2>/dev/null`
- **Web** — `vp run dev:web`, open the printed URL. ⚠️ `/students` has an auth
  guard (`routes/students.tsx`): if not paired it redirects to `/pair`. Data:
  `localStorage` key `t3code:student-registry:v1`.

**Reset to a clean state** (important for retesting the phone fix):
- Desktop: delete `students.json`.
- Web: clear the `t3code:student-registry:v1` localStorage key.

**Automated tests** (run these first; they now include the phone-link regression):
```bash
vp run --filter @t3tools/contracts test     # schema (rejects "+65")
vp run --filter @t3tools/desktop test        # DesktopStudents
vp run --filter @t3tools/web test            # includes links.test.ts (F15 guard)
```

---

## 2. Features to test (each is its own unit)

Navigation & shell
- **F1** — Sidebar "Students" nav entry (`Sidebar.tsx`, Users icon → `/students`)
- **F2** — Two-pane Students page + empty state (`routes/students.tsx`, `StudentList.tsx`)

CRUD (one letter = one feature)
- **F3 — Create** (`StudentForm` create mode)
- **F4 — Read**: alphabetical roster + detail view (`StudentList`, `StudentDetail`)
- **F5 — Update**: edit existing (`StudentForm` edit mode)
- **F6 — Delete**: with confirm dialog (`StudentDetail.handleDelete`)

Form fields & validation
- **F7** — Name required (`StudentForm`)
- **F8** — Phone field: country code dropdown (SG/MY/CN) + number (`PhoneField.tsx`) — **fixed**
- **F9** — Subjects: comma-separated → tag chips
- **F10** — School: free text
- **F11** — Address with conditional postal-code validation (`AddressFields.tsx`)
- **F12** — Parents: add/remove rows; empty rows dropped on save (`ParentRows.tsx`)
- **F13** — Notes: free text

Deep links
- **F14** — Google Maps link from address (`links.ts:googleMapsLink`)
- **F15** — WhatsApp / Telegram links from phone (`links.ts`) — **fixed** ✅

Persistence
- **F16** — Round-trip persistence (survives reload; coarse get-all/set-all)

---

## 3. Acceptance criteria per feature

| # | Feature | Acceptance |
|---|---------|-----------|
| F1 | Sidebar nav | A "Students" item (Users icon) appears in the sidebar footer; clicking it opens the Students page. |
| F2 | Empty state | With no students, left pane shows "No students yet" + a button; right pane shows the welcome prompt. |
| F3 | Create | Submitting with a name adds the student, auto-selects it, shows its detail. |
| F4 | Read | Roster **sorted alphabetically by name**; clicking a name shows full detail. |
| F5 | Update | Edit pre-fills all values; saving updates the record and bumps "Last updated"; `id`/`createdAt` preserved. |
| F6 | Delete | Confirm dialog naming the student; confirm removes it; cancel keeps it. |
| F7 | Name required | Empty/whitespace name blocks save and shows "Name is required". |
| F8 | Phone | Dropdown defaults to **SG**, offers MY / CN (each shown as e.g. `SG +65`). **Detail shows a single dial code, e.g. `+65 91234567` (NOT `++65`).** |
| F9 | Subjects | `Math, Physics` → two chips; spaces/empties trimmed. |
| F10 | School | Saved value shown in detail. |
| F11 | Address | Optional when blank. **If any address field is filled, postal code must be exactly 6 digits**, else error + save blocked. |
| F12 | Parents | Add/remove rows; fully empty row dropped on save; rows with name and/or phone kept. |
| F13 | Notes | Multi-line notes saved and shown (whitespace preserved). |
| F14 | Maps link | "Open in Google Maps" appears when address present; opens a maps search for the SG address. |
| F15 | WhatsApp/Telegram | **For a student with a phone, WhatsApp and Telegram buttons appear and open `https://wa.me/6591234567` / `https://t.me/+6591234567` (correct E.164).** |
| F16 | Persistence | Created/edited/deleted students survive a full app reload. |

---

## 4. How to test each feature

**F1 — Sidebar nav:** Launch → sidebar footer (near Settings) → click **Students** → lands on Students page.

**F2 — Empty state:** Clean profile → open Students → "No students yet" + button (left), welcome text (right).
> Previously noted: the welcome text says "click New Student" while the button reads "Add your first student" — wording mismatch worth aligning (cosmetic, not a blocker).

**F3 — Create:** **New Student** → type only a name → **Create Student** → appears in list, opens detail.

**F4 — Read / list:** Create "Zoe", "Adam", "Mia" → expect order Adam → Mia → Zoe → click each → detail loads.

**F5 — Update:** Open a student → **Edit** → change school/subjects → **Save Changes** → updated values, newer "Last updated", "Created" unchanged.

**F6 — Delete:** Open a student → **Delete** → confirm dialog → Cancel keeps it; Delete → confirm removes it, view returns to welcome.

**F7 — Name required:** New Student → blank name → **Create** → inline "Name is required", no save.
> Previously noted: the only signal is the inline error next to the (scrolled-up) name input — easy to miss after scrolling down to press Create. Consider a toast / scroll-to-error. (Enhancement, not a regression.)

**F8 — Phone (fixed):** New Student → open the dropdown → default **SG**, options **MY**, **CN** (each labelled `CODE +dial`). Enter a number, save. In detail, expect **`+65 91234567`** — a *single* leading `+`. (See §5 for the deep-link half.)

**F9 — Subjects:** `Math, Physics , , Chemistry` → save → exactly three chips.

**F10 — School:** Enter a school → save → shown under "School".

**F11 — Address:** Fill only Street, postal blank → save blocked + "Postal code must be 6 digits…". Postal `12345` → blocked. `123456` → saves. Empty address → saves (omitted).

**F12 — Parents:** **Add parent** ×2; fill row 1 (name "Mary", "Mother"), leave row 2 empty → save → reopen → only Mary remains. Test **Remove parent** (X).

**F13 — Notes:** Multi-line notes → save → line breaks preserved.

**F14 — Google Maps:** Address with valid postal → detail → **Open in Google Maps** → `google.com/maps/search` URL for the SG address.

**F15 — WhatsApp/Telegram (fixed):** see §5.

**F16 — Persistence:** Create/edit a couple → fully quit & relaunch (desktop) or hard-reload (web) → roster intact. Verify raw store: desktop `cat "$(find ~ -name students.json)"`; web localStorage `t3code:student-registry:v1`.

---

## 5. Fix verification — phone country code (F8 + F15)

This is the portion that was just fixed. Test it deliberately with **new** data.

**Pre-req:** reset the store (§1) so no pre-fix `"+65"` records interfere.

**Step 1 — automated guard (fast):**
```bash
vp run --filter @t3tools/web test        # links.test.ts must pass
vp run --filter @t3tools/contracts test  # PhoneNumber rejects "+65"
```
`links.test.ts` asserts `whatsAppLink({country:"SG",number:"91234567"}) === "https://wa.me/6591234567"` and that a dial-code `country` (`"+65"`) yields `""`. If a regression reappears, these fail.

**Step 2 — create a student with a phone:**
1. New Student → Name "Link Test".
2. Phone → leave country **SG** (default) → number `91234567` → Create.

**Step 3 — check the detail display (F8):**
- Phone reads **`+65 91234567`** — exactly one `+`. ❌ A `++65` means the fix regressed.

**Step 4 — check the deep-link buttons (F15):**
- **WhatsApp** and **Telegram** buttons are **visible** next to the phone.
- Click **WhatsApp** → opens `https://wa.me/6591234567`.
- Click **Telegram** → opens `https://t.me/+6591234567`.
  (Desktop opens the external browser; web opens a new tab.)

**Step 5 — repeat for MY and CN:**
- Edit the student, switch country to **MY**, number `123456789` → expect display `+60 123456789`, WhatsApp `https://wa.me/60123456789`.
- Switch to **CN**, number `13800138000` → display `+86 13800138000`, WhatsApp `https://wa.me/8613800138000`.

**Step 6 — parent phone:** Add a parent with a phone (SG) → parent block in detail also shows a single `+65 …` and its own working WhatsApp/Telegram buttons.

**Pass criteria:** single dial code in display, buttons present, URLs as above, and both automated suites green.

---

## 6. Results checklist

P = pass, F = fail, — = not run.

| # | Feature | Result | Notes |
|---|---------|:------:|-------|
| F1 | Sidebar nav | | |
| F2 | Empty state | | welcome/button wording mismatch |
| F3 | Create | | |
| F4 | Read / list + detail | | |
| F5 | Update | | |
| F6 | Delete + confirm | | |
| F7 | Name required | | error easy to miss (toast?) |
| F8 | Phone display (`+65`, fixed) | | retest with NEW student |
| F9 | Subjects → chips | | |
| F10 | School | | |
| F11 | Address postal validation | | |
| F12 | Parents add/remove/drop | | |
| F13 | Notes | | |
| F14 | Google Maps link | | |
| F15 | WhatsApp/Telegram (fixed) | | see §5 |
| F16 | Persistence round-trip | | |

---

## Notes / out of scope
- `/student` chat CRUD (plan 22-1) is **not implemented**.
- No search / sort beyond alphabetical / pagination this iteration (by design).
- Duplicate names allowed (`id` is the key) — not a bug.
- Pre-fix students keep their `"+65"` value (no migration) — reset or recreate to retest F8/F15.
