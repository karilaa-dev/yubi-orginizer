#!/usr/bin/env python3
"""Audit a local Bambu slice of the enclosure snap-fit sample; never contacts a printer.

Run the sample exporter and native slicer first, then this script. Geometry/source
hashes make the checked revision explicit. G-code role counts are diagnostics,
not proof of physical fit, strength, sag resistance, or fatigue life.
"""

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
NS = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
PRODUCTION = "{http://schemas.microsoft.com/3dmanufacturing/production/2015/06}"
PARTS = {"Snap-fit test tray": "fit-tray-snap-lower", "Snap-fit test lid": "fit-tray-snap-upper"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def metadata(element):
    return {item.get("key"): item.get("value") for item in element.findall("metadata") if item.get("key")}


def triangles(mesh, offset=(0, 0, 0)):
    vertices = [tuple(float(v.get(axis)) + offset[i] for i, axis in enumerate("xyz")) for v in mesh.find("m:vertices", NS)]
    return [tuple(vertices[int(t.get(axis))] for axis in ("v1", "v2", "v3")) for t in mesh.find("m:triangles", NS)]


def mesh_signature(faces):
    # Bambu serializes translated float vertices with fewer decimal places.
    return sorted(tuple(sorted(tuple(round(n, 4) for n in v) for v in t)) for t in faces)


def stl_triangles(data):
    count = struct.unpack_from("<I", data, 80)[0]
    assert len(data) == 84 + count * 50, "Expected binary STL"
    return [tuple(tuple(row[k:k + 3]) for k in (3, 6, 9)) for i in range(count) for row in [struct.unpack_from("<12fH", data, 84 + 50 * i)]]


def underside_stats(faces):
    horizontal_area = 0.0
    horizontal_levels = defaultdict(float)
    max_slope = 0.0
    downward_count = 0
    for a, b, c in faces:
        u = [b[i] - a[i] for i in range(3)]
        v = [c[i] - a[i] for i in range(3)]
        n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        magnitude = math.sqrt(sum(x * x for x in n))
        if magnitude < 1e-10 or n[2] >= -1e-8 or max(a[2], b[2], c[2]) <= .001:
            continue
        downward_count += 1
        # Angle from vertical: a downward horizontal ceiling is 90 degrees.
        max_slope = max(max_slope, math.degrees(math.asin(min(1, -n[2] / magnitude))))
        if n[2] / magnitude < -.999999 and min(a[2], b[2], c[2]) > .001:
            horizontal_area += magnitude / 2
            horizontal_levels[round((a[2] + b[2] + c[2]) / 3, 3)] += magnitude / 2
    return {"elevated_horizontal_underside_area_mm2": round(horizontal_area, 6), "horizontal_levels_mm": {z: round(area, 6) for z, area in sorted(horizontal_levels.items())}, "downward_faces": downward_count, "maximum_underside_angle_from_vertical_degrees": round(max_slope, 4)}


def new_stats():
    return {"extrusion_moves": 0, "xy_chord_length_mm": 0.0, "maximum_move_chord_mm": 0.0, "bounds_min": [math.inf] * 3, "bounds_max": [-math.inf] * 3}


def add_move(stats, start, end):
    length = math.dist(start[:2], end[:2])
    stats["extrusion_moves"] += 1
    stats["xy_chord_length_mm"] += length
    stats["maximum_move_chord_mm"] = max(stats["maximum_move_chord_mm"], length)
    for i in range(3):
        stats["bounds_min"][i] = min(stats["bounds_min"][i], start[i], end[i])
        stats["bounds_max"][i] = max(stats["bounds_max"][i], start[i], end[i])


def rounded_stats(stats):
    return {key: [round(x, 4) for x in value] if isinstance(value, list) else round(value, 4) if isinstance(value, float) else value for key, value in stats.items()}


def audit_gcode(gcode, objects):
    current, role, layer = None, "", 0.0
    pos, epos, relative = [0.0, 0.0, 0.0], 0.0, True
    roles = defaultdict(lambda: defaultdict(new_stats))
    flagged = defaultdict(new_stats)
    for line in gcode.splitlines():
        match = re.match(r"; start printing object, unique label id: (\d+)", line)
        if match:
            current = int(match[1])
        if line.startswith("; stop printing object"):
            current = None
        if line.startswith("; FEATURE: "):
            role = line[11:]
        if line.startswith("; Z_HEIGHT: "):
            layer = float(line[12:])
        if line.startswith("M83"):
            relative = True
        elif line.startswith("M82"):
            relative = False
        if re.match(r"^G92\s", line):
            match = re.search(r"\bE(-?[\d.]+)", line)
            if match:
                epos = float(match[1])
        if not re.match(r"^G[0123](?:\s|$)", line):
            continue
        args = {key: float(value) for key, value in re.findall(r"([XYZEFIJ])(-?\d*\.?\d+)", line.split(";")[0])}
        end = [args.get(axis, pos[i]) for i, axis in enumerate("XYZ")]
        e = args.get("E", 0 if relative else epos)
        de = e if relative else e - epos
        epos = epos + e if relative else e
        if current in objects and de > 0 and math.dist(pos[:2], end[:2]) > .0001:
            transform = objects[current]["translation_to_source"]
            start_local = [pos[i] + transform[i] for i in range(3)]
            end_local = [end[i] + transform[i] for i in range(3)]
            add_move(roles[current][role], start_local, end_local)
            if role in ("Bridge", "Overhang wall"):
                add_move(flagged[(current, role, layer)], start_local, end_local)
        pos = end
    return roles, flagged


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=ROOT / "artifacts/snap-fit-sample")
    parser.add_argument("--stage", choices=("prototype", "final"), default="prototype")
    args = parser.parse_args()
    directory = args.directory.resolve()
    part_names = PARTS
    input_path = directory / "snap-fit-test.3mf"
    sliced_path = directory / "sliced-check.3mf"
    checks = []

    def check(name, condition):
        checks.append({"name": name, "passed": bool(condition)})

    with ZipFile(input_path) as source, ZipFile(sliced_path) as sliced:
        input_model = ET.fromstring(source.read("3D/3dmodel.model"))
        model = ET.fromstring(sliced.read("3D/3dmodel.model"))
        settings = json.loads(sliced.read("Metadata/project_settings.config"))
        model_settings = ET.fromstring(sliced.read("Metadata/model_settings.config"))
        slice_info = ET.fromstring(sliced.read("Metadata/slice_info.config"))
        plate = slice_info.find("plate")
        plate_meta = metadata(plate)
        check("expected sliced objects", len(model_settings.findall("object")) == len(part_names))
        check("supports disabled", str(settings.get("enable_support")) == "0")
        check("no support used", plate_meta.get("support_used") == "false")
        check("no skipped objects", all(o.get("skipped") == "false" for o in plate.findall("object")))
        check("PLA filament profile", all(f.get("type") == "PLA" for f in plate.findall("filament")))
        objects = {}
        for obj in model_settings.findall("object"):
            object_meta = metadata(obj)
            name = object_meta["name"]
            basename = part_names[name]
            part = obj.find("part")
            part_meta = metadata(part)
            stat = part.find("mesh_stat").attrib
            repair_total = sum(int(value) for key, value in stat.items() if key != "face_count")
            check(f"{name}: no repairs", repair_total == 0)
            check(f"{name}: 5% infill", object_meta.get("sparse_infill_density") == "5%")
            check(f"{name}: Arachne", object_meta.get("wall_generator") == "arachne")
            source_id = int(part_meta["source_object_id"]) + 1
            input_faces = triangles(input_model.find(f'.//m:object[@id="{source_id}"]/m:mesh', NS))
            stl_faces = stl_triangles((directory / f"{basename}.stl").read_bytes())
            check(f"{name}: STL matches input 3MF", mesh_signature(stl_faces) == mesh_signature(input_faces))
            component = model.find(f'.//m:object[@id="{obj.get("id")}"]/m:components/m:component', NS)
            component_file = component.get(PRODUCTION + "path").lstrip("/")
            offset = [float(part_meta[f"source_offset_{axis}"]) for axis in "xyz"]
            sliced_faces = triangles(ET.fromstring(sliced.read(component_file)).find(".//m:mesh", NS), offset)
            check(f"{name}: sliced mesh matches input 3MF", mesh_signature(input_faces) == mesh_signature(sliced_faces))
            underside = underside_stats(stl_faces)
            check(f"{name}: horizontal undersides confined to channel transition and closure", set(underside["horizontal_levels_mm"]) <= {8.0,10.6})
            perimeter = 2 * sum(max(v[a] for f in stl_faces for v in f) - min(v[a] for f in stl_faces for v in f) for a in (0,1))
            check(f"{name}: channel transition ledge below 0.04 mm equivalent width", underside["horizontal_levels_mm"].get(8.0,0) <= perimeter * .04)
            check(f"{name}: channel closure bounded by 0.4 mm bridge", underside["horizontal_levels_mm"].get(10.6,0) <= perimeter * .4)
            slopes = [f for f in stl_faces if not any(max(v[2] for v in f) <= z+.025 and min(v[2] for v in f) >= z-.025 for z in (8,10.6))]
            check(f"{name}: all other undersides at most 45 degrees", underside_stats(slopes)["maximum_underside_angle_from_vertical_degrees"] <= 45.05)
            instance = next(i for i in model_settings.findall("plate/model_instance") if metadata(i)["object_id"] == obj.get("id"))
            label_id = int(metadata(instance)["identify_id"])
            transform = [float(n) for n in model.find(f'm:build/m:item[@objectid="{obj.get("id")}"]', NS).get("transform").split()]
            check(f"{name}: unchanged print orientation", transform[:9] == [1, 0, 0, 0, 1, 0, 0, 0, 1])
            objects[label_id] = {"name": name, "part": basename, "mesh_repairs": repair_total, "triangle_count": int(stat["face_count"]), "infill": object_meta.get("sparse_infill_density"), "walls": object_meta.get("wall_generator"), "translation_to_source": [offset[i] - transform[9 + i] for i in range(3)], "undersides": underside}
        gcode_bytes = sliced.read("Metadata/plate_1.gcode")
        roles, flagged = audit_gcode(gcode_bytes.decode(), objects)
        for label_id, obj in objects.items():
            obj["toolpath_roles"] = {role: rounded_stats(stats) for role, stats in roles[label_id].items()}
            check(f'{obj["name"]}: has extrusion paths', bool(roles[label_id]))
        files = [input_path, sliced_path, directory / "slice.log", *sorted(directory.glob("*.stl")), *sorted(directory.glob("*.scad"))]
        hashes = {str(path.relative_to(ROOT)): sha(path.read_bytes()) for path in files}
        source_hashes = {str(path.relative_to(ROOT)): sha(path.read_bytes()) for path in sorted((ROOT / "src/geometry").glob("*.ts"))}
        source_newest = max(path.stat().st_mtime for path in (ROOT / "src/geometry").glob("*.ts"))
        scad_oldest = min(path.stat().st_mtime for path in directory.glob("*.scad"))
        fresh = scad_oldest >= source_newest
        if args.stage == "final":
            check("SCAD export is newer than all geometry source files", fresh)
        log = (directory / "slice.log").read_text()
        report = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "stage": args.stage,
            "physical_print_verified": False,
            "passed": all(c["passed"] for c in checks),
            "checks": checks,
            "application": dict((x.get("key"), x.get("value")) for x in slice_info.findall("header/header_item")),
            "printer": settings.get("printer_model"),
            "layer_height_mm": settings.get("layer_height"),
            "nozzle_diameter_mm": settings.get("nozzle_diameter"),
            "filament": [f.attrib for f in plate.findall("filament")],
            "estimated_seconds": int(plate_meta["prediction"]),
            "estimated_filament_g": float(plate_meta["weight"]),
            "supports_enabled": settings.get("enable_support"),
            "supports_used": plate_meta.get("support_used"),
            "objects": list(objects.values()),
            "bridge_and_overhang_layers": [{"object": objects[obj]["name"], "role": role, "layer_z_mm": layer, **rounded_stats(stats)} for (obj, role, layer), stats in flagged.items()],
            "interpretation": [
                "Four solid catches are supported across their complete bases. The continuous receiver skirt supplies compliance; no isolated spring leaves remain.",
                "Receiver channels close at 45 degrees onto a 0.4 mm roof; CSG overlap leaves a sub-0.04 mm equivalent transition ledge at z=8 mm. Catch and recess ramps are 45 degrees. PLA Matte physical fit remains untested.",
                "The finger notches have 45-degree roofs; ordinary internal infill/top closures can still create bridge roles.",
                "Chord lengths describe complete toolpath moves, including anchored portions, and are not measurements of unsupported spans.",
                "Support-free slicing does not establish physical fit, spring force, holding strength, creep, fatigue, or sag resistance. Print the coupon before committing a full stack.",
            ],
            "log_diagnostics": [line for line in log.splitlines() if "[error]" in line or "[warning]" in line],
            "artifact_sha256": hashes,
            "gcode_sha256": sha(gcode_bytes),
            "geometry_source_sha256_at_report_time": source_hashes,
            "scad_export_newer_than_geometry_sources": fresh,
            "source_freshness_note": "Re-export then re-slice after any geometry change. The report compares STL/input/sliced meshes; timestamp freshness alone is not a generated-SCAD source equivalence proof.",
        }
    output = directory / "native-validation.json"
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(output.relative_to(ROOT)), "stage": args.stage, "checks": len(checks), "failures": [c["name"] for c in checks if not c["passed"]], "estimated_seconds": report["estimated_seconds"], "estimated_filament_g": report["estimated_filament_g"]}, indent=2))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
