declare module 'dom-to-image-more' {
  interface Options {
    scale?: number
    bgcolor?: string | null
    style?: Partial<CSSStyleDeclaration>
    imagePlaceholder?: string
    fetchRequestInit?: RequestInit
    width?: number
    height?: number
  }
  const domtoimage: {
    toBlob(node: HTMLElement, options?: Options): Promise<Blob>
    toPng(node: HTMLElement, options?: Options): Promise<string>
    toJpeg(node: HTMLElement, options?: Options): Promise<string>
    toSvg(node: HTMLElement, options?: Options): Promise<string>
  }
  export default domtoimage
}
