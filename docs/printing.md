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

The only locking connection is **Enclosure snap-fit**; **None** disables it.
A lid can be added independently. For stacked trays with different contents,
lock the larger layout's width and depth before removing keys. Use identical
outside dimensions and the same connection on every layer. Undersized locked
footprints block exports until corrected; key pockets are never scaled.

The [enclosure joint](enclosure-snap-fit.md) uses four solid catches and a flexible
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
