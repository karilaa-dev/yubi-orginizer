// YubiKey final calibrated plug-socket dimensions
// Units: millimeters
// Print/CAD profile used during calibration: same slicer compensation settings as the test series.

$fn = 48;

module rounded_rect_2d(w, h, r) {
    offset(r=r)
        square([w - 2*r, h - 2*r], center=true);
}

// Negative cutter. Place its top at the holder surface and subtract downward.
module usb_c_socket_cutter(w, t, depth, r=0.35, lead_h=0.55, lead_extra=0.15) {
    union() {
        // Main holding section.
        linear_extrude(height=depth-lead_h)
            rounded_rect_2d(w, t, r);

        // Short enlarged lead-in at the opening.
        translate([0,0,depth-lead_h])
            hull() {
                linear_extrude(height=0.01)
                    rounded_rect_2d(w, t, r);
                translate([0,0,lead_h-0.01])
                    linear_extrude(height=0.01)
                        rounded_rect_2d(
                            w + 2*lead_extra,
                            t + 2*lead_extra,
                            r + lead_extra
                        );
            }
    }
}

// Final standard USB-C socket: full C, C keychain, and USB-C side of 5Ci.
module yubikey_standard_usb_c_cutter() {
    usb_c_socket_cutter(w=8.300, t=2.560, depth=6.600);
}

// Final USB-C Nano socket.
module yubikey_c_nano_cutter() {
    usb_c_socket_cutter(w=8.290, t=2.500, depth=4.200);
}
