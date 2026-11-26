# Play recordings

The Playground replays the same `spellkave.recording` v2 envelope that Play
exports. It does not maintain a second hand-authored scene model. Checked-in
files under `src/playground/recordings/` are immutable frame timelines;
`scenes.ts` adds the small declarative scenario layer that can select one of
those existing frames.

The five `legacy` recordings were mechanically captured from the former
in-memory Playground examples before that simulator was removed. They are
historical presentation fixtures, not claims about a live world. Do not add a
new fixture simulator to regenerate them: refresh a scenario from a real
export, or deliberately migrate a frozen historical source with the normalizer.

## Adding or refreshing a recording

First record the situation in Play. Before it reaches the repository, the reviewer
must inspect the complete input for credentials, identity data, private chat,
and any other material that should not be committed. The normalizer requires
that explicit acknowledgement and writes only to a new path:

```sh
pnpm exec tsx apps/play/scripts/normalize-play-recording.ts \
  /path/to/export.json apps/play/src/playground/recordings/example.recording.json \
  --privacy-reviewed --source live --build BUILD_ID --title "Short description"
```

The command uses `parsePlayRecording` both before and after normalization. It
does not overwrite its input or an existing output. `source=live` is reserved
for a genuine browser export; use `legacy` for migrated old examples and
`fixture` for a deliberately authored test fixture. Provenance is descriptive,
not authorization.

Use `--sample N` only when a full recording is too large for a review fixture.
It retains evenly spaced existing frames and their original stable IDs; it does
not synthesize interpolation frames or represent a complete session.

## Scenarios are overlays

A scenario names its recording and references stable frame IDs. A transition
matches one exact offered input and selects a target frame already in that
recording. It cannot run code, call a reducer, make a network request, or
invent a result. If a user action has no recorded transition, Play says so and
the frame remains unchanged.

This means an apparent choice is not a simulator: the legacy creation sample
contains the recorded `Fighter` path and the exact `name=Mira` input only. A
click on `Wizard`, or a different name, has no recorded transition and must
not display Fighter's result. Re-record the outcome when a new path is needed.
