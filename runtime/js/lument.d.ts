// ============================================================
// lument.d.ts - Lument Engine v1.3.0 TypeScript 类型定义
// ============================================================

declare const Lument: LumentEngine;

export default Lument;
export = Lument;

// ============================================================
// 基础类型
// ============================================================
export interface LumentColor {
  r: number; g: number; b: number; a: number;
}

export interface LumentRect {
  x: number; y: number; w: number; h: number;
}

export interface LumentVec2 {
  x: number; y: number;
}

export interface LumentConfig {
  width: number;
  height: number;
  title?: string;
  targetFps?: number;
  rendererType?: number;
  assetPath?: string;
}

export interface LumentStats {
  fps: number;
  frameTime: number;
  drawCalls: number;
  entityCount: number;
}

// ============================================================
// 常量
// ============================================================
export declare const VERSION: string;
export declare const PLATFORM: { DESKTOP: 0; ANDROID: 1; IOS: 2; WEB: 3; };
export declare const RENDERER: { OPENGL: 0; OPENGLES: 1; WEBGL: 2; CANVAS2D: 3; VULKAN: 4; };
export declare const KEY: { NONE: 0; LEFT: 1; RIGHT: 2; UP: 3; DOWN: 4; ACTION: 5; CANCEL: 6; MENU: 7; MAX: 8; };
export declare const WIDGET: {
  NONE: 0; CONTAINER: 1; BUTTON: 2; LABEL: 3; INPUT: 4;
  IMAGE: 5; LIST: 6; PROGRESS: 7; CHECKBOX: 8; SLIDER: 9;
  TABBAR: 10; NAVBAR: 11; DROPDOWN: 12; TOGGLE: 13;
  SCROLLVIEW: 14; TOOLTIP: 15; DIVIDER: 16; SPINNER: 17; ICON: 18;
};
export declare const LAYOUT: { NONE: 0; VERTICAL: 1; HORIZONTAL: 2; GRID: 3; STACK: 4; FLOW: 5; };
export declare const AUTOSIZE: { OFF: 0; WIDTH: 1; HEIGHT: 2; BOTH: 3; };
export declare const BROADPHASE: { GRID: 0; QUADTREE: 1; BRUTE: 2; };
export declare const EVENT: { NONE: 0; CLICK: 1; FOCUS: 2; BLUR: 3; CHANGE: 4; SCROLL: 5; };
export declare const LIGHT: { POINT: 0; DIRECTIONAL: 1; SPOT: 2; };
export declare const BODY: { STATIC: 0; KINEMATIC: 1; DYNAMIC: 2; };
export declare const SHAPE: { CIRCLE: 0; BOX: 1; };
export declare const HTTP: { GET: 'GET'; POST: 'POST'; PUT: 'PUT'; DELETE: 'DELETE'; };
export declare const WS: { CONNECTING: 0; OPEN: 1; CLOSING: 2; CLOSED: 3; };
export declare const AI: { NODE_SEQ: 0; NODE_SEL: 1; NODE_PAR: 2; NODE_DEC: 3; NODE_ACT: 4; NODE_CON: 5; };

// ============================================================
// 主题
// ============================================================
export interface LumentTheme {
  background: LumentColor;
  surface: LumentColor;
  primary: LumentColor;
  secondary: LumentColor;
  text: LumentColor;
  textMuted: LumentColor;
  border: LumentColor;
  accent: LumentColor;
  danger: LumentColor;
  success: LumentColor;
}

// ============================================================
// 事件回调
// ============================================================
export type LumentEventCallback = (widget: number, event: number, data: string) => void;

// ============================================================
// 物理相关
// ============================================================
export interface PhysicsBody {
  id: number;
  shape: number;
  bodyType: number;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  angularVel: number;
  mass: number;
  radius: number;
  w: number; h: number;
}

export interface PhysicsCollision {
  bodyA: number;
  bodyB: number;
  point: LumentVec2;
  normal: LumentVec2;
  penetration: number;
}

