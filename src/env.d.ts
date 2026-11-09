// 全局类型补充：HOMURA 运行在 Tauri / 浏览器双环境，逐步迁移期先做宽松声明。
export {};

declare global {
  interface Window {
    // Tauri 2 全局桥接对象（项目不走 @tauri-apps/api 直接依赖）
    __TAURI__?: {
      core?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;
        convertFileSrc: (path: string, protocol?: string) => string;
      };
      [key: string]: any;
    };
    [key: string]: any;
  }
}
