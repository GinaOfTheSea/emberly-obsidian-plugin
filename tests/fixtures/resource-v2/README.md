# Resource ownership test vault

Fresh fixtures only; nothing was copied from the Emotions vault.

Enable Emberly Maps, then run **Emberly Maps: Open map…**.

1. Open Sailing; click Equipment, then Resources. Create a link, a note or any file.
2. Open a resource → Move… → click Research on the map.
3. Move to Workshop through the picker; the sidebar returns to the source topic.
4. Move Kit inventory across maps. Its original CSV is shared and must remain.
   Workshop already has an Inventory.csv and a Kit inventory.md to test collisions.
5. Archive/unarchive a resource; check the count and icon. Show archived reveals it.
6. Type in Notes: the canvas should stay mounted and keep its zoom.

Maps/topics/resources use format 2. Topics store parent IDs and fractional order keys. Topic documents have no
managed resource lists. These are disposable fixtures, but normal safety checks apply.