export interface RaycastHit {
  bodyId: number;
  point: LumentVec2;
  t: number;
}

// ============================================================
// 网络相关
// ============================================================
export interface LumentHttpResponse {
  status: number;
  ok: boolean;
  body: string;
  headers: string;
}

// ============================================================
// 主引擎接口
// ============================================================
export interface LumentEngine {
  // 常量
  VERSION: string;
  PLATFORM: typeof PLATFORM;
  RENDERER: typeof RENDERER;
  KEY: typeof KEY;
  WIDGET: typeof WIDGET;
  LAYOUT: typeof LAYOUT;
  AUTOSIZE: typeof AUTOSIZE;
  BROADPHASE: typeof BROADPHASE;
  EVENT: typeof EVENT;
  LIGHT: typeof LIGHT;
  BODY: typeof BODY;
  SHAPE: typeof SHAPE;

  // 核心
  init(config: LumentConfig): boolean;
  shutdown(): void;
  isRunning(): boolean;
  beginFrame(): void;
  endFrame(): void;
  getDeltaTime(): number;
  getStats(): LumentStats;
  getPlatform(): number;
  getRendererType(): number;
  run(onUpdate: () => void): void;

  // 渲染
  clear(color: LumentColor): void;
  setCamera(x: number, y: number, zoom: number): void;
  drawRect(rect: LumentRect, color: LumentColor, filled: boolean): void;
  drawSprite(textureId: number, dest: LumentRect, src: LumentRect | null): void;
  drawText(text: string, x: number, y: number, size: number, color: LumentColor): void;
  drawPixel(x: number, y: number, color: LumentColor): void;
  flush(): void;
  loadTexture(path: string): number;
  createTextureFromData(data: Uint8Array, w: number, h: number): number;
  destroyTexture(textureId: number): void;
  createPixelArt(...args: any[]): any;
  getCanvas(): HTMLCanvasElement;
  getContext(): CanvasRenderingContext2D;

