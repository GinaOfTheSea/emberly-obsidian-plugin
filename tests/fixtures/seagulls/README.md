# Seagulls field guide

A ready-to-explore example for Emberly Maps: four colored branches, 17 topics,
five reference resources, species notes and a field notebook. It uses a text
center and the plugin's standard appearance and interactions.

Copy this fixture's `Emberly Maps/` folder into a test vault with the plugin
installed. Keep that path to preserve the map's links. Open
**Emberly Maps: Open map…** and choose **Seagulls field guide**.
Copy it once per vault; use the plugin's **Duplicate** action for further copies
so each map receives new IDs.

The [test-vault setup script](../../../scripts/dev/create-resource-test-vault.mjs)
includes this map automatically when creating a fresh test vault. Run it from the
repository root after `npm run build`:

```sh
node scripts/dev/create-resource-test-vault.mjs
```

It refuses to overwrite an existing test vault. The export fixture test also
checks this map's hierarchy and resource ownership.

The branches cover:

- **Meet the gulls:** Herring Gull, Black-headed Gull, Kittiwake and Great Black-backed Gull.
- **Read the clues:** shape and size, plumage, age and season.
- **By the water:** prompts for watching birds at shores, cliffs and inland places.
- **Field notebook:** a packing checklist, observation prompts and a sighting template.

Species descriptions draw on the [RSPB gull identification guide](https://www.rspb.org.uk/birds-and-wildlife/identifying-birds/uk-gull-identification)
and the linked species pages. Source links are included in the notes and resource
files. The notebook contains prompts, not records of real sightings.
