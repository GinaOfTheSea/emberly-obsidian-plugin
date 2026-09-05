# Real Obsidian smoke checklist

Run this checklist before every release candidate. Record the date, commit, OS,
Obsidian version and installer version in the release notes. Use a disposable vault
created by `node scripts/dev/create-resource-test-vault.mjs`; never use a personal vault.

## Install and open

- Build the plugin and copy only `main.js`, `manifest.json` and `styles.css` into
  `.obsidian/plugins/emberly-maps` in the disposable vault.
- Start Obsidian with the developer console open. Enable the plugin and confirm no
  load-time errors.
- Open a `.emberly.md` map from File explorer. Confirm it opens in integrated map
  mode, and **Return to plain note** restores the untouched native editor.
- Open the same map through the ribbon/command picker and in separate panes.

## Map and topic operations

- Create a map, then add several child and sibling topics in one batch. Confirm
  names, selection, zoom and viewport survive reload.
- Rename a topic by clicking its title above the notes pane. Check Enter and
  click-away to save, Escape to cancel, and retry after a filename collision.
- Rename a topic in the map and through File explorer. Move a branch and reorder
  siblings. Confirm IDs stay unchanged and native Graph shows parent edges.
- Rename and move the whole map folder. Reopen it from File explorer and confirm
  every topic remains attached.
- With exactly one root category, select Branch layout. Add a second root category
  and confirm the map persists Center layout. Delete/move back to one category and
  confirm it does not switch back automatically.
- Change center mode between avatar, text and image. Toggle note/resource icons and
  confirm settings persist after an Obsidian restart.

## Notes, resources and references

- Edit root/topic/resource note bodies in Source and Reading views. Confirm native
  undo, cursor and scroll position survive map selection changes.
- Add an online resource, a note resource and a local attachment. Confirm the
  resource body starts empty and attachments preview only once.
- Move a resource within a map and between maps. Confirm its owner backlink changes,
  its bytes/hash remain unchanged and no root appears as a destination.
- Add outgoing and reciprocal Markdown links using wikilinks, Markdown links,
  embeds and heading/block references. Confirm selecting a note shows only its
  in-map incoming/outgoing connections and does not move or recreate the canvas.
- Rename linked notes with Obsidian's automatic-link update both enabled and
  disabled. Confirm hierarchy remains intact in both cases.

## Recovery and cleanup

- Open/reopen multiple maps and switch themes. Confirm every topic label remains
  visible, including after closing one map while another stays open.
- Move an integrated and a separate map tab into a pop-out and back. Confirm text,
  zoom, selection, collapse, drag, note editing and Escape cancellation still work.
- Repeat on the declared minimum app version and the current desktop version,
  with both light and dark themes; record each tested version explicitly.

- Disable/re-enable the plugin with integrated and separate layouts open. Confirm
  no orphan panes, controls or console errors remain.
- Close panes during rapid topic selection and while links are resolving. Confirm
  no late canvas work or stale selection appears.
- Duplicate a map containing a center image and resources, then move the copy to
  trash. Confirm the original is unchanged and the copy has unique IDs.
- Restart Obsidian and repeat one edit/read-back cycle. Confirm there are no pending
  ownership, hierarchy or transfer warnings.

A release candidate passes only when every item succeeds without uncaught console
errors. Capture failures with the exact vault snapshot and reproduction steps.