  // v1.3 渲染图元
  drawCircle(cx: number, cy: number, radius: number, color: LumentColor, filled: boolean): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, thickness: number, color: LumentColor): void;
  drawTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, color: LumentColor, filled: boolean): void;
  drawPolygon(points: LumentVec2[], color: LumentColor, filled: boolean): void;
  drawEllipse(cx: number, cy: number, rx: number, ry: number, color: LumentColor, filled: boolean): void;
  drawPoint(x: number, y: number, size: number, color: LumentColor): void;

  // v1.3 手动批处理
  beginBatch(textureId: number): void;
  batchQuad(dest: LumentRect, color: LumentColor): void;
  batchTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, color: LumentColor): void;
  endBatch(): void;

  // 2D 场景色彩
  setSceneTint(color: LumentColor): void;
  setSceneBrightness(v: number): void;
  setSceneContrast(v: number): void;
  setSceneSaturation(v: number): void;
  setSceneHueShift(v: number): void;
  setSceneGrayscale(v: number): void;
  setSceneSepia(v: number): void;
  setSceneInvert(v: number): void;
  setSceneColor(...args: any[]): void;
  getSceneColor(): any;
  resetSceneColor(): void;

  // 清晰度
  setSceneSharpness(v: number): void;
  setSceneBlur(v: number): void;
  setSceneBloom(v: number): void;
  setSceneClarity(...args: any[]): void;
  getSceneClarity(): any;
  resetSceneClarity(): void;

  // 暗角与雾效
  setVignette(...args: any[]): void;
  setFog(...args: any[]): void;
  resetVignette(): void;
  resetFog(): void;
  applySceneEffects(): void;

  // 光线
  addLight(type: number, x: number, y: number, ...args: any[]): number;
  setLightDirection(id: number, dx: number, dy: number): void;
  setLightAngle(id: number, angle: number): void;
  setLightIntensity(id: number, intensity: number): void;
  setLightColor(id: number, color: LumentColor): void;
  setLightPosition(id: number, x: number, y: number): void;
  removeLight(id: number): void;
  clearLights(): void;
  getLightCount(): number;
  setAmbientLight(r: number, g: number, b: number, a: number): void;
  setLightFalloff(...args: any[]): void;
  renderLights(): void;

  // 图片
  loadImage(path: string): number;
  drawImageTiled(textureId: number, dest: LumentRect, src: LumentRect): void;
  drawImageRotated(textureId: number, dest: LumentRect, src: LumentRect, angle: number): void;
  drawImageWithColor(textureId: number, dest: LumentRect, color: LumentColor): void;
  drawImageRegion(textureId: number, dest: LumentRect, src: LumentRect): void;

  // 离屏渲染目标
  createRenderTarget(w: number, h: number): number;
  setRenderTarget(id: number): void;
  drawRenderTarget(id: number, dest: LumentRect): void;
  destroyRenderTarget(id: number): void;

  // 物理
  physicsSetGravity(x: number, y: number): void;
  physicsGetGravity(): LumentVec2;
  physicsSetIterations(vel: number, pos: number): void;
  physicsStep(dt: number): void;
  physicsReset(): void;
  physicsCreateBody(bodyType: number): number;
  physicsDestroyBody(bodyId: number): void;
  physicsSetShape(bodyId: number, shape: number, ...args: any[]): void;
  physicsSetMass(bodyId: number, mass: number): void;
  physicsSetRestitution(bodyId: number, e: number): void;
  physicsSetFriction(bodyId: number, f: number): void;
  physicsSetGravityScale(bodyId: number, scale: number): void;
  physicsSetDamping(bodyId: number, linear: number, angular: number): void;
  physicsSetCustomDamping(bodyId: number, linear: number, angular: number): void;
  physicsClearCustomDamping(bodyId: number): void;
  physicsGetState(bodyId: number): PhysicsBody | null;
  physicsSetState(bodyId: number, state: Partial<PhysicsBody>): void;
  physicsGetPosition(bodyId: number): LumentVec2;
  physicsSetPosition(bodyId: number, x: number, y: number): void;
  physicsGetVelocity(bodyId: number): LumentVec2;
  physicsSetVelocity(bodyId: number, vx: number, vy: number): void;
  physicsApplyForce(bodyId: number, fx: number, fy: number): void;
  physicsApplyImpulse(bodyId: number, ix: number, iy: number): void;
  physicsApplyTorque(bodyId: number, torque: number): void;
  physicsApplyAngularImpulse(bodyId: number, impulse: number): void;
  physicsCheckCollision(bodyA: number, bodyB: number): PhysicsCollision | null;
  physicsGetCollisions(bodyId: number, maxCount: number): PhysicsCollision[];
  physicsRaycast(x1: number, y1: number, x2: number, y2: number): RaycastHit | null;
  physicsPointQuery(x: number, y: number): number;
  physicsOnCollision(callback: (a: number, b: number) => void): void;

  // v1.3 物理空间分区与调试
  physicsSetBroadphase(type: number): void;
  physicsSetGridCellSize(size: number): void;
  physicsDebugDraw(options?: {
    shapeColor?: LumentColor;
    contactColor?: LumentColor;
    gridColor?: LumentColor;
    showGrid?: boolean;
    showContacts?: boolean;
  }): void;
  physicsGetPairCount(): number;

  // 音频
  loadSound(path: string, group?: number): number;
  loadMusic(path: string): number;
  getSupportedFormats(): string[];
  playSound(id: number, loop?: boolean): void;
  stopSound(id: number): void;
  pauseSound(id: number): void;
  resumeSound(id: number): void;
  setPitch(id: number, pitch: number): void;
  setPan(id: number, pan: number): void;
  getAudioDuration(id: number): number;
  getAudioPosition(id: number): number;
  seekAudio(id: number, pos: number): void;
  fadeIn(id: number, duration: number): void;
  fadeOut(id: number, duration: number): void;
  setAudioListener(x: number, y: number, dx: number, dy: number): void;
  playSound3d(id: number, x: number, y: number, loop?: boolean): void;
  setMasterVolume(v: number): void;
  setGroupVolume(group: number, v: number): void;
  stopGroup(group: number): void;

  // 网络
  httpRequest(method: string, url: string, body?: string): number;
  httpGet(url: string): number;
  httpPost(url: string, body: string): number;
  httpPut(url: string, body: string): number;
  httpDelete(url: string): number;
  httpCancel(reqId: number): void;
  httpSetHeader(key: string, value: string): void;
  httpSetTimeout(ms: number): void;
  httpSetAuthToken(token: string): void;
  wsConnect(url: string): number;
  wsSend(wsId: number, data: ArrayBuffer): void;
  wsSendText(wsId: number, text: string): void;
  wsClose(wsId: number): void;
  wsIsConnected(wsId: number): boolean;
  jsonParse(json: string): any;
  jsonGetNumber(obj: any, path: string): number;
  jsonGetBool(obj: any, path: string): boolean;
  jsonBuild(obj: any): string;
  uploadData(url: string, data: ArrayBuffer): number;
  downloadData(url: string): number;

  // AI
  aiCreateTree(...args: any[]): number;
  aiDestroyTree(id: number): void;
  aiCreateNode(...args: any[]): number;
  aiAddChild(...args: any[]): void;
  aiSetEntity(...args: any[]): void;
  aiTick(...args: any[]): void;
  aiCreateFsm(...args: any[]): number;
  aiDestroyFsm(id: number): void;
  aiFsmAddState(...args: any[]): number;
  aiFsmAddTransition(...args: any[]): void;
  aiFsmSetState(...args: any[]): void;
  aiFsmGetState(...args: any[]): any;
  aiFsmTick(...args: any[]): void;
  aiFsmGetStateName(...args: any[]): string;
  aiCreateGrid(...args: any[]): number;
  aiDestroyGrid(id: number): void;
  aiGridSetBlocked(...args: any[]): void;
  aiGridIsBlocked(...args: any[]): boolean;
  aiGridSetCost(...args: any[]): void;
  aiFindPath(...args: any[]): number;
  aiPathLength(...args: any[]): number;
  aiCreateBlackboard(...args: any[]): number;
  aiBbSetInt(...args: any[]): void;
  aiBbSetFloat(...args: any[]): void;
  aiBbSetString(...args: any[]): void;
  aiBbSetBool(...args: any[]): void;
  aiBbGetInt(...args: any[]): number;
  aiBbGetFloat(...args: any[]): number;
  aiBbGetString(...args: any[]): string;
  aiBbGetBool(...args: any[]): boolean;
  aiBbRemove(...args: any[]): void;
  aiBbClear(...args: any[]): void;
  aiRegisterAgent(...args: any[]): void;
  aiUnregisterAgent(...args: any[]): void;
  aiAgentSetTarget(...args: any[]): void;
  aiAgentGetTarget(...args: any[]): any;
  aiAgentTick(...args: any[]): void;
  aiAgentQuery(...args: any[]): any;

  // 输入
  keyDown(key: number): boolean;
  keyPressed(key: number): boolean;
  getTouchCount(): number;
  getTouch(index: number): LumentVec2;
  getJoystickX(): number;
  getJoystickY(): number;

  // ECS
  createEntity(): number;
  destroyEntity(entity: number): void;
  entityAlive(entity: number): boolean;
  setPosition(entity: number, x: number, y: number): void;
  getPosition(entity: number): LumentVec2;
  setScale(entity: number, sx: number, sy: number): void;
  setSprite(entity: number, textureId: number): void;
  setSpriteColor(entity: number, color: LumentColor): void;
  setVisible(entity: number, visible: boolean): void;
  setCollider(entity: number, w: number, h: number): void;
  checkCollision(entity: number): boolean;
  setScript(entity: number, callback: (dt: number) => void): void;

  // 场景
  loadScene(path: string): boolean;
  setActiveScene(name: string): void;
  getActiveScene(): string;
  sceneSetBackground(color: LumentColor): void;

  // 存储
  saveData(key: string, data: string): boolean;
  loadData(key: string): string;
  clearData(key: string): boolean;

  // 工具
  getTimeMs(): number;
  random(): number;
  randomRange(min: number, max: number): number;
  log(msg: string): void;

  // UI / 应用开发
  uiCreate(type: number): number;
  uiDestroy(widget: number): void;
  uiClearAll(): void;
  uiSetText(widget: number, text: string): void;
  uiGetText(widget: number): string;
  uiSetPosition(widget: number, x: number, y: number): void;
  uiSetSize(widget: number, w: number, h: number): void;
  uiSetColor(widget: number, color: LumentColor): void;
  uiSetTextColor(widget: number, color: LumentColor): void;
  uiSetFontSize(widget: number, size: number): void;
  uiSetVisible(widget: number, visible: boolean): void;
  uiSetEnabled(widget: number, enabled: boolean): void;
  uiSetImage(widget: number, textureId: number): void;
  uiAddChild(parent: number, child: number): void;
  uiRemoveChild(parent: number, child: number): void;
  uiGetParent(widget: number): number;
  uiSetLayout(container: number, layout: number): void;
  uiSetPadding(container: number, top: number, right: number, bottom: number, left: number): void;
  uiSetSpacing(container: number, spacing: number): void;
  uiSetGrid(container: number, cols: number, rows: number): void;
  uiSetAlignment(container: number, align: number): void;
  uiOnEvent(widget: number, event: number, callback: LumentEventCallback): void;
  uiSetFocused(widget: number): void;
  uiRender(): void;
  uiHandleTouch(x: number, y: number, type: number): boolean;
  uiHandleKey(key: number, pressed: boolean): boolean;
  uiNavigateTo(screen: number): void;
  uiNavigateBack(): void;
  uiGetCurrentScreen(): number;
  uiCreateButton(text: string, x: number, y: number, w: number, h: number): number;
  uiCreateLabel(text: string, x: number, y: number, w: number, h: number): number;
  uiCreateInput(placeholder: string, x: number, y: number, w: number, h: number): number;

  // v1.3 新增控件
  uiCreateDropdown(x: number, y: number, w: number, h: number): number;
  uiCreateToggle(initial: boolean, x: number, y: number, w: number, h: number): number;
  uiCreateScrollview(x: number, y: number, w: number, h: number): number;
  uiCreateTooltip(text: string, x: number, y: number): number;
  uiCreateProgress(x: number, y: number, w: number, h: number): number;
  uiCreateSlider(min: number, max: number, value: number, x: number, y: number, w: number, h: number): number;
  uiCreateCheckbox(initial: boolean, x: number, y: number, w: number, h: number): number;
  uiCreateDivider(x: number, y: number, w: number, h: number): number;
  uiCreateSpinner(x: number, y: number, size: number): number;
  uiCreateIcon(textureId: number, x: number, y: number, size: number): number;

  // v1.3 控件状态接口
  uiSetValue(widget: number, value: number): void;
  uiGetValue(widget: number): number;
  uiSetMinMax(widget: number, min: number, max: number): void;
  uiSetOptions(widget: number, options: string[]): void;
  uiGetSelected(widget: number): number;
  uiSetSelected(widget: number, index: number): void;
  uiSetChecked(widget: number, checked: boolean): void;
  uiGetChecked(widget: number): boolean;
  uiSetScroll(widget: number, offsetX: number, offsetY: number): void;
  uiGetScroll(widget: number): LumentVec2;
  uiSetContentSize(scrollview: number, w: number, h: number): void;

  // v1.3 自动化系统
  uiSetTheme(theme: Partial<LumentTheme>): void;
  uiGetTheme(): LumentTheme;
  uiResetTheme(): void;
  uiSetAutoSize(widget: number, mode: number): void;
  uiMeasureText(text: string, fontSize: number): { w: number; h: number };
  uiSetMargin(widget: number, top: number, right: number, bottom: number, left: number): void;
  uiBuildFromJson(json: string): number;
  uiDumpTree(root: number): string;
  uiFindById(name: string): number;
}
