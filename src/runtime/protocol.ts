export interface RenderIdentity {
  jobId: string;
  revision: number;
  partId: string;
}

export interface RenderRequest extends RenderIdentity {
  type: 'render';
  scad: string;
}

export type RenderResponse =
  | (RenderIdentity & { type: 'log'; line: string })
  | (RenderIdentity & { type: 'result'; stl: ArrayBuffer })
  | (RenderIdentity & { type: 'error'; message: string });
