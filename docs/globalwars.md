# GlobalWars Design Notes

This fork rethemes the OpenFront client to present the GlobalWars identity while remaining protocol compatible with upstream servers.

## Branding & Attribution
- **Logos**: `resources/images/GlobalWarsLogo.svg` and `resources/images/GlobalWarsLogoDark.svg` are bespoke SVG marks derived from the original OpenFront crest. They retain AGPL/CC-BY-SA attribution requirements and should not replace upstream assets outside of the GlobalWars deployment.
- **Hero Background**: `resources/images/GlobalWarsBG.webp` supplies the atmospheric command-center backdrop for the landing page.
- **Inline Attribution**: The landing hero includes explicit credit to the OpenFront project to satisfy upstream licensing guidance.

## Palette & Typography
- Tailwind tokens in `tailwind.config.js` expose the GlobalWars palette (`gw-amber`, `gw-slate`, and accent tints) for use across client modules.
- `src/client/styles.css` applies the palette alongside the "Space Grotesk" typeface for headings and "Inter" for supporting UI copy.

## Client Copy Updates
- `src/client/Main.ts` and `src/client/NewsModal.ts` adjust onboarding prompts, news references, and modals so terminology aligns with GlobalWars (e.g., "War Room", "Command Briefings").
- Text updates retain references to OpenFront where licensing mandates attribution or when linking to upstream help resources.

## Testing Notes
- UI changes were validated with `npm run lint`.
- In environments with access to desktop browsers, confirm responsive breakpoints on Windows (Edge and Chrome) to mirror the original QA process.
