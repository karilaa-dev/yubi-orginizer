# Inventory tray connections

The Stacking group in Tray settings offers **Standalone**, **Stackable** and
**Slide-lock**. Standalone retains the existing optional lift-off lid, with no
underside tray receiver. Stackable uses the existing locating rim and underside groove; it lifts
apart. Slide-lock uses the supplied two-pin H20/V7 reference. All three support
optional lids. Saved `snap_fit` projects retain their original geometry and show
as **Snap-fit (from an older version)**. `stackable` now round-trips without migrating to
snap-fit; the retired `slide_lock` identifier keeps its prior snap migration.
The new incompatible interface has the explicit ID `h20_slide_v7`.

## H20/V7 geometry

Two reinforced pins and two 8 × 6 × 3 mm guides are integral with each tray.
Their four underside receivers use the same external-footprint datums on every
layer. **Slide direction** chooses the upper layer's locking motion: Left,
Right, Front, or Back, viewed from above. Front is the front-text edge (-Y).
Left is the default for older projects. The pins, guides, underside receivers,
and local bearing pads rotate together; keys and text stay in place. Start
6 mm opposite the chosen direction, lower, then slide until flush. Reverse
that motion before lifting. Match outside dimensions, connection type, and
direction when building a stack; regenerate both mating parts after changing it.

The 5.8 mm head, 5.6 mm gripping cavity, 4.2 mm pin height, 0.4 mm head/root
end relief, and 64-segment roots come from the handoff. No global fit offset is
applied. `connectors/h20-v7.scad` preserves all profile coordinates; both loft
helpers reverse their face winding for the browser's Manifold backend. The
original outward-wound lofts work with the handoff's CGAL export but produced
incorrect signed solids in the app backend.

A 13 mm border on the two receiver edges reserves the full receiver sweep plus
about 2.05 mm to the storage envelope. The other two edges use the selected
edge margin (5 mm minimum), removing 16 mm along the sliding axis at the default
margin. Front/back directions reserve the side receivers against retention
slots and label width too, growing a Fit to keys footprint if needed. Explicit
larger margins and fixed sizes remain unchanged. Rounded body corners retain at least 3 mm outside the receiver
mouths; front-text engraving is only 0.35 mm deep. The minimum body height remains
8.6 mm, leaving 2.4 mm over the deepest receiver. An undersized fixed size
produces a required-size error; Fit to keys footprints grow without scaling pockets.
Empty inventories keep the app's empty state and produce no degenerate mesh.

Local bearing pads around the four connector roots raise the male root plane
by the existing 1.5 mm retained-key gap or 1 mm bare-key gap. Sparse interior supports are kept
outside the receiver bands. A continuous 2.7 mm perimeter wall reaches the
same bearing plane, closing the previously open side gaps below a lid or upper
tray. Its top is flat so it does not obstruct lateral movement. This mode has
no raised locating tongue or snap skirt.

## Two closed lid designs

Both lids now have a flat key-facing surface at local Z=0, the same bearing
plane as the underside of an upper tray. The clearance above the key deck is
exactly 1.5 mm with retention or 1 mm without it. There is no elevated panel
leaving extra internal headroom. Both lids remain interchangeable across key
populations with the same outside dimensions and slide direction.

**Regular** uses a 2.4 mm panel with a continuous rounded perimeter that conceals
the four receiver housings. A softened outer edge and rounded inner corners
blend the border into the panel. Recessed thumb wells with three shallow
traction grooves sit at the two sliding ends, clear of the receivers. Hold
the tray and push the lid 6 mm opposite the locking direction before lifting;
the grips rotate with that direction. They provide purchase without changing
the supplied H20 interference fit. Compact footprints shorten the grips to
stay clear of the sockets; grips are omitted if less than 8 mm is available.

**Minimal** keeps its continuous 1.2 mm
panel, 1.2 mm wide exterior ribs with spans of at most 40 mm, and a reinforced
perimeter. Neither version has through-holes. The ribs are outside, so they do
not affect key clearance. Lettering leaves at least 0.85 mm beneath its deepest
engraving in the minimal panel; text is confined inside the receiver border.

The regular border and minimal lid's four tapered receiver housings rise above
the panel to 7.8 mm. They retain the
original 6.2 mm sloped socket roofs and at least 1.6 mm of top cover. These local
housings provide the connector height without raising the inside face over the
keys. Print both lids **flat inside face down**, with the border/housings/ribs upward.
The assembled orientation and print orientation are now identical.

Both retaining-pin pads are 10 mm deep, overlapping the 2.7 mm outside rim by
0.7 mm. This joins them to the thin border in every sliding direction, like
the guide-block pads. No change is made to the mating pin profiles.

Flat C Nano pockets have a stepped floor: the thick body keeps its existing
6.6 mm depth, while a shelf supports the USB-C connector 4.3 mm below the deck.
That 2.3 mm rise matches the existing model's 7 mm body and 2.4 mm connector
thicknesses at the same centre height. The shoulder, finger access, retention
slots and upright calibrated sockets remain clear. Confirm the shelf with the
physical key before treating it as a measured production fit.

The C Nano finger recess extends 5.3 mm below the deck around the connector
tip, leaving 1 mm beneath the metal shell for grabbing. Its root retains a
2.4 mm long supporting ledge at the original height. The deeper cut remains
inside the existing scoop outline and clear of the side retainers; key height,
lid clearance, and row spacing do not change.

## Verification and samples

`npm run validate:h20` also exports two identical 40 × 28 mm developer coupons
with the reference 8.4 mm zero-gap body; they are not generated in the app. This
sample always slides left; the arrow points toward locking, independently of
tray direction. Generated tray/lid STL and portable 3MF exports contain no
separate fasteners or preview keys.

Run `npm run check`, `npm run build`, and `npm run validate:h20`. The last command
writes real WASM meshes, self-contained SCAD, portable 3MF, ZIP packages and
`artifacts/h20-validation/report.json`. It checks signed contact at 25 positions,
full lowering/sliding in all four directions with both gaps and lids, continuous
perimeter and lid-panel closure, matching key headroom, C Nano connector support, different contents of a matching footprint,
both lid styles, all six key types, a large tray, lift-off lids, and connected watertight meshes. The material
comparison uses archived pre-compaction mesh volumes with identical key/config
settings in `tests/fixtures/h20-material-baseline.json`; these are geometric solid
volumes, not slicer filament estimates.

The supplied golden curve comes from the curved BRep reference. The supplied
SCAD triangulates the ruled transition: the difference during travel is at most
0.0023 mm³ per pin, while the seated overlap agrees to 0.00001 mm³ with
1.0766666667 mm³. Complete-tray motion is compared with the measured local SCAD
curve; contact must remain confined to the pin heads. STL assembly probes use
0.00001 mm seating separation to avoid float32 coincident-face artifacts.

Digital contact volume is not holding force. Slice with supports disabled using
the supplied orientation and the material/settings used for the reference fit.
Inspect the narrow roof closures and roots, then compare the printed coupon and
an occupied tray/lid for entry, retention, removal and repeatability. Physical
strength, creep, fatigue and resistance to peeling remain unqualified.
