# Calibrated CAD profiles

These files contain the body contours and USB-C socket modules used by Keyform.
They originated in the supplied `YubiKey_Holder_Concepts_1_to_5_Package`.
The required source was recovered from a self-contained Keyform SCAD export when
the original package was no longer present. The geometry definitions are unchanged; only trailing blank lines were normalized.
No scaling or recalibration was applied. Demo placements and unrelated research
files are not needed to build the application.

- `profiles.scad`: six nominal/body silhouettes and the accepted USB-A socket contour.
- `calibrated_usb_c.scad`: standard and Nano USB-C socket cutter modules.

These supplied materials had no separate license declaration available in the
workspace. No new license is assigned here. See `THIRD_PARTY_NOTICES.md` at the
repository root. Physical fit depends on printing conditions.
