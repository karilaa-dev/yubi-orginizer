# Printing and fit

Export models in millimeters at 100% scale. Each part rests on Z=0 in its intended
print orientation; preview assembly/explode transforms do not alter exports.
Reference keys are never included in printable files.

3MF exports contain separate objects and per-object 5% infill / Arachne settings
for Bambu Studio and OrcaSlicer. Open as a project and choose your printer and
filament. Other readers may ignore slicer-specific settings. Inspect the slice
before printing. STL and SCAD downloads include a project configuration.
Desktop OpenSCAD needs Liberation Sans and Text Metrics for matching lettering.

## Inventory trays

**Non-stackable** keeps the optional lift-off lid. **Stackable** adds locating
rims for trays that lift apart. **Slide-lock** adds the H20/V7 pins and guides,
with matching underside receivers. A lid can be added independently. For stacked trays with different contents,
lock the larger layout's width and depth before removing keys. Use identical
outside dimensions and the same connection on every layer. Undersized locked
footprints block exports until corrected; key pockets are never scaled.

For [H20/V7 slide-lock](h20-slide-lock.md), first print the two-piece sample under
Mechanical fit tests. Keep pins upward and print slide-lock lids with the flat inside face down. Start the upper
layer 6 mm opposite the selected sliding direction, lower, then slide until
flush; reverse the motion before lifting. Match the direction on every layer.
The small fit sample always slides left. Preserve the material/settings used for your reference fit and inspect
the sloped receiver roofs with supports disabled.

Choose **Lid design → Regular** for a 2.4 mm panel or **Minimal material** for a
closed 1.2 mm panel with exterior ribs. Both have the same key-facing height as
a stacked tray. Slide-lock lids place their receiver housings above the panel;
print them inside-face down. Minimal lift-off lids also print inside-face down,
while regular lift-off lids retain their exterior-down orientation. Exported
parts are already oriented correctly. Extra height around the slide-lock
receivers is external and does not add space above the keys.
The regular slide-lock lid conceals its receivers in a rounded border. Use
the recessed thumb grips at the sliding ends to push it 6 mm opposite the
locking direction, then lift. The grips follow the selected direction;
the H20 friction fit remains unchanged.

Flat C Nano pockets now include a raised connector shelf so the body and USB-C
connector rest horizontally. The reference model determines its height; test
the actual key before printing a larger batch.
The connector tip sits over a deeper finger recess with 1 mm of clearance
underneath, while a short ledge continues to support its root.

Set **Outer margin** to 5 mm for the compact footprint; extra clearance is
reserved automatically on the two receiver edges. Larger selected margins and
locked dimensions are preserved.

Saved projects using the [legacy enclosure joint](enclosure-snap-fit.md) retain four solid catches and a flexible
mating skirt. Start with PLA / PLA Matte and the complete frame sample. Compare
0.1, 0.2 and 0.3 mm engagement. Press vertically to close and lift one end
progressively at its finger notch to open. Keep clearance channels unobstructed.
Regenerate both mating parts when replacing any older connection.

Key retention is separate: its flexible tabs hold keys in their pockets. PETG
is a useful starting material for those repeated-use tabs. Changing material can
change the enclosure fit; test the complete assembly you intend to print.

## Calibration and limitations

USB socket fit-test offsets apply per side in XY; zero uses the calibrated cutter
without adjustment. Tester settings never change the organizer's default fit.
The 5Ci inventory relief is provisional and symmetric to allow either connector
orientation; other organizers retain the original body contour.

The preview's PLA estimate assumes 1.75 mm filament, 5% infill, two 0.42 mm walls,
0.2 mm layers, and four top/bottom layers. Supports, brim, purge and waste are
excluded. Use your slicer for final consumption.

Mesh, clearance and slicing checks do not establish physical fit or durability.
Print a sample before a full organizer. For the enclosure joint, check secure
retention and repeatable opening over at least 20 cycles without cracking,
whitening or permanent deformation. Physical acceptance remains unverified.
