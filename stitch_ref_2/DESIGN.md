# Design System Document: The Executive Educator

## 1. Overview & Creative North Star
**Creative North Star: "The Architectural Ledger"**

This design system moves away from the "generic SaaS" aesthetic to embrace an editorial, high-end management experience. It is designed for Training Centers that value precision, authority, and clarity. Instead of a rigid grid of boxes, we employ **The Architectural Ledger**—a concept where data is organized through structural layering, intentional white space, and a sophisticated interplay between "Manrope" (for bold, authoritative headers) and "Inter" (for hyper-legible utility).

To break the "template" look, this system utilizes **asymmetric breathing room** and **tonal depth**. We replace harsh 1px borders with subtle shifts in surface values, making the interface feel like a series of meticulously stacked, premium documents rather than a flat digital screen.

---

## 2. Colors: The Tonal Spectrum
Our palette is anchored in deep oceanic teals (`primary: #004253`) and slate neutrals. This conveys a sense of established trust and institutional intelligence.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to section off content. 
Structure must be defined through background transitions. For example, a student list area should use `surface_container_low` against a `surface` background. If you feel the urge to draw a line, use a 16px or 24px margin of empty space instead.

### Surface Hierarchy & Nesting
Treat the UI as a physical desk.
- **Base Level:** `surface` (#f7f9ff) – The primary canvas.
- **Sectioning:** `surface_container_low` (#f1f4fa) – Used for large sidebar areas or secondary content blocks.
- **Actionable Containers:** `surface_container_lowest` (#ffffff) – Used for high-priority cards or data entry modules to make them "pop" against the slightly darker background.

### The "Glass & Gradient" Rule
To elevate the "Premium" feel, use Glassmorphism for floating elements (like user profile dropdowns or quick-action FABs). 
- **Backdrop Blur:** 12px–20px.
- **Fill:** `surface` at 70% opacity.
- **Signature Gradient:** For primary CTAs (e.g., "Generate Report"), use a linear gradient from `primary` (#004253) to `primary_container` (#005b71) at a 135-degree angle. This adds "soul" and dimension to critical actions.

---

## 3. Typography: Editorial Authority
We use a dual-typeface system to balance character with data density.

*   **Display & Headlines (Manrope):** Chosen for its modern, geometric structure. Use `headline-lg` and `display-sm` for dashboard summaries and module titles to establish an authoritative "Editorial" voice.
*   **Utility & Data (Inter):** The workhorse for the Training Center’s heavy data. Use `body-md` for student lists and `label-sm` (all caps, 0.05em tracking) for status indicators like "Attendance" or "Score."

**Hierarchy Note:** Always pair a `headline-sm` title with a `body-sm` description in `on_surface_variant` (#40484c) to create a clear "Title/Detail" relationship without needing a divider line.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are too "software-heavy." We use light to define importance.

*   **The Layering Principle:** Instead of a shadow, place a `surface_container_highest` (#dfe3e8) element inside a `surface` (#f7f9ff) page to indicate a "pressed" or "inset" area (e.g., a search bar or a code snippet).
*   **Ambient Shadows:** If an element must float (like a Modal), use a shadow with a 40px blur, 0px offset, and 6% opacity of the `on_surface` color. It should feel like a soft glow of depth, not a shadow cast by a harsh light.
*   **The "Ghost Border" Fallback:** If accessibility requires a stroke, use `outline_variant` (#bfc8cc) at **15% opacity**. It should be felt, not seen.

---

## 5. Components: Precision Built

### Buttons & CTAs
*   **Primary:** Gradient fill (Primary to Primary-Container), `xl` (0.75rem) roundedness. No border.
*   **Secondary:** `surface_container_high` background with `primary` text. This creates a soft, tactile feel.
*   **Tertiary:** No background. Use `title-sm` (Inter) with a subtle underline appearing only on hover.

### Cards & Lists (The "Anti-Divider" List)
*   **Rule:** Forbid 1px dividers between list items. 
*   **Execution:** Use a 4px vertical gap between list items. Give each list item a `surface_container_low` background that shifts to `surface_container_highest` on hover. This "highlight" interaction is more intuitive than a static line.
*   **Data Cards:** Use `surface_container_lowest` for the card body. Use an asymmetric 24px padding on the left and 32px on the right to create a sophisticated, non-standard rhythm.

### Functional Forms
*   **Inputs:** Use `surface_container_highest` for the input field background. Instead of a full border, use a 2px bottom-border of `primary_fixed` that expands on focus.
*   **Checkboxes:** Use `xl` (0.75rem) rounding even for checkboxes to maintain the "Soft Modern" language.

### Specialized Components
*   **Attendance Chips:** Use `tertiary_container` for "Present" and `error_container` for "Absent." Keep text in `on_tertiary_fixed_variant` for high-contrast readability.
*   **Score Badges:** A circular `surface_variant` container with `title-md` centered text. Use a subtle `primary` outer ring to indicate a "passing" grade.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use `surface_container` tiers to group related student data.
*   **Do** lean into `Manrope` for large numerical data (e.g., "98% Success Rate") to make stats feel designed, not just "inputted."
*   **Do** use the `lg` (0.5rem) and `xl` (0.75rem) corner radii to keep the interface feeling approachable despite its professional tone.

### Don’t:
*   **Don't** use pure black (#000000) for text. Always use `on_surface` (#181c20) to maintain tonal softness.
*   **Don't** use "Alert Red" for anything other than critical errors. Use `secondary` for neutral "pending" states to avoid unnecessary user anxiety.
*   **Don't** crowd the interface. If a screen feels busy, increase the background-color contrast between containers rather than adding more labels.