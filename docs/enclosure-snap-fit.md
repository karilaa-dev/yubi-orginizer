# Inventory tray enclosure snap-fit

The accepted design replaces isolated thin spring leaves with four **solid frame-supported catches** and a **continuous mating skirt**. It follows the construction in the [Kitronik speaker enclosure reference](https://kitronik.co.uk/blogs/resources/amplifier-speaker-case-3d-printing-resources), with the 45-degree catch/recess profiles demonstrated in the [Protolabs tutorial](https://www.youtube.com/watch?v=dahn-9FePeM). The reference CAD was inspected in section; its dimensions were not copied indiscriminately into the smaller tray.

## Construction and operation

Each tray carries two 8 mm wide, 3 mm thick catch blocks on each opposing side. Their full bases are continuous with the frame. The top has an inner locating rim and a long perimeter channel between the catches. The lid and every tray underside have a corresponding deep perimeter channel and four recessed receivers. That channel separates the mating skirt from the central key deck, leaving room for the skirt to move outward during engagement. There are no cut-out spring leaves or separate latch components.

Press layers vertically together. Open one edge progressively using the end notch; both catch faces have 45-degree ramps. The skirt is unloaded when seated. Matching outside dimensions and the same connection are required on every layer. Catches depend on footprint, not key count. The stored value remains `snap_fit`; saved projects show it under Tray settings › Stacking as **Snap-fit (from an older version)**, and it is no longer offered for new trays.

## PLA / PLA Matte prototype dimensions

| Feature | Dimension |
| --- | --- |
| Solid catch section | 8 mm wide × 3 mm thick |
| Catch height above bearing plane | 4 mm |
| Stem-to-skirt clearance | 0.4 mm |
| Nominal engagement | 0.2 mm; samples also provide 0.1 and 0.3 mm |
| Mating skirt wall | 2.4 mm; 1.7 mm behind the recessed receiver |
| Free skirt/channel straight depth | 8 mm |
| Channel roof | 45° on straight sides and rounded corners, ending at 10.6 mm |
| Final roof closing span | 0.4 mm |
| Upper rim channel depth below key deck | 2 mm |
| Minimum solid web between cavities | 2 mm |
| Minimum tray body height | 14.6 mm |
| Lid height | 13 mm, including allowance for 0.35 mm engraving |
| Minimum edge margin | 10 mm |
| Minimum tray depth | 42 mm |

Corner profiles share a common center so the channel roof stays at 45 degrees around the perimeter. Stations lie within the straight walls. The upper locating rim, lower receiver channel and mating lid use the same outlines. The key pocket layout and calibrated floors are preserved; perimeter size grows to accommodate the mechanism. An undersized fixed size produces the existing size error instead of weakening the frame.

The default single-Nano example is 39 × 42 mm and 28.6 mm tall with lid (29.1 mm with retention tabs). The complete developer fit sample (`npm run export:snap-sample`; not generated in the app) is 42 × 60 mm. STL and 3MF parts use their supplied base-down print orientation.

## Verification and limits

- Geometry validation checks the actual exported meshes: connectivity, manifold surfaces, solid catch bases and webs, continuous receiver clearance, open upper channels, individual catch retention, seating, contact location during insertion/removal, key/pocket/label clearance, and three-tray stacks with differently populated matching layers.
- The insertion calculation measures geometric displacement demand at the receiver. It does not establish real wall strain, opening force, fatigue or durability.
- Native Bambu slicing uses the X2D 0.4 mm profile, Bambu PLA Matte, 0.2 mm layers, 5% infill and Arachne. Each of the three engagement variants has its own mesh/toolpath audit. Small channel-roof bridges remain; supports are disabled. The audit records the sub-0.04 mm equivalent CSG transition ledge and native profile diagnostics explicitly.
- Physical acceptance is pending: print a complete sample and check closing/opening, retention and at least 20 cycles without cracking, whitening or permanent set. Use the smallest engagement that supplies adequate retention.

Generate validation reports and fit samples using the commands in [development.md](development.md). Reports and local slices are written to the ignored `artifacts/` directory. Earlier printed parts are incompatible; regenerate both mating pieces.
