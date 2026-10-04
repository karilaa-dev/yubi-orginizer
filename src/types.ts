export type Vec3 = [number, number, number];
export type KeyType = 'A' | 'C' | 'AN' | 'CN' | 'CK' | 'CI';
export type TemplateId = 'inventory_tray' | 'desktop_dock';
export interface Slot { id: string; type: KeyType; label: string; occupied: boolean; rotation?: 0 | 90 }
export type TrayConnection = 'none' | 'stackable' | 'h20_slide_v7' | 'snap_fit';
export type TraySlideDirection = 'left' | 'right' | 'front' | 'back';
export type TrayLidStyle = 'regular' | 'minimal';
export interface HolderOptions {
  dock: { columns: number; spacing: number; rowSpacing: number; edgeMargin: number; depthMargin: number; height: number; title: string; titlePercent?: number };
  tray: { arrangement?: 'compact'; columns: number; spacing: number; rowGap: number; margin: number; height: number; scoop: 'small' | 'default' | 'large'; retention: boolean; connection: TrayConnection; slideDirection: TraySlideDirection; sideText: string; sideTextPercent?: number; lid: boolean; lidStyle: TrayLidStyle; lidText: string; lidTextSize: number; lidTextPercent?: number; lidTextRotation?: 0 | 90 | 180 | 270; footprint: { width: number; depth: number } | null };
}
export interface HolderConfig {
  version: 1;
  template: TemplateId;
  slots: Slot[];
  labels: boolean;
  labelSize: number;
  options: HolderOptions;
  /** The root config is the first layer, preserving existing single-tray files. */
  layerName?: string;
  /** Additional trays, ordered from bottom to top. Nested sets are not allowed. */
  layers?: TrayLayer[];
}
export interface TrayLayer { name: string; config: HolderConfig }
export interface PartSpec {
  id: string;
  name: string;
  scad: string;
  position: Vec3;
  rotation: Vec3;
  explode: Vec3;
  color: string;
  /** Preview only: a slide-lock part first slides by this much (to its entry position) before it can lift off. */
  release?: Vec3;
}
export interface KeyPlacement { slotId: string; type: KeyType; position: Vec3; rotation: Vec3; partId?: string }
export interface ProjectGeometry { parts: PartSpec[]; keys: KeyPlacement[]; dimensions: Vec3 }
