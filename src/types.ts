export type Vec3 = [number, number, number];
export type KeyType = 'A' | 'C' | 'AN' | 'CN' | 'CK' | 'CI';
export type TemplateId = 'desktop_dock' | 'modular_rail' | 'inventory_tray' | 'grid_organizer' | 'travel_case' | 'key_fit_tester' | 'interface_tests';
export type SocketProfile = 'A' | 'C' | 'AN' | 'CN';
export interface Slot { id: string; type: KeyType; label: string; occupied: boolean }
export type TrayConnection = 'none' | 'stackable' | 'h20_slide_v7' | 'snap_fit';
export type TraySlideDirection = 'left' | 'right' | 'front' | 'back';
export type TrayLidStyle = 'regular' | 'minimal';
export interface HolderOptions {
  dock: { columns: number; spacing: number; rowSpacing: number; edgeMargin: number; depthMargin: number; height: number; title: string };
  rail: { mountingHoles: boolean; endMargin: number };
  tray: { columns: number; spacing: number; rowSpacing: number; rowGap: number; margin: number; height: number; scoop: 'small' | 'default' | 'large'; retention: boolean; connection: TrayConnection; slideDirection: TraySlideDirection; sideText: string; lid: boolean; lidStyle: TrayLidStyle; lidText: string; lidTextSize: number; lidTextPercent?: number; lidTextRotation?: 0 | 90 | 180 | 270; footprint: { width: number; depth: number } | null };
  grid: { mode: 'mixed' | 'upright' | 'flat'; extraHeight: number };
  case: { headroom: number; title: string };
  tester: { profile: SocketProfile; startOffset: number; step: number; samples: 3 | 5 };
  interfaceTests: { kind: 'all' | 'rail' | 'lid' | 'grid' | 'tray_snap' | 'tray_h20' };
}
export interface HolderConfig {
  version: 1;
  template: TemplateId;
  slots: Slot[];
  labels: boolean;
  labelSize: number;
  options: HolderOptions;
}
export interface PartSpec {
  id: string;
  name: string;
  scad: string;
  position: Vec3;
  rotation: Vec3;
  explode: Vec3;
  color: string;
}
export interface KeyPlacement { slotId: string; type: KeyType; position: Vec3; rotation: Vec3; partId?: string }
export interface ProjectGeometry { parts: PartSpec[]; keys: KeyPlacement[]; dimensions: Vec3 }
