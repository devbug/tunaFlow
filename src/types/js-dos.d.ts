declare module "js-dos/dist/js-dos.js" {
  export function Dos(
    element: HTMLElement,
    options?: { url?: string; pathPrefix?: string; [key: string]: any }
  ): { stop?: () => void };
}
